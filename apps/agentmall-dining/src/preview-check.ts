import { LuckinGateway } from './luckin-gateway';
import { CheckoutService, type Journal, type Transaction } from './real-checkout';
// CLI evidence is preview-only. It cannot dispatch createOrder or authorize a browser transaction.
async function main() {
const gateway=new LuckinGateway(undefined,false);
const stores=await gateway.stores(120.1551,30.2741);
const store=stores[0];if(!store)throw new Error('No preview demonstration store');
const products=await gateway.search(store,'生椰拿铁');const product=products.find(item=>Number.isInteger(item.productId));if(!product)throw new Error('No preview candidate');
const memory:Journal={load:()=>[],save:(_tx:Transaction)=>{}};
const service=new CheckoutService(gateway,memory,false);
const tx=service.select('preview-evidence-only',{entryId:'preview-only',productId:product.productId,title:product.productName,store});
const preview=await service.preview('preview-evidence-only',tx.transaction_id,1);
const evidence={checked_at:new Date().toISOString(),purpose:'READ_ONLY_PREVIEW_EVIDENCE',user_pickup_store_approved:false,creation_enabled:false,order_created:false,store:preview.preview!.store,product:preview.preview!.title,specification:preview.preview!.specification,line:preview.preview!.line,total_cents:preview.preview!.totalCents,discount_cents:preview.preview!.discountCents,final_cents:preview.preview!.finalCents,coupon_count:preview.preview!.coupon_count};
await Bun.write(new URL('../docs/luckin-preview-evidence.json',import.meta.url),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));

}
try { await main(); } catch { console.error('LIVE preview failed; no order creation attempted; merchant errors withheld'); process.exitCode=1; }
