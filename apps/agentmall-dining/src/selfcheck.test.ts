import { test, expect } from 'bun:test';
import { catalogManifestSchema, catalogHealthResponseSchema, catalogQueryResultSchema, resolvableReferenceSchema, catalogQueryRequestSchema, resolveRequestSchema } from '@ocp-catalog/ocp-schema';
import { handle } from './server';

const get = async (path: string) => handle(new Request(`http://localhost:4400${path}`));
const post = async (path: string, body: unknown) => handle(new Request(`http://localhost:4400${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

test('all six OCP endpoints, three providers, purpose-specific actions', async () => {
  const discovery = await (await get('/.well-known/ocp-catalog')).json() as any;
  expect(discovery.kind).toBe('WellKnownCatalogDiscovery');
  expect(discovery.query_url).toContain('/ocp/query');
  const manifest = catalogManifestSchema.parse(await (await get('/ocp/manifest')).json());
  expect(manifest.query_capabilities[0]?.query_packs[0]?.pack_id).toBe('ocp.query.keyword.v1');
  expect(catalogHealthResponseSchema.parse(await (await get('/ocp/health')).json()).ready).toBe(true);
  expect((await (await get('/ocp/contracts')).json() as any).kind).toBe('ObjectContractList');
  for (const provider_id of ['luckin', 'mcdonalds', 'kfc']) {
    const request = catalogQueryRequestSchema.parse({ query_pack: 'ocp.query.keyword.v1', query_mode: 'keyword', query: '', filters: { provider_id } });
    const result = catalogQueryResultSchema.parse(await (await post('/ocp/query', request)).json());
    expect(result.result_count).toBeGreaterThan(0);
    const entry = result.entries[0]!.entry;
    expect(entry.provider_id).toBe(provider_id);
    expect(entry.attributes.source).toBe('MOCK');
    const view = resolvableReferenceSchema.parse(await (await post('/ocp/resolve', resolveRequestSchema.parse({ entry_id: entry.entry_id, purpose: 'view' }))).json());
    const checkout = resolvableReferenceSchema.parse(await (await post('/ocp/resolve', resolveRequestSchema.parse({ entry_id: entry.entry_id, purpose: 'checkout' }))).json());
    expect(view.action_bindings[0]?.action_id).toBe('view');
    expect(view.action_bindings[0]?.requires_user_confirmation).toBe(false);
    expect(checkout.action_bindings[0]?.action_id).toBe('mock-checkout');
    expect(checkout.action_bindings[0]?.requires_user_confirmation).toBe(true);
    expect(Date.parse(checkout.expires_at)).toBeGreaterThan(Date.now());
  }
});


test('rejects unknown entry, invalid query and undeclared pack', async () => {
  expect((await post('/ocp/resolve', { entry_id: 'missing', purpose: 'view' })).status).toBe(404);
  expect((await post('/ocp/query', { query: '', unexpected: true })).status).toBe(400);
  expect((await post('/ocp/query', { query_pack: 'ocp.query.unknown.v1', query: '' })).status).toBe(400);
  expect((await post('/ocp/query', { query_mode: 'semantic', query: '' })).status).toBe(400);
  expect((await post('/mock/checkout', { entry_id: 'entry_luckin_luckin-latte', confirmed: true })).status).toBe(400);
});
