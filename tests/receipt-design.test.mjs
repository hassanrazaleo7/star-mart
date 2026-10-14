import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptHtml } from '../src/lib/receipt.js';
test('printed receipt escapes product data and displays accurate credit balance or cash change',()=>{
 const r={receipt:'SM001',cashier:'Ali',customer:'<script>bad</script>',payment:'Credit',createdAt:'2026-10-14T09:00:00Z',lines:[{name:'Milk & Bread',qty:2000,unitPrice:5000,total:10000}],subtotal:10000,discount:0,tax:0,total:10000,received:3000};
 const html=receiptHtml(r,{logo:'https://example.com/logo.png',address:'Lahore'});
 assert.ok(html.includes('Balance due'));assert.ok(html.includes('Rs 70'));assert.ok(html.includes('2 × Rs 50'));assert.ok(html.includes('Milk &amp; Bread'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('Cashier'));assert.ok(html.includes('Lahore'));
 const paid=receiptHtml({...r,payment:'Cash',received:15000});assert.ok(paid.includes('Change'));assert.ok(paid.includes('Rs 50'));assert.ok(!paid.includes('Balance due'));
});
