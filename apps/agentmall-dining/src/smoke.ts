import { catalogManifestSchema, catalogQueryResultSchema, resolvableReferenceSchema, catalogQueryRequestSchema } from '@ocp-catalog/ocp-schema';
import { validateCatalogQueryRequest } from '@ocp-catalog/ocp-client';
import { handle } from './server';
const server = Bun.serve({ port: Number(process.env.PORT ?? 4401), fetch: handle });
const base = `http://localhost:${server.port}`;
const get = async (path: string) => { const response = await fetch(base + path); if (!response.ok) throw new Error(`GET ${path} ${response.status}`); return response.json(); };
const post = async (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
try {
  if (!(await fetch(base + '/')).ok) throw new Error('Page unavailable');
  const disco = await get('/.well-known/ocp-catalog') as any;
  const manifest = catalogManifestSchema.parse(await get('/ocp/manifest'));
  await get('/ocp/health'); await get('/ocp/contracts');
  if (disco.manifest_url !== base + '/ocp/manifest') throw new Error('Discovery URL mismatch');
  const evidence: any[] = [];
  for (const provider_id of ['luckin', 'mcdonalds', 'kfc']) {
    const request = catalogQueryRequestSchema.parse({ query_pack: 'ocp.query.keyword.v1', query_mode: 'hybrid', query: provider_id === 'luckin' ? '生椰拿铁' : '', filters: { provider_id, max_amount: 30 } });
    validateCatalogQueryRequest(manifest, request, { queryUrl: base + '/ocp/query' });
    const response = await post('/ocp/query', request);
    if (!response.ok) throw new Error(`Query ${provider_id} ${response.status}`);
    const result = catalogQueryResultSchema.parse(await response.json());
    const entry = result.entries[0]?.entry;
    if (!entry) throw new Error(`No ${provider_id} candidates`);
    const credential = provider_id === 'luckin' ? process.env.LUCKIN_MCP_TOKEN : provider_id === 'mcdonalds' ? process.env.MCD_MCP_TOKEN : undefined;
    if (credential && process.env.AGENTMALL_DATA_MODE !== 'mock' && entry.attributes.source !== 'LIVE') throw new Error(`${provider_id} expected LIVE but fell back to MOCK`);
    for (const purpose of ['view', 'checkout']) {
      const resolved = await post('/ocp/resolve', { entry_id: entry.entry_id, purpose });
      const ref = resolvableReferenceSchema.parse(await resolved.json());
      if (purpose === 'checkout' && !ref.action_bindings[0]?.requires_user_confirmation) throw new Error('Unsafe checkout binding');
      if (purpose === 'view' && !(await fetch(ref.action_bindings[0]!.entrypoint.url)).ok) throw new Error('View action unavailable');
      if (purpose === 'checkout') {
        const denied = await post('/mock/checkout', { entry_id: entry.entry_id, resolution_id: ref.id, confirmed: false });
        if (denied.status !== 400) throw new Error('Unconfirmed checkout accepted');
        const accepted = await post('/mock/checkout', { entry_id: entry.entry_id, resolution_id: ref.id, confirmed: true });
        const order = await accepted.json() as any;
        if (!accepted.ok || order.status !== 'MOCK' || order.charged !== false) throw new Error('Unexpected transaction');
        const replay = await post('/mock/checkout', { entry_id: entry.entry_id, resolution_id: ref.id, confirmed: true });
        if (replay.status !== 400) throw new Error('Checkout replay accepted');
      }
    }
    evidence.push({ provider_id, candidates: result.result_count, source: entry.attributes.source, title: entry.title, price: entry.attributes.price, store: entry.attributes.store, transaction: 'MOCK' });
  }
  for (const body of [{ query_pack: 'undeclared' }, { filters: { in_stock_only: true } }]) if ((await post('/ocp/query', body)).status !== 400) throw new Error('Invalid query accepted');
  if ((await post('/ocp/resolve', { entry_id: 'unknown' })).status !== 404) throw new Error('Unknown entry accepted');
  await Bun.write(new URL('../docs/http-smoke-evidence.json', import.meta.url), JSON.stringify({ checked_at: new Date().toISOString(), evidence, result: 'PASS' }, null, 2));
  console.log('HTTP SMOKE PASS', JSON.stringify(evidence));
} finally { server.stop(true); }
