/** OCP Catalog adapted from the official TypeScript example.
 * Merchant reads are outside the protocol implementation; real checkout is gated behind an authorized local browser workflow.
 */
import { PRODUCTS, type Product } from './products';
import { page } from './page';
import { catalogManifestSchema, catalogQueryRequestSchema, resolveRequestSchema, type CatalogQueryRequest } from '@ocp-catalog/ocp-schema';

import { validateCatalogQueryRequest } from '@ocp-catalog/ocp-client';
import { providerProducts, LIVE_TTL_MS } from './providers';
import { RealRoutes, createRealRuntime } from './real-http';
import { CheckoutError } from './real-checkout';

const CATALOG_ID = process.env.CATALOG_ID ?? 'cat_agentmall_dining';
const CATALOG_NAME = process.env.CATALOG_NAME ?? 'AgentMall Dining Catalog';
const PORT = Number(process.env.PORT ?? 4400);
const BASE_URL = (process.env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${PORT}`).replace(/\/$/, '');

let realRoutes: RealRoutes | undefined;
export const installRealRoutes = (routes?: RealRoutes) => { realRoutes = routes; };

const checkoutTickets = new Map<string, { entry_id: string; expires: number }>();

const entryId = (product: Product) => `entry_${product.provider_id}_${product.id}`;
const resolvedProducts = new Map(PRODUCTS.map(product => [entryId(product), product]));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function wellKnownDiscovery() {
  return {
    ocp_version: '1.0',
    kind: 'WellKnownCatalogDiscovery',
    catalog_id: CATALOG_ID,
    catalog_name: CATALOG_NAME,
    manifest_url: `${BASE_URL}/ocp/manifest`,
    health_url: `${BASE_URL}/ocp/health`,
    query_url: `${BASE_URL}/ocp/query`,
    resolve_url: `${BASE_URL}/ocp/resolve`,
    contracts_url: `${BASE_URL}/ocp/contracts`,
  };
}

function manifest() {
  return {
    ocp_version: '1.0',
    kind: 'CatalogManifest',
    id: `manifest_${CATALOG_ID}`,
    catalog_id: CATALOG_ID,
    catalog_name: CATALOG_NAME,
    description: 'Dining catalog with read-only LIVE merchant data and clearly labeled MOCK fallback.',
    registry_visibility: 'public',
    endpoints: {
      health: { url: `${BASE_URL}/ocp/health`, method: 'GET' },
      query: { url: `${BASE_URL}/ocp/query`, method: 'POST' },
      resolve: { url: `${BASE_URL}/ocp/resolve`, method: 'POST' },
      contracts: { url: `${BASE_URL}/ocp/contracts`, method: 'GET' },
    },
    query_capabilities: [
      {
        capability_id: 'ocp.agentmall.product.search.v1',
        name: 'Keyword product search',
        description: 'Keyword search and provider/budget filtering over merchant products.',
        query_packs: [
          {
            pack_id: 'ocp.query.keyword.v1',
            description: 'Keyword search over title, summary, brand, and category.',
            query_modes: ['keyword', 'filter', 'hybrid'],
          },
        ],
        input_fields: [
          { name: 'filters.provider_id', type: 'string', description: 'luckin, mcdonalds or kfc' },
          { name: 'filters.max_amount', type: 'number', description: 'Maximum CNY merchant estimate or mock price' },
        ],
        supports_explain: true,
        supports_resolve: true,
      },
    ],
    // Required by the schema even for a read-only node that ingests nothing.
    object_contracts: [],
  };
}

function health() {
  return {
    ocp_version: '1.0',
    kind: 'CatalogHealth',
    catalog_id: CATALOG_ID,
    status: 'healthy',
    ready: true,
    checked_at: new Date().toISOString(),
  };
}

function contracts() {
  return {
    ocp_version: '1.0',
    kind: 'ObjectContractList',
    catalog_id: CATALOG_ID,
    object_contracts: [],
    note: 'Read-only example node; it does not accept provider object ingestion.',
  };
}

function toEntry(product: Product, checkoutMode: 'MOCK' | 'REAL_PREVIEW_ELIGIBLE' = 'MOCK') {
  return {
    kind: 'CatalogEntry',
    catalog_id: CATALOG_ID,
    entry_id: entryId(product),
    provider_id: product.provider_id,
    object_id: product.id,
    object_type: 'ocp.commerce.product',
    title: product.title,
    summary: product.summary,
    attributes: {
      brand: product.brand,
      category: product.category,
      price: { currency: product.currency, amount: product.amount },
      inventory: { availability_status: product.availability },
      product_url: product.url,
      source: product.source,
      store: product.store,
      price_basis: product.price_basis ?? 'mock_fixture',
      source_reason: product.source_reason,
      retrieved_at: product.updated_at,
      transaction_source: checkoutMode,
    },
  };
}

async function query(request: Request, body: CatalogQueryRequest, policy: ReturnType<typeof validateCatalogQueryRequest>['policy_summary']) {
  const term = (body.query ?? '').trim().toLowerCase();
  const limit = Math.min(Math.max(body.limit ?? 20, 1), 50);
  const providers = (['luckin', 'mcdonalds', 'kfc'] as const).filter(provider => !body.filters?.provider_id || body.filters.provider_id === provider);
  const realFlow = request.headers.get('x-agentmall-flow') === 'real';
  if (realFlow && (!realRoutes || body.filters?.provider_id !== 'luckin')) throw new CheckoutError(400, 'Real flow currently supports only explicitly selected Luckin store');
  const groups = await Promise.all(providers.map(async provider => provider === 'luckin' && realFlow ? (await realRoutes!.queryProducts(request, term))! : providerProducts(provider, term)));
  const products = groups.flat();
  for (const product of products) resolvedProducts.set(entryId(product), product);
  for (const [id, product] of resolvedProducts) if (product.source === 'LIVE' && Date.parse(product.updated_at) + LIVE_TTL_MS < Date.now()) resolvedProducts.delete(id);
  const matches = products.filter((p) =>
    (!body.filters?.provider_id || p.provider_id === body.filters.provider_id) &&
    (body.filters?.max_amount === undefined || p.amount <= body.filters.max_amount) &&
    (!term || [p.title, p.summary, p.brand, p.category].some((f) => f.toLowerCase().includes(term)))
  );
  const page = matches.slice(0, limit);
  return {
    ocp_version: '1.0',
    kind: 'CatalogQueryResult',
    id: `qry_${crypto.randomUUID()}`,
    catalog_id: CATALOG_ID,
    query_pack: 'ocp.query.keyword.v1',
    query_mode: policy.query_mode,
    policy_summary: policy,
    query: body.query ?? '',
    result_count: page.length,
    page: { limit, offset: 0, has_more: matches.length > limit },
    entries: page.map((product) => ({
      entry: toEntry(product, realFlow ? 'REAL_PREVIEW_ELIGIBLE' : 'MOCK'),
      score: 1,
      explain: [`Keyword match for "${body.query ?? ''}".`],
    })),
  };
}

function resolve(body: { entry_id?: string; purpose?: 'view' | 'checkout' }, request: Request) {
  const product = resolvedProducts.get(body.entry_id ?? '');
  if (!product) {
    return json(
      { error: { code: 'not_found', message: `Unknown entry_id: ${body.entry_id ?? '(missing)'}` } },
      404,
    );
  }
  if (product.source === 'LIVE' && Date.parse(product.updated_at) + LIVE_TTL_MS < Date.now()) return json({ error: { code: 'stale_entry', message: 'Merchant snapshot expired; query again' } }, 409);
  const now = new Date().toISOString();
  const expiry = Math.min(Date.now() + 5 * 60 * 1000, product.source === 'LIVE' ? Date.parse(product.updated_at) + LIVE_TTL_MS : Infinity);
  const expires = new Date(expiry).toISOString();
  for (const [id, ticket] of checkoutTickets) if (ticket.expires < Date.now()) checkoutTickets.delete(id);
  const checkout = body.purpose === 'checkout';
  let realBinding: ReturnType<RealRoutes['bind']> = null;
  if (checkout && request.headers.get('x-agentmall-flow') === 'real') {
    if (!realRoutes) return json({ error: { code: 'real_disabled', message: 'Real workflow unavailable' } }, 403);
    try { realBinding = realRoutes.bind(request, product); } catch (e) { return json({ error: { code: 'real_selection', message: e instanceof CheckoutError ? e.message : 'Selection unavailable' } }, e instanceof CheckoutError ? e.status : 400); }
  }
  const resolutionId = `res_${crypto.randomUUID()}`;
  if (checkout && !realBinding) checkoutTickets.set(resolutionId, { entry_id: entryId(product), expires: expiry });
  return json({
    ocp_version: '1.0',
    kind: 'ResolvableReference',
    id: resolutionId,
    catalog_id: CATALOG_ID,
    entry_id: entryId(product),
    commercial_object_id: `co_${product.id}`,
    object_id: product.id,
    object_type: 'ocp.commerce.product',
    provider_id: product.provider_id,
    title: product.title,
    visible_attributes: {
      brand: product.brand,
      category: product.category,
      price: { currency: product.currency, amount: product.amount },
      availability: product.availability,
      source: product.source,
      store: product.store,
      price_basis: product.price_basis ?? 'mock_fixture',
      source_reason: product.source_reason,
      retrieved_at: product.updated_at,
      transaction_source: realBinding ? 'REAL_WORKFLOW' : 'MOCK',
      transaction_id: realBinding?.transaction_id,
    },
    action_bindings: [
      {
        action_id: realBinding ? 'luckin-real-preview' : checkout ? 'mock-checkout' : 'view',
        action_type: realBinding ? 'workflow' : checkout ? 'api' : 'url',
        label: realBinding ? '瑞幸真实订单预览；创建订单需另行人工确认' : checkout ? 'Confirm simulated order' : 'View retrieved product snapshot',
        auth_requirements: realBinding ? { browser_session: true, csrf: true, confirmed_store: true } : {},
        input_schema: realBinding ? { type: 'object', properties: { quantity: { type: 'integer', minimum: 1, maximum: 5 } }, required: ['quantity'], additionalProperties: false } : undefined,
        entrypoint: realBinding ? { url: `${BASE_URL}/api/luckin/transactions/${realBinding.transaction_id}/preview`, method: 'POST' } : checkout ? { url: `${BASE_URL}/mock/checkout`, method: 'POST' } : { url: `${BASE_URL}/products/${encodeURIComponent(entryId(product))}`, method: 'GET' },
        requires_user_confirmation: checkout,
        expires_at: expires,
      },
    ],
    access: { visibility: 'public', permission_state: 'granted', redacted_fields: [], policy_notes: realBinding ? ['Real preview requires an authorized browser and explicitly confirmed store.', 'Creation defaults disabled and requires a separate one-use browser confirmation after preview.'] : ['Checkout simulates an order; no real purchase.', 'Resolve uses the retrieved snapshot; no fresh quote or availability check.'] },
    live_checks: [{ check_id: 'snapshot-only', status: 'not_applicable', checked_at: now, summary: 'Read-only snapshot; availability and final order price are unverified' }],
    freshness: { object_updated_at: product.updated_at, resolved_at: now },
    // Action expires after five minutes; LIVE snapshots must also remain fresh.
    expires_at: expires,
  });
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null as any;
  } catch {
    return null as any;
  }
}

export async function handle(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  const { method } = request;

  if (!['127.0.0.1', 'localhost'].includes(new URL(request.url).hostname)) return json({ error: { code: 'local_only', message: 'Loopback host required' } }, 403);
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return json({ error: { code: 'origin', message: 'Cross-origin requests rejected' } }, 403);
  if (pathname.startsWith('/api/')) return (await realRoutes?.route(request)) ?? json({ error: { code: 'real_unavailable', message: 'Real workflow not initialized' } }, 403);
  if (method === 'GET' && pathname === '/') return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" } });
  if (method === 'GET' && pathname.startsWith('/products/')) {
    const product = resolvedProducts.get(decodeURIComponent(pathname.slice('/products/'.length)));
    if (!product) return json({ error: { code: 'not_found', message: 'Unknown product' } }, 404);
    return json(toEntry(product));
  }
  if (method === 'POST' && pathname === '/mock/checkout') {
    const body = await readJson(request);
    const ticket = checkoutTickets.get(String(body?.resolution_id ?? ''));
    if (!ticket || ticket.entry_id !== body?.entry_id || ticket.expires < Date.now() || body?.confirmed !== true) return json({ error: { code: 'invalid_confirmation', message: 'Valid checkout resolution and explicit confirmation required' } }, 400);
    checkoutTickets.delete(String(body.resolution_id));
    return json({ status: 'MOCK', mock_order_id: `MOCK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, charged: false });
  }
  if (method === 'GET' && pathname === '/.well-known/ocp-catalog') return json(wellKnownDiscovery());
  if (method === 'GET' && pathname === '/ocp/manifest') return json(manifest());
  if (method === 'GET' && pathname === '/ocp/health') return json(health());
  if (method === 'GET' && pathname === '/ocp/contracts') return json(contracts());
  if (method === 'POST' && pathname === '/ocp/query') {
    const parsed = catalogQueryRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) return json({ error: { code: 'invalid_query', message: 'Invalid OCP query request' } }, 400);
    if (parsed.data.query_pack && parsed.data.query_pack !== 'ocp.query.keyword.v1') return json({ error: { code: 'unsupported_query_pack', message: 'Query pack is not declared in manifest' } }, 400);

    if (parsed.data.catalog_id && parsed.data.catalog_id !== CATALOG_ID) return json({ error: { code: 'invalid_catalog', message: 'Unknown catalog_id' } }, 400);
    if (parsed.data.cursor) return json({ error: { code: 'unsupported_cursor', message: 'Pagination cursor not supported in this MVP' } }, 400);
    try {
      const validated = validateCatalogQueryRequest(catalogManifestSchema.parse(manifest()), parsed.data);
      return json(await query(request, validated.request, validated.policy_summary));
    } catch (error) {
      if (error instanceof CheckoutError) return json({ error: { code: 'real_context', message: error.message } }, error.status);
      return json({ error: { code: 'invalid_query_capability', message: 'Query mode or filters are not declared by this manifest' } }, 400);
    }
  }
  if (method === 'POST' && pathname === '/ocp/resolve') {
    const parsed = resolveRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) return json({ error: { code: 'invalid_resolve', message: 'Invalid OCP resolve request' } }, 400);
    if (parsed.data.catalog_id && parsed.data.catalog_id !== CATALOG_ID) return json({ error: { code: 'invalid_catalog', message: 'Unknown catalog_id' } }, 400);
    if (!['view', 'checkout'].includes(parsed.data.purpose)) return json({ error: { code: 'unsupported_purpose', message: 'Purpose not supported by demo' } }, 400);
    return resolve({ entry_id: parsed.data.entry_id, purpose: parsed.data.purpose as 'view' | 'checkout' }, request);
  }

  return json({ error: { code: 'not_found', message: `No route for ${method} ${pathname}` } }, 404);
}

// Start the server unless imported by a test.
if (import.meta.main) {
  installRealRoutes(createRealRuntime(BASE_URL));
  Bun.serve({ hostname: '127.0.0.1', port: PORT, fetch: handle });
  console.log(`AgentMall Dining OCP Catalog listening on ${BASE_URL}; use bun run open to authorize browser. Real orders: ${realRoutes!.enabled ? 'ENABLED (manual browser confirmation required)' : 'DISABLED (preview only)'}`);
}
