import { createHash, timingSafeEqual, randomBytes } from 'node:crypto';
import { mkdirSync, chmodSync, readFileSync, readdirSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { LuckinGateway, MerchantFailure, type Store, type Line, type Draft } from './luckin-gateway';

export type State = 'SELECTED' | 'PREVIEWED' | 'AWAITING_CONFIRMATION' | 'SUBMITTING' | 'ORDER_CREATED' | 'PAYMENT_PENDING' | 'PAID' | 'FAILED' | 'UNKNOWN' | 'EXPIRED';
export type Selection = { entryId: string; productId: number; title: string; store: Store };
export type Preview = { store: Store; line: Line; title: string; specification: string; totalCents: number; discountCents: number; finalCents: number; coupons: string[] };
export type Transaction = { id: string; owner: string; state: State; selection: Selection; preview?: Preview; fingerprint?: string; confirmHash?: string; expiresAt: number; orderId?: string; paymentUrl?: string; createdFinalCents?: number; priceChanged?: boolean; merchantStatus?: unknown; note?: string; history: { state: State; at: string }[] };
export class CheckoutError extends Error { constructor(public readonly status: number, message: string) { super(message); } }
export const VERIFIED_LUCKIN_PAYMENT_HOSTS: readonly string[] = []; // No official payment host has yet been verified. Fail closed.
export function verifiedPaymentUrl(value: unknown, hosts: readonly string[] = VERIFIED_LUCKIN_PAYMENT_HOSTS): string | undefined {
  if (typeof value !== 'string' || value.trim() !== value) return undefined;
  try { const url=new URL(value); if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !hosts.includes(url.hostname)) return undefined; return value; } catch { return undefined; }
}
const UNRESOLVED: State[] = ['SUBMITTING','UNKNOWN','ORDER_CREATED','PAYMENT_PENDING'];
const sameStore = (a: Store | undefined, b: Store) => Boolean(a && a.id === b.id && a.address === b.address && a.name === b.name && a.longitude === b.longitude && a.latitude === b.latitude);
export const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const equal = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const cents = (amount: unknown): number => {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) throw new CheckoutError(502, 'Merchant price missing or invalid');
  return Math.round(amount * 100);
};

export function parsePreview(data: any, store: Store, line: Line): Preview {
  const shop = data?.shopInfo, items = data?.productInfoList;
  if (shop?.deptId !== store.id || shop.deptName !== store.name || shop.address !== store.address || shop.longitude !== store.longitude || shop.latitude !== store.latitude || !Array.isArray(items) || items.length !== 1) throw new CheckoutError(502, 'Merchant store or product mismatch');
  const item = items[0];
  if (item.productId !== line.productId || item.skuCode !== line.skuCode || item.amount !== line.amount || typeof item.name !== 'string' || typeof item.additionDesc !== 'string') throw new CheckoutError(502, 'Merchant specification or quantity mismatch');
  if (!Array.isArray(data.couponCodeList) || !data.couponCodeList.every((code: unknown) => typeof code === 'string')) throw new CheckoutError(502, 'Merchant coupon data incomplete');
  const totalCents = cents(data.totalInitialPrice), discountCents = cents(data.privilegeMoney), finalCents = cents(data.discountPrice);
  if (totalCents - discountCents !== finalCents) throw new CheckoutError(502, 'Merchant amounts inconsistent');
  return { store: { ...store }, line: { ...line }, title: item.name, specification: item.additionDesc, totalCents, discountCents, finalCents, coupons: [...data.couponCodeList] };
}

