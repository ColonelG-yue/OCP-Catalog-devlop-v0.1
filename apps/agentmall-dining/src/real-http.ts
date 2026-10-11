import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, chmodSync, readFileSync, writeFileSync, unlinkSync, openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { CheckoutError, CheckoutService, FileJournal, LuckinRealCheckout, type Journal, type RealCheckoutAdapter } from './real-checkout';
import { LuckinGateway, type Store } from './luckin-gateway';
import { mapLuckinProducts } from './providers';
import type { Product } from './products';

export class BrowserGate {
  private key: Buffer;
  private bootstrap: string | null;
  private bootstrapUntil = Date.now()+300_000;
  readonly origin: string;
  constructor(origin: string, private dir?: string, bootstrap?: string) {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('Real checkout requires loopback origin');
    this.origin=url.origin;
    if (dir) {
      mkdirSync(dir,{recursive:true,mode:0o700}); chmodSync(dir,0o700);
      const keyFile=resolve(dir,'session-key');
      if (!existsSync(keyFile)) writeFileSync(keyFile,randomBytes(32),{mode:0o600});
      this.key=readFileSync(keyFile);
    } else this.key=randomBytes(32);
    this.bootstrap=bootstrap ?? randomBytes(32).toString('base64url');
    if (dir) writeFileSync(resolve(dir,'browser-access.json'),JSON.stringify({origin:this.origin,code:this.bootstrap,expires_at:this.bootstrapUntil}),{mode:0o600});
  }
  private sign(value:string) { return createHmac('sha256',this.key).update(value).digest('base64url'); }
  private eq(a:string,b:string) { const x=Buffer.from(a),y=Buffer.from(b); return x.length===y.length && timingSafeEqual(x,y); }
  checkOrigin(request:Request) {
    if (new URL(request.url).origin !== this.origin || request.headers.get('origin') !== this.origin || ['cross-site','none'].includes(request.headers.get('sec-fetch-site') ?? '')) throw new CheckoutError(403,'Local same-origin browser required');
  }
  login(request:Request, code:unknown) {
    this.checkOrigin(request);
    if (typeof code!=='string' || !this.bootstrap || this.bootstrapUntil<Date.now() || !this.eq(code,this.bootstrap)) throw new CheckoutError(403,'Browser authorization invalid or already used');
    this.bootstrap=null;
    if (this.dir) try { unlinkSync(resolve(this.dir,'browser-access.json')); } catch {}
    try { const current=this.session(request); const cookie=request.headers.get('cookie')!.split(';').map(x=>x.trim()).find(x=>x.startsWith('agentmall_session='))!.slice('agentmall_session='.length); return {cookie,csrf:current.csrf}; } catch {}
    const value=randomBytes(24).toString('base64url')+'.'+(Date.now()+24*3600_000);
    const cookie=value+'.'+this.sign(value);
    return {cookie,csrf:this.sign('csrf:'+cookie)};
  }
  session(request:Request, mutation=false) {
    const origin=request.headers.get('origin');
    if (new URL(request.url).origin!==this.origin || (origin && origin!==this.origin) || request.headers.get('sec-fetch-site')==='cross-site') throw new CheckoutError(403,'Local browser required');
    const cookie=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('agentmall_session='))?.slice('agentmall_session='.length);
    const fields=cookie?.split('.');
    if (!cookie || fields?.length!==3 || !/^\d+$/.test(fields[1]!) || Number(fields[1])<=Date.now() || !this.eq(fields[2]!,this.sign(fields[0]+'.'+fields[1]))) throw new CheckoutError(401,'Authorize this browser with bun run open');
    const csrf=this.sign('csrf:'+cookie);
    if (mutation) { this.checkOrigin(request); if (!this.eq(request.headers.get('x-csrf-token') ?? '',csrf)) throw new CheckoutError(403,'CSRF validation failed'); }
    return {owner:this.sign('owner:'+cookie),csrf};
  }
}

