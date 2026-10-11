export type Product = {
  id: string; provider_id: 'luckin' | 'mcdonalds' | 'kfc'; title: string;
  summary: string; brand: string; category: string; currency: 'CNY';
  amount: number; availability: 'unknown'; url?: string; updated_at: string;
  source: 'MOCK' | 'LIVE';
  store?: { id: string; name: string };
  price_basis?: string;
  image_url?: string;
  source_reason?: string;
};

// Synthetic fixtures for protocol demonstration. Prices are illustrative, not offers.
export const PRODUCTS: Product[] = [
  { id: 'luckin-latte', provider_id: 'luckin', title: '瑞幸冰拿铁（模拟）', summary: '模拟商品，非实时菜单或报价', brand: '瑞幸', category: 'coffee', currency: 'CNY', amount: 19, availability: 'unknown', url: 'https://example.invalid/luckin-latte', updated_at: '2026-10-11T00:00:00.000Z', source: 'MOCK' },
  { id: 'luckin-milk-tea', provider_id: 'luckin', title: '瑞幸冰奶茶（模拟）', summary: '模拟商品，非实时菜单或报价', brand: '瑞幸', category: 'tea', currency: 'CNY', amount: 18, availability: 'unknown', url: 'https://example.invalid/luckin-milk-tea', updated_at: '2026-10-11T00:00:00.000Z', source: 'MOCK' },
  { id: 'mcd-burger', provider_id: 'mcdonalds', title: '麦当劳汉堡（模拟）', summary: '模拟商品，非实时菜单或报价', brand: '麦当劳', category: 'burger', currency: 'CNY', amount: 22, availability: 'unknown', url: 'https://example.invalid/mcd-burger', updated_at: '2026-10-11T00:00:00.000Z', source: 'MOCK' },
  { id: 'kfc-chicken', provider_id: 'kfc', title: '肯德基炸鸡（模拟）', summary: '模拟商品，非实时菜单或报价', brand: '肯德基', category: 'chicken', currency: 'CNY', amount: 25, availability: 'unknown', url: 'https://example.invalid/kfc-chicken', updated_at: '2026-10-11T00:00:00.000Z', source: 'MOCK' },
];
