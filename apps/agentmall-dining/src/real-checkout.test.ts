import { test, expect, afterEach } from 'bun:test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CheckoutService, FileJournal, type Journal, type Transaction } from './real-checkout';
import { LuckinGateway, type Connection, type ToolClient } from './luckin-gateway';
import { BrowserGate, RealRoutes } from './real-http';
import { handle, installRealRoutes } from './server';
import { resolvableReferenceSchema } from '@ocp-catalog/ocp-schema';

const store={id:42,name:'FAKE pickup store',address:'FAKE address',longitude:121,latitude:31};
const selection={entryId:'entry_luckin_42-123-FAKE-SKU',productId:123,title:'FAKE latte',store};
class MemoryJournal implements Journal {
  records=new Map<string,Transaction>();
  load(){return structuredClone([...this.records.values()]);}
  save(tx:Transaction){this.records.set(tx.id,structuredClone(tx));}
}
class MockMcpClient {
  calls:{name:string;arguments:any}[]=[];
  price=20;coupons:string[]=['FAKE-COUPON'];sku='FAKE-SKU';createFailure=false;created:any={orderId:'FAKE_ORDER',payOrderQrCodeUrl:'https://example.invalid/qr.png'};
  beforeCreate?:()=>Promise<void>;
  statusData:any={orderId:'FAKE_ORDER',fake_payment:'PAID'};
  tools=JSON.parse(readFileSync(new URL('../docs/luckin-tools.json',import.meta.url),'utf8')).tools;
  async listTools(){return {tools:this.tools};}
  async callTool(params:any){
    this.calls.push(structuredClone(params));
    const a=params.arguments;
    let data:any;
    if(params.name==='queryShopList')data=[{deptId:store.id,deptName:store.name,address:store.address,longitude:store.longitude,latitude:store.latitude,workStatus:'营业中'}];
    else if(params.name==='searchProductForMcp')data=[{productId:123,skuCode:this.sku,productName:'FAKE latte',estimatePrice:this.price}];
    else if(params.name==='queryProductDetailInfo')data={productId:123,skuCode:this.sku,productAttrs:[{attributeName:'FAKE temperature',productSubAttrs:[{selected:true,canSelected:1}]}]};
    else if(params.name==='previewOrder')data={shopInfo:{deptId:store.id,deptName:store.name,address:store.address,longitude:store.longitude,latitude:store.latitude},productInfoList:[{...a.productList[0],name:'FAKE latte',additionDesc:'FAKE default specification'}],totalInitialPrice:this.price,privilegeMoney:0,discountPrice:this.price,couponCodeList:[...this.coupons]};
    else if(params.name==='createOrder'){if(this.beforeCreate)await this.beforeCreate();if(this.createFailure)throw new Error('FAKE timeout after dispatch');data=this.created;}
    else if(params.name==='queryOrderDetailInfo')data=this.statusData;
    else throw new Error('Unexpected test tool');
    return {content:[{type:'text',text:JSON.stringify({success:true,code:200,data})}]};
  }
  get creationCalls(){return this.calls.filter(call=>call.name==='createOrder');}
}
function setup(enabled=true, journal:Journal=new MemoryJournal(),clock=()=>Date.now()) {
  const client=new MockMcpClient();
  const connection:Connection=async work=>work(client as unknown as ToolClient);
  const gateway=new LuckinGateway(connection,enabled,'mock');
  const adapter=Object.assign(gateway,{verifiedPaymentState:(data:any)=>data.fake_payment==='PAID'?'PAID' as const:undefined});
  const service=new CheckoutService(adapter,journal,enabled,clock);
  return {client,gateway,adapter,service,journal};
}
async function ready(service:CheckoutService,owner='owner') {
  const tx=service.select(owner,selection);
  return service.preview(owner,tx.transaction_id,1);
}
const input=(tx:Awaited<ReturnType<CheckoutService['preview']>>):Record<string,unknown>=>({confirmation:tx.confirmation,fingerprint:tx.fingerprint,confirmed:true,store_confirmed:true,intent:'CREATE_REAL_ORDER',store_id:tx.preview!.store.id,product_id:tx.preview!.line.productId,sku:tx.preview!.line.skuCode,quantity:tx.preview!.line.amount,final_cents:tx.preview!.finalCents});
afterEach(()=>installRealRoutes());

