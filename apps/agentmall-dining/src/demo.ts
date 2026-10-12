import { catalogManifestSchema, catalogQueryResultSchema, resolvableReferenceSchema } from '@ocp-catalog/ocp-schema';
import { handle } from './server';

const call = async (path: string, data?: unknown) => {
  const response = await handle(new Request(`http://localhost:4400${path}`, data === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }));
  if (!response.ok) throw Error(`${path}: HTTP ${response.status}`);
  return response.json();
};
const discovery = await call('/.well-known/ocp-catalog') as any;
const manifest = catalogManifestSchema.parse(await call('/ocp/manifest'));
console.log('Discovery', discovery.catalog_id, 'Manifest', manifest.query_capabilities[0]?.query_packs[0]?.pack_id);
for (const provider_id of ['luckin', 'mcdonalds', 'kfc']) {
  const result = catalogQueryResultSchema.parse(await call('/ocp/query', { query_pack: 'ocp.query.keyword.v1', query_mode: 'keyword', query: '', filters: { provider_id } }));
  const entry = result.entries[0]?.entry;
  if (!entry || entry.attributes.source !== 'MOCK') throw Error(`${provider_id}: no labeled product`);
  const view = resolvableReferenceSchema.parse(await call('/ocp/resolve', { entry_id: entry.entry_id, purpose: 'view' }));
  const checkout = resolvableReferenceSchema.parse(await call('/ocp/resolve', { entry_id: entry.entry_id, purpose: 'checkout' }));
  if (view.action_bindings[0]?.action_id !== 'view' || checkout.action_bindings[0]?.requires_user_confirmation !== true) throw Error('Action separation failed');
  const order = await call('/mock/checkout', { resolution_id: checkout.id, entry_id: entry.entry_id, confirmed: true }) as any;
  if (order.status !== 'MOCK' || order.charged !== false) throw Error('Unsafe checkout');
  console.log(provider_id, entry.title, entry.attributes.price, order.mock_order_id);
}
console.log('PASS: three providers, OCP resolve, confirmed mock checkout');
