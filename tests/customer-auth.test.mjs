import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {handle} from '../server/api.mjs';
import {db,close} from '../server/db.mjs';

async function call(path,method='GET',payload,cookie=''){
  const data=payload?Buffer.from(JSON.stringify(payload)):Buffer.alloc(0);
  const req=Readable.from(data.length?[data]:[]);
  req.url='/api'+path;req.method=method;req.headers={cookie,host:'localhost:8787'};
  let status,headers,output='';
  const res={writeHead(s,h){status=s;headers=h},end(x){output+=x||''}};
  await handle(req,res);
  return {status,headers,body:JSON.parse(output)};
}
test('customer signup, protected orders, login and logout persist on the database',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'star-customer-'));
  process.env.STAR_MART_DATA_DIR=dir;
  try{
    const signup=await call('/customer/signup','POST',{name:'Hassan',email:'Hassan@Example.com',phone:'03035559672',password:'strong-pass-123'});
    assert.equal(signup.status,201,JSON.stringify(signup.body));
    const cookie=signup.headers['set-cookie'].split(';')[0];
    assert.match(cookie,/^sm_customer=/);
    assert.equal((await call('/customer/me')).status,401);
    assert.equal((await call('/customer/me','GET',null,cookie)).body.user.email,'hassan@example.com');
    assert.equal((await call('/customer/signup','POST',{name:'Again',email:'hassan@example.com',password:'strong-pass-123'})).status,409);
    const database=await db();
    await database.query("INSERT INTO products(id,name,price_paisa,cost_paisa) VALUES('p1','Rice',12500,8000)");
    await database.query("INSERT INTO stock_movements(id,product_id,qty_milli,kind) VALUES('m1','p1',3000,'opening')");
    const order=await call('/customer/orders','POST',{lines:[{productId:'p1',qty:1}],phone:'03035559672',fulfillment:'Pickup'},cookie);
    assert.equal(order.status,201,JSON.stringify(order.body));
    assert.equal((await call('/customer/orders','GET',null,cookie)).body.orders.length,1);
    assert.equal((await call('/customer/login','POST',{email:'hassan@example.com',password:'wrong'})).status,401);
    const login=await call('/customer/login','POST',{email:'hassan@example.com',password:'strong-pass-123'});
    assert.equal(login.status,200);
    assert.equal((await call('/customer/orders','GET',null,login.headers['set-cookie'].split(';')[0])).body.orders.length,1);
    await call('/customer/logout','POST',null,cookie);
    assert.equal((await call('/customer/me','GET',null,cookie)).status,401);
  }finally{await close();await rm(dir,{recursive:true,force:true})}
});
