import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {db,init,close} from '../server/db.mjs';
import {placeOrder,changeOrder} from '../server/orders.mjs';
import {activityFeed} from '../server/activity.mjs';

test('wallet reference stays unverified until owner confirms; receipt and activity reflect collection',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'star-payments-'));process.env.STAR_MART_DATA_DIR=dir;
 try{
  await init();const c=await db();await c.query("INSERT INTO products(id,name,price_paisa,cost_paisa,sku) VALUES('p1','Rice',12500,8000,'RICE-1')");await c.query("INSERT INTO stock_movements(id,product_id,qty_milli,kind) VALUES('m1','p1',2000,'opening')");
  const customer={id:'c1',name:'Customer',email:'c@store.pk',phone:'03001234567'};
  await assert.rejects(()=>placeOrder(customer,{lines:[{productId:'p1',qty:1}],fulfillment:'Delivery',address:'Lahore',paymentMethod:'JazzCash transfer'}),/reference/);
  const order=await placeOrder(customer,{lines:[{productId:'p1',qty:1}],fulfillment:'Delivery',address:'Lahore',paymentMethod:'JazzCash transfer',paymentReference:'CUSTOMER-CLAIM'});
  let row=(await c.query('SELECT * FROM customer_orders WHERE id=$1',[order.id])).rows[0];assert.match(row.payment_status,/unverified/);assert.equal((await c.query('SELECT count(*) n FROM receipts')).rows[0].n,0);
  await assert.rejects(()=>changeOrder(order.id,'Fulfilled',{paymentCollected:true}),/confirmed/);
  await changeOrder(order.id,'Fulfilled',{paymentCollected:true,verifiedReference:'BANK-CHECKED-123'});
  row=(await c.query('SELECT * FROM customer_orders WHERE id=$1',[order.id])).rows[0];assert.equal(row.payment_status,'Verified · paid');assert.equal(row.verified_reference,'BANK-CHECKED-123');
  const receipt=(await c.query('SELECT * FROM receipts')).rows[0];assert.equal(receipt.payment,'JazzCash transfer');assert.equal(Number(receipt.received_paisa),12500);assert.ok((await activityFeed()).some(x=>x.entity==='customer_orders'&&x.entity_id===order.id&&x.action==='UPDATE'));
 }finally{await close();await rm(dir,{recursive:true,force:true})}
});