test('preview calls only fake detail/preview MCP and carries exact quantity/specification/quote',async()=>{
  const {client,service}=setup(false);const tx=await ready(service);
  expect(tx.state).toBe('AWAITING_CONFIRMATION');expect(tx.preview?.finalCents).toBe(2000);expect(tx.preview?.coupon_count).toBe(1);
  expect(client.calls.map(call=>call.name)).toEqual(['queryProductDetailInfo','previewOrder']);expect(client.creationCalls.length).toBe(0);
  expect(tx.history.map(item=>item.state)).toEqual(['SELECTED','PREVIEWED','AWAITING_CONFIRMATION']);
  await expect(service.submit('owner',tx.transaction_id,input(tx))).rejects.toThrow('disabled');expect(client.creationCalls.length).toBe(0);
});
test('real SDK creation is hard-disabled in the automated test process',async()=>{
  // No mock connection: proves the real SDK path stops before networking, regardless of merchant Token.
  const live=new LuckinGateway(undefined,true);
  await expect(live.create({store,line:{productId:123,skuCode:'FAKE-SKU',amount:1},coupons:[]})).rejects.toThrow('disabled');
});
test('all immutable fields and explicit confirmation are required; another owner cannot submit',async()=>{
  const {client,service}=setup();const tx=await ready(service);
  for(const alteration of [{confirmed:false},{store_confirmed:false},{intent:'AUTO'},{confirmation:'wrong'},{fingerprint:'wrong'},{store_id:43},{product_id:124},{sku:'wrong'},{quantity:2},{final_cents:1}])await expect(service.submit('owner',tx.transaction_id,{...input(tx),...alteration})).rejects.toThrow();
  await expect(service.submit('other',tx.transaction_id,input(tx))).rejects.toThrow('Unknown');expect(client.creationCalls.length).toBe(0);
});
test('fake successful submission uses exact preview parameters/coupons and verifies status',async()=>{
  const {client,service}=setup();const tx=await ready(service);const result=await service.submit('owner',tx.transaction_id,input(tx));
  expect(result.state).toBe('PAID');expect(result.order_id).toBe('FAKE_ORDER');expect(client.creationCalls.length).toBe(1);
  expect(client.creationCalls[0]?.arguments).toEqual({deptId:42,productList:[{productId:123,skuCode:'FAKE-SKU',amount:1}],longitude:121,latitude:31,couponCodeList:['FAKE-COUPON']});
  expect(client.calls.at(-1)?.name).toBe('queryOrderDetailInfo');
  await expect(service.submit('owner',tx.transaction_id,input(tx))).rejects.toThrow();expect(client.creationCalls.length).toBe(1);
});
test('concurrent confirmation dispatches only one fake create call',async()=>{
  const {client,service}=setup();const tx=await ready(service);
  let release!:()=>void;client.beforeCreate=()=>new Promise<void>(resolve=>{release=resolve});
  const first=service.submit('owner',tx.transaction_id,input(tx));
  await expect(service.submit('owner',tx.transaction_id,input(tx))).rejects.toThrow();
  while(!release)await new Promise(resolve=>setTimeout(resolve,1));release();await first;expect(client.creationCalls.length).toBe(1);
});
test('changed quote or coupons expire confirmation before any create dispatch',async()=>{
  for(const change of ['price','coupons']){const {client,service}=setup();const tx=await ready(service);if(change==='price')client.price=21;else client.coupons=['OTHER-FAKE'];const result=await service.submit('owner',tx.transaction_id,input(tx));expect(result.state).toBe('EXPIRED');expect(client.creationCalls.length).toBe(0);}
});
test('expired confirmation never reaches merchant create',async()=>{
  let time=Date.now();const {client,service}=setup(true,new MemoryJournal(),()=>time);const tx=await ready(service);time+=61_000;
  await expect(service.submit('owner',tx.transaction_id,input(tx))).rejects.toThrow();expect(service.public('owner',tx.transaction_id).state).toBe('EXPIRED');expect(client.creationCalls.length).toBe(0);
});
test('timeout or ambiguous response is UNKNOWN and never auto-retried',async()=>{
  for(const failure of ['timeout','shape']){const {client,service}=setup();const tx=await ready(service);if(failure==='timeout')client.createFailure=true;else client.created={unrecognized:'response'};const result=await service.submit('owner',tx.transaction_id,input(tx));expect(result.state).toBe('UNKNOWN');await expect(service.submit('owner',tx.transaction_id,input(tx))).rejects.toThrow();expect(client.creationCalls.length).toBe(1);}
});
test('unknown payment fields cannot assert PAID, even after order creation',async()=>{
  const {client,gateway,journal}=setup();client.statusData={status:999,__verifiedPaymentState:'PAID'};
  const service=new CheckoutService(gateway,journal,true);const tx=await ready(service);const result=await service.submit('owner',tx.transaction_id,input(tx));expect(result.state).toBe('UNKNOWN');expect(result.payment_url).toBe('https://example.invalid/qr.png');
});
test('persistent SUBMITTING recovery becomes UNKNOWN without a new create call',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'agentmall-journal-'));
  try{const journal=new FileJournal(dir);const {service,adapter,client}=setup(true,journal);const tx=await ready(service);const record=journal.load()[0]!;record.state='SUBMITTING';journal.save(record);const restored=new CheckoutService(adapter,new FileJournal(dir),true);expect(restored.public('owner',tx.transaction_id).state).toBe('UNKNOWN');expect(client.creationCalls.length).toBe(0);await expect(restored.submit('owner',tx.transaction_id,input(tx))).rejects.toThrow();}finally{rmSync(dir,{recursive:true,force:true});}
});
test('browser bootstrap is one-use, signed cookie and Origin/CSRF are required',async()=>{
  const gate=new BrowserGate('http://127.0.0.1:4400',undefined,'FAKE_BOOTSTRAP');
  const loginReq=new Request('http://127.0.0.1:4400/api/session/login',{method:'POST',headers:{origin:'http://127.0.0.1:4400'}});
  const auth=gate.login(loginReq,'FAKE_BOOTSTRAP');expect(()=>gate.login(loginReq,'FAKE_BOOTSTRAP')).toThrow();
  const request=(origin:string,csrf:string,cookie=auth.cookie)=>new Request('http://127.0.0.1:4400/api/submit',{method:'POST',headers:{origin,'x-csrf-token':csrf,cookie:'agentmall_session='+cookie}});
  expect(()=>gate.session(request('https://evil.invalid',auth.csrf),true)).toThrow();expect(()=>gate.session(request('http://127.0.0.1:4400','wrong'),true)).toThrow();expect(()=>gate.session(request('http://127.0.0.1:4400',auth.csrf,'tampered'),true)).toThrow();expect(gate.session(request('http://127.0.0.1:4400',auth.csrf),true).owner).toBeTruthy();
});
test('authorized fake HTTP flow goes through OCP Query/Resolve; missing store consent is rejected',async()=>{
  const {gateway,adapter,journal,client}=setup(false);const gate=new BrowserGate('http://127.0.0.1:4400',undefined,'FAKE_BOOTSTRAP');
  const routes=new RealRoutes(gate,gateway,adapter,journal,false);installRealRoutes(routes);
  const login=await handle(new Request('http://127.0.0.1:4400/api/session/login',{method:'POST',headers:{origin:'http://127.0.0.1:4400','content-type':'application/json'},body:JSON.stringify({bootstrap:'FAKE_BOOTSTRAP'})}));
  const auth=await login.json() as any;const cookie=login.headers.get('set-cookie')!.split(';')[0]!;
  const post=(path:string,body:unknown,real=false)=>handle(new Request('http://127.0.0.1:4400'+path,{method:'POST',headers:{origin:'http://127.0.0.1:4400','x-csrf-token':auth.csrf,cookie,'content-type':'application/json',...(real?{'x-agentmall-flow':'real'}:{})},body:JSON.stringify(body)}));
  expect((await post('/api/luckin/stores',{})).status).toBe(400);
  expect((await post('/api/luckin/stores',{longitude:121,latitude:31})).status).toBe(200);
  expect((await post('/api/luckin/store/select',{store_id:42})).status).toBe(400);
  expect((await post('/api/luckin/store/select',{store_id:42,confirmed:true})).status).toBe(200);
  const products=await (await post('/ocp/query',{query_mode:'keyword',query:'FAKE',filters:{provider_id:'luckin'}},true)).json() as any;
  const ref=resolvableReferenceSchema.parse(await(await post('/ocp/resolve',{entry_id:products.entries[0].entry.entry_id,purpose:'checkout'},true)).json());
  expect(ref.action_bindings[0]?.action_type).toBe('workflow');expect(ref.action_bindings[0]?.requires_user_confirmation).toBe(true);expect(ref.visible_attributes.transaction_source).toBe('REAL_WORKFLOW');
  const preview=await(await post(new URL(ref.action_bindings[0]!.entrypoint.url).pathname,{quantity:1})).json() as any;
  expect(preview.state).toBe('AWAITING_CONFIRMATION');expect(preview.preview.store.address).toBe('FAKE address');expect(client.creationCalls.length).toBe(0);
  expect((await post('/api/luckin/transactions/'+preview.transaction_id+'/submit',input(preview))).status).toBe(403);expect(client.creationCalls.length).toBe(0);
});