export class RealRoutes {
  readonly checkout: CheckoutService;
  private stores=new Map<string,Map<number,Store>>();
  private selectedStores=new Map<string,Store>();
  constructor(readonly gate:BrowserGate, private gateway:Pick<LuckinGateway,'stores'|'search'>, adapter:RealCheckoutAdapter, journal:Journal, readonly enabled:boolean) { this.checkout=new CheckoutService(adapter,journal,enabled); }
  private json(body:unknown,status=200,headers?:HeadersInit) { return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store',...headers}}); }
  async route(request:Request):Promise<Response | null> {
    const {pathname}=new URL(request.url);
    if (!pathname.startsWith('/api/')) return null;
    try {
      if (pathname==='/api/session/login' && request.method==='POST') {
        const body=await request.json() as any;
        const auth=this.gate.login(request,body.bootstrap);
        return this.json({csrf:auth.csrf,submissions_enabled:this.enabled},200,{'set-cookie':`agentmall_session=${auth.cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`});
      }
      if (pathname==='/api/session' && request.method==='GET') {
        const session=this.gate.session(request);
        return this.json({csrf:session.csrf,submissions_enabled:this.enabled,store:this.selectedStores.get(session.owner),transactions:this.checkout.list(session.owner)});
      }
      const session=this.gate.session(request,true);
      if (request.method!=='POST') throw new CheckoutError(405,'POST required');
      const body=await request.json() as Record<string,unknown>;
      if (!body || typeof body!=='object' || Array.isArray(body)) throw new CheckoutError(400,'JSON object required');
      if (pathname==='/api/luckin/stores') {
        const longitude=body.longitude,latitude=body.latitude;
        if (typeof longitude!=='number'||longitude < -180||longitude >180||typeof latitude!=='number'||latitude < -90||latitude>90||!Number.isFinite(longitude)||!Number.isFinite(latitude)) throw new CheckoutError(400,'Provide explicit coordinates; no demo defaults');
        const stores=await this.gateway.stores(longitude,latitude,typeof body.name==='string'?body.name:undefined);
        this.stores.set(session.owner,new Map(stores.map(store=>[store.id,store])));
        return this.json({stores});
      }
      if (pathname==='/api/luckin/store/select') {
        const store=this.stores.get(session.owner)?.get(Number(body.store_id));
        if (!store || body.confirmed!==true) throw new CheckoutError(400,'Select and explicitly confirm a returned pickup store');
        this.selectedStores.set(session.owner,store);
        return this.json({store});
      }
      const match=pathname.match(/^\/api\/luckin\/transactions\/([a-f0-9-]+)\/(preview|submit|status)$/);
      if (!match) return this.json({error:{code:'not_found',message:'Unknown real route'}},404);
      const [,id,action]=match;
      if (action==='preview') return this.json(await this.checkout.preview(session.owner,id!,Number(body.quantity)));
      if (action==='submit') return this.json(await this.checkout.submit(session.owner,id!,body));
      return this.json(await this.checkout.reconcile(session.owner,id!,typeof body.order_id==='string'?body.order_id:undefined));
    } catch (error) {
      const known=error instanceof CheckoutError;
      return this.json({error:{code:'checkout_error',message:known?error.message:'Merchant unavailable or invalid request; no creation retry'}},known?error.status:502);
    }
  }
  async queryProducts(request:Request, keyword:string):Promise<Product[] | null> {
    if (request.headers.get('x-agentmall-flow')!=='real') return null;
    const session=this.gate.session(request,true);
    const store=this.selectedStores.get(session.owner);
    if (!store) throw new CheckoutError(400,'Confirm a pickup store first');
    const raw=await this.gateway.search(store,keyword||'咖啡');
    return mapLuckinProducts(raw,{deptId:store.id,deptName:store.name,address:store.address},new Date().toISOString());
  }
  bind(request:Request,product:Product) {
    if (request.headers.get('x-agentmall-flow')!=='real') return null;
    const session=this.gate.session(request,true);
    const store=this.selectedStores.get(session.owner);
    if (!store || product.provider_id!=='luckin'||product.source!=='LIVE'||String(store.id)!==product.store?.id||!Number.isInteger(product.merchant_product_id)) throw new CheckoutError(400,'Product does not belong to the explicitly confirmed store');
    return this.checkout.select(session.owner,{entryId:`entry_${product.provider_id}_${product.id}`,productId:product.merchant_product_id!,title:product.title,store});
  }
}

export function createRealRuntime(origin:string,dir=resolve(import.meta.dir,'../.agentmall-state')) {
  const enabled=process.env.AGENTMALL_ENABLE_REAL_ORDERS==='1' && process.env.AGENTMALL_TEST_MODE!=='1' && process.env.AGENTMALL_DATA_MODE!=='mock' && process.env.NODE_ENV==='production';
  mkdirSync(dir,{recursive:true,mode:0o700});
  const lock=resolve(dir,'runtime-lock');
  if (existsSync(lock)) {
    const pid=Number(readFileSync(lock,'utf8'));
    let active=false; try { if(Number.isInteger(pid) && pid>0) { process.kill(pid,0); active=true; } else active=true; } catch (error) { active=(error as NodeJS.ErrnoException).code !== 'ESRCH'; }
    if(active) throw new Error('Another local checkout runtime is active; stop it before restarting');
    unlinkSync(lock);
  }
  const fd=openSync(lock,'wx',0o600); try { writeFileSync(fd,String(process.pid)); } finally { closeSync(fd); }
  process.once('exit',()=>{try { if(readFileSync(lock,'utf8')===String(process.pid)) unlinkSync(lock); } catch {}});
  const gateway=new LuckinRealCheckout(undefined,enabled);
  return new RealRoutes(new BrowserGate(origin,dir),gateway,gateway,new FileJournal(resolve(dir,'transactions')),enabled);
}
