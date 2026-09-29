import {db,tx} from './db.mjs';
import {id} from './auth.mjs';
import {paisa} from './money.mjs';
import {eligiblePoints} from './loyalty-policy.mjs';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const text=(value,max=120)=>String(value??'').trim().slice(0,max);

// One point per Rs 100 of the final bill. Credit purchases earn after full settlement.
export const earnedPoints=totalPaisa=>Math.floor(Number(totalPaisa)/10000);
export async function awardPoints(c,customerId,receiptId,totalPaisa){
  const items=(await c.query('SELECT qty_milli,line_total_paisa,cost_at_sale_paisa FROM sales WHERE receipt=$1',[receiptId])).rows;
  const grossProfit=items.reduce((sum,x)=>sum+Number(x.line_total_paisa)-Math.round(Number(x.qty_milli)*Number(x.cost_at_sale_paisa)/1000),0);
  const points=eligiblePoints(totalPaisa,grossProfit,items.length>0&&items.every(x=>Number(x.cost_at_sale_paisa)>0));
  if(!points)return 0;
  const exists=await c.query("SELECT id FROM loyalty_entries WHERE receipt_id=$1 AND kind='earned'",[receiptId]);
  if(exists.rows.length)return 0;
  await c.query("INSERT INTO loyalty_entries(id,customer_id,receipt_id,points,kind) VALUES($1,$2,$3,$4,'earned')",[id(),customerId,receiptId,points]);
  return points;
}
export async function pointsBalance(c,customerId){
  const result=await c.query('SELECT COALESCE(SUM(points),0) AS balance FROM loyalty_entries WHERE customer_id=$1',[customerId]);
  return Number(result.rows[0].balance);
}
export async function customerOverview(customerId){
  const c=await db();
  const [account,receipts,payments,points,orders]=await Promise.all([
    c.query('SELECT id,name,email,phone FROM customer_accounts WHERE id=$1',[customerId]),
    c.query('SELECT * FROM receipts WHERE customer_id=$1 ORDER BY created_at DESC',[customerId]),
    c.query('SELECT * FROM customer_credit_payments WHERE customer_id=$1 ORDER BY created_at DESC',[customerId]),
    c.query('SELECT * FROM loyalty_entries WHERE customer_id=$1 ORDER BY created_at DESC',[customerId]),
    c.query('SELECT id,total_paisa,status,fulfillment,created_at FROM customer_orders WHERE customer_uid=$1 ORDER BY created_at DESC LIMIT 100',[customerId])
  ]);
  if(!account.rows.length)throw fail('Customer not found',404);
  const ids=receipts.rows.map(r=>r.id);
  const lines=ids.length?(await c.query('SELECT s.receipt,s.product_id,p.name,s.qty_milli,s.line_total_paisa FROM sales s LEFT JOIN products p ON p.id=s.product_id WHERE s.receipt=ANY($1::text[]) ORDER BY s.created_at',[ids])).rows:[];
  const paymentByReceipt=new Map();
  for(const p of payments.rows)paymentByReceipt.set(p.receipt_id,(paymentByReceipt.get(p.receipt_id)||0)+Number(p.amount_paisa));
  const bills=receipts.rows.map(r=>{
    const total=Number(r.total_paisa),received=Math.min(total,Number(r.received_paisa)),settled=paymentByReceipt.get(r.id)||0;
    return {id:r.id,createdAt:r.created_at,totalPaisa:total,receivedPaisa:received,paidLaterPaisa:settled,duePaisa:Math.max(0,total-received-settled),payment:r.payment,discountPaisa:Number(r.discount_paisa),items:lines.filter(x=>x.receipt===r.id).map(x=>({name:x.name||'Product',qtyMilli:Number(x.qty_milli),totalPaisa:Number(x.line_total_paisa)}))};
  });
  const months=new Map();
  for(const b of bills){
    const month=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit'}).format(new Date(b.createdAt));
    const item=months.get(month)||{month,totalPaisa:0,bills:0,creditPaisa:0};
    item.totalPaisa+=b.totalPaisa;item.bills++;if(b.payment==='Credit')item.creditPaisa+=b.totalPaisa;months.set(month,item);
  }
  const balance=points.rows.reduce((n,p)=>n+Number(p.points),0);
  return {customer:account.rows[0],summary:{totalSpendPaisa:bills.reduce((n,b)=>n+b.totalPaisa,0),outstandingPaisa:bills.reduce((n,b)=>n+b.duePaisa,0),points:balance,billCount:bills.length},bills,monthly:[...months.values()].sort((a,b)=>b.month.localeCompare(a.month)),payments:payments.rows,pointsHistory:points.rows,orders:orders.rows,program:{earn:'1 point per Rs 100 on settled bills',redemption:'100 points = Rs 50 off on a later paid bill of Rs 3,000 or more at the counter, subject to eligible margin',minimumPoints:100,redeemStep:100,discountPaisa:5000}};
}
export async function listCustomers(){
  const c=await db();
  const r=await c.query('SELECT id,name,email,phone FROM customer_accounts ORDER BY name');
  return r.rows;
}
export async function collectCredit(body){
  const customerId=text(body.customerId),receiptId=text(body.receiptId),method=text(body.method),amount=paisa(body.amount,'Amount');
  if(!customerId||!receiptId||!amount)throw fail('Choose a customer, bill and positive amount');
  if(!['Cash','Card','Bank transfer'].includes(method))throw fail('Choose a payment method');
  return tx(async c=>{
    const receipt=(await c.query('SELECT * FROM receipts WHERE id=$1 AND customer_id=$2 FOR UPDATE',[receiptId,customerId])).rows[0];
    if(!receipt||receipt.payment!=='Credit')throw fail('Credit bill not found',404);
    const previous=Number((await c.query('SELECT COALESCE(SUM(amount_paisa),0) AS paid FROM customer_credit_payments WHERE receipt_id=$1',[receiptId])).rows[0].paid);
    const due=Number(receipt.total_paisa)-Math.min(Number(receipt.received_paisa),Number(receipt.total_paisa))-previous;
    if(amount>due)throw fail('Payment exceeds remaining bill amount');
    const paymentId=id();
    await c.query('INSERT INTO customer_credit_payments(id,customer_id,receipt_id,amount_paisa,method,reference) VALUES($1,$2,$3,$4,$5,$6)',[paymentId,customerId,receiptId,amount,method,text(body.reference)]);
    if(amount===due)await awardPoints(c,customerId,receiptId,receipt.total_paisa);
    return {id:paymentId,receiptId,amountPaisa:amount,remainingPaisa:due-amount};
  });
}