export interface RealCheckoutAdapter {
  detail(store: Store, productId: number): Promise<any>;
  preview(store: Store, line: Line): Promise<any>;
  create(draft: Draft): Promise<any>;
  status(orderId: string): Promise<any>;
  verifiedPaymentState?(data: unknown): 'PAID' | 'PAYMENT_PENDING' | undefined;
}
export class LuckinRealCheckout extends LuckinGateway implements RealCheckoutAdapter {}
export interface Journal { load(): Transaction[]; save(tx: Transaction): void; }
export class FileJournal implements Journal {
  constructor(private dir: string) { mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir,0o700); }
  load(): Transaction[] { return readdirSync(this.dir).filter(name => /^[a-f0-9-]+\.json$/.test(name)).map(name => JSON.parse(readFileSync(join(this.dir, name), 'utf8'))); }
  save(tx: Transaction) {
    const file = join(this.dir, tx.id + '.json');
    const fd=openSync(file+'.tmp','w',0o600);
    try { writeFileSync(fd,JSON.stringify(tx)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(file + '.tmp', file);
    const directory=openSync(this.dir,'r'); try { fsyncSync(directory); } finally { closeSync(directory); }
  }
}

export class CheckoutService {
  private transactions = new Map<string, Transaction>();
  constructor(private adapter: RealCheckoutAdapter, private journal: Journal, private submissionsEnabled: boolean, private now = () => Date.now()) {
    for (const tx of journal.load()) {
      if (tx.state === 'PREVIEWED') { tx.state='FAILED'; tx.note='Interrupted read-only preview; select again'; journal.save(tx); }
      if (tx.state === 'SUBMITTING') { tx.state = 'UNKNOWN'; tx.confirmHash = undefined; tx.note = 'Interrupted submission: never retry creation'; tx.history.push({state:'UNKNOWN',at:new Date(this.now()).toISOString()}); journal.save(tx); }
      this.transactions.set(tx.id, tx);
    }
  }
  private move(tx: Transaction, state: State, note?: string) { tx.state = state; tx.note = note; tx.history.push({ state, at: new Date(this.now()).toISOString() }); this.journal.save(tx); }
  private get(owner: string, id: string): Transaction {
    const tx = this.transactions.get(id);
    if (!tx || tx.owner !== owner) throw new CheckoutError(404, 'Unknown transaction');
    if (['SELECTED','PREVIEWED','AWAITING_CONFIRMATION'].includes(tx.state) && tx.expiresAt <= this.now()) { tx.confirmHash = undefined; this.move(tx, 'EXPIRED', 'Preview expired; select and preview again'); }
    return tx;
  }
  invalidateStoreContext(owner: string) {
    if ([...this.transactions.values()].some(tx=>UNRESOLVED.includes(tx.state))) throw new CheckoutError(409,'Unresolved merchant transaction: store changes are blocked until reconciliation');
    for (const tx of this.transactions.values()) if (tx.owner===owner && ['SELECTED','PREVIEWED','AWAITING_CONFIRMATION'].includes(tx.state)) { tx.confirmHash=undefined; tx.preview=undefined; tx.fingerprint=undefined; this.move(tx,'EXPIRED','Pickup store context changed; select and preview again'); }
  }
  list(owner: string) { return [...this.transactions.values()].filter(tx=>tx.owner===owner).map(tx=>this.public(owner,tx.id)); }
  select(owner: string, selection: Selection) {
    for (const tx of this.transactions.values()) if (tx.owner === owner) this.get(owner,tx.id);
    if ([...this.transactions.values()].some(tx=>tx.owner!==owner && ['SUBMITTING','UNKNOWN','ORDER_CREATED','PAYMENT_PENDING'].includes(tx.state))) throw new CheckoutError(409,'An unresolved merchant submission exists; reconcile it before creating another order');
    const existing = [...this.transactions.values()].find(tx => tx.owner === owner && !['FAILED','EXPIRED','PAID'].includes(tx.state));
    if (existing) {
      if (existing.selection.entryId !== selection.entryId) throw new CheckoutError(409, 'Finish or resolve the existing transaction before selecting another item');
      return this.public(owner, existing.id);
    }
    const tx: Transaction = { id: crypto.randomUUID(), owner, state: 'SELECTED', selection: structuredClone(selection), expiresAt: this.now()+120_000, history: [{state:'SELECTED',at:new Date(this.now()).toISOString()}] };
    this.transactions.set(tx.id,tx); this.journal.save(tx);
    return this.public(owner,tx.id);
  }
  async preview(owner: string, id: string, amount: number) {
    const tx = this.get(owner,id);
    if (!['SELECTED','AWAITING_CONFIRMATION'].includes(tx.state)) throw new CheckoutError(409,'Transaction cannot be previewed in this state');
    if (!Number.isInteger(amount) || amount < 1 || amount > 5) throw new CheckoutError(400,'Quantity must be 1 to 5');
    // PREVIEWED acts as a preview lock; no confirmation token exists during the request.
    tx.confirmHash = undefined; this.move(tx,'PREVIEWED');
    try {
      const detail = await this.adapter.detail(tx.selection.store, tx.selection.productId);
      if (detail.productId !== tx.selection.productId || (typeof detail.skuCode !== 'string' || !detail.skuCode) || !Array.isArray(detail.productAttrs)) throw new CheckoutError(502,'Merchant default specification unavailable');
      const complete = detail.productAttrs.every((attr:any) => Array.isArray(attr.productSubAttrs) && attr.productSubAttrs.some((sub:any) => sub.selected === true && sub.canSelected === 1));
      if (!complete) throw new CheckoutError(502,'Merchant default SKU is incomplete or unavailable');
      const line = { productId: detail.productId, skuCode: detail.skuCode, amount };
      const preview = parsePreview(await this.adapter.preview(tx.selection.store,line),tx.selection.store,line);
      if (tx.state !== 'PREVIEWED') throw new CheckoutError(409,'Pickup store context changed during preview');
      tx.preview = preview; tx.fingerprint = fingerprint(preview); tx.expiresAt = this.now()+60_000;
      const confirmation = randomBytes(32).toString('base64url'); tx.confirmHash = fingerprint(confirmation);
      this.move(tx,'AWAITING_CONFIRMATION');
      return { ...this.public(owner,id), confirmation };
    } catch { if (tx.state==='EXPIRED') throw new CheckoutError(409,'Pickup store context changed during preview; discarded'); this.move(tx,'FAILED','Preview incomplete or merchant unavailable; no creation attempted'); throw new CheckoutError(502,tx.note!); }
  }
  public(owner: string,id: string) {
    const tx = this.get(owner,id);
    return { transaction_id:tx.id,state:tx.state,selection:{...tx.selection},preview:tx.preview ? {...tx.preview,coupons:undefined,coupon_count:tx.preview.coupons.length} : undefined, fingerprint:tx.fingerprint,expires_at:new Date(tx.expiresAt).toISOString(),order_id:tx.orderId,payment_url:verifiedPaymentUrl(tx.paymentUrl),created_final_cents:tx.createdFinalCents,price_changed:tx.priceChanged,merchant_status:tx.merchantStatus,note:tx.note,history:tx.history,submissions_enabled:this.submissionsEnabled };
  }
  async submit(owner: string, id: string, input: Record<string,unknown>, currentStore?: Store) {
    if (!this.submissionsEnabled) throw new CheckoutError(403,'Real submission disabled; preview only');
    const tx=this.get(owner,id), p=tx.preview;
    if (tx.state !== 'AWAITING_CONFIRMATION' || !p || !tx.confirmHash) throw new CheckoutError(409,'Confirmation already consumed or transaction not ready');
    if (!sameStore(currentStore,p.store)) { tx.confirmHash=undefined; this.move(tx,'EXPIRED','Current confirmed store does not match preview'); throw new CheckoutError(409,'Current confirmed store does not match preview store ID/address'); }
    if (input.confirmed !== true || input.store_confirmed !== true || input.intent !== 'CREATE_REAL_ORDER' || typeof input.confirmation !== 'string' || !equal(fingerprint(input.confirmation),tx.confirmHash) || input.fingerprint !== tx.fingerprint || input.store_id !== p.store.id || input.product_id !== p.line.productId || input.sku !== p.line.skuCode || input.quantity !== p.line.amount || input.final_cents !== p.finalCents) throw new CheckoutError(400,'Explicit confirmation does not match the immutable preview');
    if ([...this.transactions.values()].some(other=>other.id!==tx.id && ['SUBMITTING','UNKNOWN','ORDER_CREATED','PAYMENT_PENDING'].includes(other.state))) throw new CheckoutError(409,'Another merchant submission is pending or unknown');
    tx.confirmHash=undefined; this.move(tx,'SUBMITTING'); // persisted before any side effect; blocks concurrent/replay submissions
    try {
      const fresh=parsePreview(await this.adapter.preview(p.store,p.line),p.store,p.line);
      if (fingerprint(fresh) !== tx.fingerprint || tx.expiresAt <= this.now()) { this.move(tx,'EXPIRED','Quote changed or expired; a new preview and confirmation are required'); return this.public(owner,id); }
    } catch { this.move(tx,'FAILED','Preflight preview failed; no order created'); return this.public(owner,id); }
    let created: any;
    try { created=await this.adapter.create({store:p.store,line:p.line,coupons:p.coupons}); }
    catch { this.move(tx,'UNKNOWN','Creation outcome unknown. Do not retry; check merchant app/order ID'); return this.public(owner,id); }
    if (typeof created?.orderId !== 'string' || !created.orderId) { this.move(tx,'UNKNOWN','Merchant response has no documented order ID; do not retry'); return this.public(owner,id); }
    if (typeof created.discountPrice==='number') { try { tx.createdFinalCents=cents(created.discountPrice); tx.priceChanged=tx.createdFinalCents!==p.finalCents; } catch {} }
    tx.orderId=created.orderId; this.move(tx,'ORDER_CREATED','Order created; payment not confirmed');
    tx.paymentUrl=verifiedPaymentUrl(created.payOrderQrCodeUrl);
    if (tx.paymentUrl) this.move(tx,'PAYMENT_PENDING','Use the merchant payment entry yourself; creation is not payment');
    // One read-only query after creation. No creation retry, polling, payment or cancellation.
    return this.reconcile(owner,id);
  }
  async reconcile(owner:string,id:string, suppliedOrderId?:string) {
    const tx=this.get(owner,id);
    if (suppliedOrderId && !tx.orderId && tx.state==='UNKNOWN' && /^[A-Za-z0-9_-]{1,128}$/.test(suppliedOrderId)) tx.orderId=suppliedOrderId;
    if (!tx.orderId || !['UNKNOWN','ORDER_CREATED','PAYMENT_PENDING','PAID'].includes(tx.state)) throw new CheckoutError(409,'An order ID is required for read-only reconciliation');
    try {
      const data=await this.adapter.status(tx.orderId);
      tx.merchantStatus=sanitizeMerchantStatus(data);
      // No live order was created during development, so payment-status codes are unverified.
      // An injected adapter can provide a verified normalized state in tests; live raw fields are never guessed.
      if (this.adapter.verifiedPaymentState?.(data) === 'PAID') this.move(tx,'PAID','Merchant payment verified by a tested status mapper');
      else if (this.adapter.verifiedPaymentState?.(data) === 'PAYMENT_PENDING') this.move(tx,'PAYMENT_PENDING');
      else this.move(tx,'UNKNOWN','Order query returned; payment fields/codes need verification, inspect merchant status');
    } catch { this.move(tx,'UNKNOWN','Order query failed; do not retry creation'); }
    return this.public(owner,id);
  }
}

function sanitizeMerchantStatus(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(sanitizeMerchantStatus);
  if (input && typeof input==='object') return Object.fromEntries(Object.entries(input).filter(([key])=>!/(token|secret|coupon|phone|mobile|payOrder|payment.*url|__verified)/i.test(key)).map(([key,value])=>[key,sanitizeMerchantStatus(value)]));
  if (typeof input==='string') { let text=input; for(const key of ['LUCKIN_MCP_TOKEN','MCD_MCP_TOKEN']) if(process.env[key]) text=text.replaceAll(process.env[key]!, '[REDACTED]'); return text; }
  return input;
}