test('unknown submission prevents a fresh browser session from starting a duplicate order',async()=>{
  const {client,service}=setup();const tx=await ready(service);client.createFailure=true;await service.submit('owner',tx.transaction_id,input(tx));
  expect(()=>service.select('new-browser-owner',selection)).toThrow('unresolved');expect(client.creationCalls.length).toBe(1);
});


import { assertMerchantToolPolicy } from './mcp-probe';
test('shared real SDK boundary rejects creation and cancellation in automated tests',()=>{
  for(const name of ['createOrder','create-order','mall-create-order','party-order-create','cancelOrder','cancel-order'])expect(()=>assertMerchantToolPolicy(name)).toThrow();
  expect(()=>assertMerchantToolPolicy('previewOrder')).not.toThrow();
});


test('a returned creation price change is exposed without automatic payment or cancellation',async()=>{
  const {client,gateway,journal}=setup();client.created.discountPrice=25;const service=new CheckoutService(gateway,journal,true);const tx=await ready(service);const result=await service.submit('owner',tx.transaction_id,input(tx));expect(result.created_final_cents).toBe(2500);expect(result.price_changed).toBe(true);expect(client.creationCalls.length).toBe(1);expect(client.calls.some(call=>call.name==='cancelOrder')).toBe(false);
});
