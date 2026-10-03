import {tx} from './db.mjs';
import {id} from './auth.mjs';
import {wholeQuantity} from './money.mjs';
const fail=(m,status=400)=>Object.assign(new Error(m),{status});
export async function catalogAction(b){
 const {ids,action}=b;
 if(!Array.isArray(ids)||!ids.length||ids.length>500||ids.some(x=>typeof x!=='string')||new Set(ids).size!==ids.length)throw fail('Select 1–500 unique products');
 if(!['hide','show','archive','delete'].includes(action))throw fail('Unknown product action');
 return tx(async c=>{
  let products=(await c.query('SELECT id,name FROM products WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',[ids])).rows;
  if(products.length!==ids.length)throw fail('Some products no longer exist. Refresh the catalog.',409);
  if(action==='delete'){
   let pending=(await c.query("SELECT DISTINCT o.id FROM customer_order_items i JOIN customer_orders o ON o.id=i.order_id WHERE i.product_id=ANY($1::text[]) AND o.status='Pending'",[ids])).rows;
   if(pending.length)throw Object.assign(fail('Pending orders reserve this product. Cancel those orders to delete it.',409),{pendingOrders:pending.map(x=>x.id)});
   await c.query("UPDATE products SET deleted_at=NOW(),catalog_status='archived',updated_at=NOW() WHERE id=ANY($1::text[])",[ids]);
   return {changed:ids.length,deleted:ids.length,skipped:[],message:'Removed from the active catalog. Existing stock and financial history are preserved in records.'};
  }
  await c.query('UPDATE products SET catalog_status=$1,deleted_at=CASE WHEN $1=\'active\' THEN NULL ELSE deleted_at END,updated_at=NOW() WHERE id=ANY($2::text[])',[{hide:'hidden',show:'active',archive:'archived'}[action],ids]);
  return {changed:ids.length,deleted:0,skipped:[]};
 });
}
export async function setStock(productId,b){
 const target=wholeQuantity(b.quantity,'Stock'),note=String(b.note||'').trim().slice(0,1000);
 if(!note)throw fail('Enter a reason for the stock correction');
 return tx(async c=>{
  let p=(await c.query('SELECT * FROM products WHERE id=$1 FOR UPDATE',[productId])).rows[0];
  if(!p||p.deleted_at)throw fail('Product not found',404);
  let current=Number((await c.query('SELECT COALESCE(SUM(qty_milli),0) qty FROM stock_movements WHERE product_id=$1',[productId])).rows[0].qty);
  let held=Number((await c.query("SELECT COALESCE(SUM(i.qty_milli),0) qty FROM customer_order_items i JOIN customer_orders o ON o.id=i.order_id WHERE i.product_id=$1 AND o.status='Pending'",[productId])).rows[0].qty);
  if(target<held)throw fail('Complete or cancel reserved orders before reducing this stock');
  const change=target-current;
  if(change){let aid=id();await c.query("INSERT INTO adjustments(id,product_id,qty_milli,reason,note) VALUES($1,$2,$3,'Physical count',$4)",[aid,productId,change,note]);await c.query("INSERT INTO stock_movements(id,product_id,qty_milli,kind,ref_id,reason,note) VALUES($1,$2,$3,'adjustment',$4,'Physical count',$5)",[id(),productId,change,aid,note]);await c.query('UPDATE products SET updated_at=NOW() WHERE id=$1',[productId]);}
  return {id:productId,stockMilli:target,changed:change!==0};
 });
}
