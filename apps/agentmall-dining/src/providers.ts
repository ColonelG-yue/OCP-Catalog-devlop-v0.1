import { PRODUCTS, type Product } from './products';
import { withMcp, callReadTool, type Merchant } from './mcp-probe';

const failures = new Map<Merchant, number>();
const cache = new Map<string, { until: number; products: Product[] }>();
const CACHE_MS = 60_000;
export const LIVE_TTL_MS = 120_000;
function finitePrice(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+(\.\d+)?$/.test(value)) return null;
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? price : null;
}

export function mapLuckinProducts(data: any, store: { deptId: number; deptName: string }, now: string): Product[] {
  if (!Array.isArray(data)) throw new Error('Unexpected Luckin product shape');
  return data.flatMap((item: any): Product[] => {
    const amount = finitePrice(item.estimatePrice);
    if (!Number.isInteger(item.productId) || typeof item.skuCode !== 'string' || typeof item.productName !== 'string' || amount === null) return [];
    return [{ id: `${store.deptId}-${item.productId}-${item.skuCode}`, provider_id: 'luckin', title: item.productName,
      summary: `LIVE · ${store.deptName} · 商家预估价格，非订单预览`, brand: '瑞幸', category: 'coffee',
      currency: 'CNY', amount, availability: 'unknown',
      updated_at: now, source: 'LIVE', store: { id: String(store.deptId), name: store.deptName }, price_basis: 'estimatePrice',
      ...(typeof item.pictureUrl === 'string' ? { image_url: item.pictureUrl } : {}) }];
  });
}

export function mapMcdProducts(data: any, store: { storeCode: string; storeName: string }, now: string): Product[] {
  if (!data || typeof data.meals !== 'object' || Array.isArray(data.meals)) throw new Error('Unexpected McDonalds menu shape');
  return Object.entries(data.meals).flatMap(([code, item]: [string, any]): Product[] => {
    const amount = finitePrice(item.currentPrice);
    if (typeof item.name !== 'string' || amount === null) return [];
    return [{ id: `${store.storeCode}-${code}`, provider_id: 'mcdonalds', title: item.name,
      summary: `LIVE · ${store.storeName} · 当前菜单价，非订单预览`, brand: '麦当劳', category: 'food',
      currency: 'CNY', amount, availability: 'unknown',
      updated_at: now, source: 'LIVE', store: { id: store.storeCode, name: store.storeName }, price_basis: 'currentPrice',
      ...(typeof item.image === 'string' ? { image_url: item.image } : {}) }];
  });
}

async function liveProducts(merchant: Merchant, keyword: string): Promise<Product[]> {
  return withMcp(merchant, async client => {
    const { tools } = await client.listTools(undefined, { timeout: 10000 });
    const call = (name: string, args: Record<string, unknown>) => callReadTool(client, merchant, name, args, tools);
    if (merchant === 'luckin') {
      // Public Hangzhou demo location, not the user's current location.
      const longitude = Number(process.env.LUCKIN_LONGITUDE ?? 120.1551);
      const latitude = Number(process.env.LUCKIN_LATITUDE ?? 30.2741);
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) throw new Error('Invalid demo coordinates');
      const shops = await call('queryShopList', { longitude, latitude });
      const store = shops.data?.find((item: any) => Number.isInteger(item.deptId) && typeof item.deptName === 'string' && item.workStatus === '营业中');
      if (!store) throw new Error('No operating Luckin store');
      const products = await call('searchProductForMcp', { deptId: store.deptId, query: keyword || '咖啡' });
      return mapLuckinProducts(products.data, store, new Date().toISOString());
    }
    const shops = await call('query-nearby-stores', { beType: 1, searchType: 2, city: process.env.MCD_CITY ?? '杭州', keyword: process.env.MCD_STORE_KEYWORD ?? '武林' });
    const store = shops.data?.find((item: any) => item.businessStatus === true && typeof item.storeCode === 'string' && typeof item.storeName === 'string');
    if (!store) throw new Error('No operating McDonalds store');
    const products = await call('query-meals', { storeCode: store.storeCode, orderType: 1, beType: 1 });
    return mapMcdProducts(products.data, store, new Date().toISOString());
  });
}

export async function providerProducts(merchant: Product['provider_id'], keyword: string, mode = process.env.AGENTMALL_DATA_MODE ?? 'auto'): Promise<Product[]> {
  const mocks = (reason: string) => PRODUCTS.filter(item => item.provider_id === merchant).map(item => ({ ...item, source_reason: reason }));
  if (merchant === 'kfc' || mode === 'mock') return mocks(merchant === 'kfc' ? 'KFC mock provider' : 'Deterministic mock mode');
  const tokenName = merchant === 'luckin' ? 'LUCKIN_MCP_TOKEN' : 'MCD_MCP_TOKEN';
  if (!process.env[tokenName]) return mocks('Runtime credential unavailable');
  if ((failures.get(merchant) ?? 0) >= 2) return mocks('Provider disabled after two failures; restart to retry');
  const key = `${merchant}:${merchant === 'luckin' ? keyword : ''}`;
  const cached = cache.get(key);
  if (cached && cached.until > Date.now()) return cached.products;
  try {
    const products = await liveProducts(merchant, keyword);
    cache.set(key, { until: Date.now() + CACHE_MS, products });
    failures.set(merchant, 0);
    return products;
  } catch {
    failures.set(merchant, (failures.get(merchant) ?? 0) + 1);
    return mocks('Merchant read failed; no LIVE data supplied');
  }
}
