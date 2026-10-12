import { probe } from './mcp-probe';
import { providerProducts } from './providers';
for (const merchant of ['luckin', 'mcdonalds'] as const) {
  const connection = await probe(merchant);
  console.log(JSON.stringify(connection));
  if (connection.status !== 'CONNECTED') { process.exitCode = 1; continue; }
  const products = await providerProducts(merchant, merchant === 'luckin' ? '生椰拿铁' : '');
  const live = products.filter(item => item.source === 'LIVE');
  if (!live.length) process.exitCode = 1;
  const evidence = { checked_at: new Date().toISOString(), merchant, status: live.length ? 'LIVE_READ_VERIFIED' : 'MOCK_FALLBACK', product_count: live.length,
    examples: live.slice(0,3).map(item => ({ id: item.id, title: item.title, amount: item.amount, currency: item.currency, store: item.store, price_basis: item.price_basis, retrieved_at: item.updated_at })) };
  await Bun.write(new URL(`../docs/${merchant}-read-evidence.json`, import.meta.url), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
}
