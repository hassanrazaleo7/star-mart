import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { reportSheets, downloadExcel, downloadPdf } from '../src/lib/report-download.js';
const report = {
  from: '2026-10-01',
  to: '2026-10-14',
  totals: {
    bills: 2,
    salesPaisa: 25000,
    costPaisa: 15000,
    grossProfitPaisa: 10000,
    expensesPaisa: 1000,
    netPaisa: 9000,
    purchasesPaisa: 20000,
  },
  days: [{ day: '2026-10-14', bills: 2, total_paisa: 25000, discount_paisa: 0 }],
  payments: [{ payment: 'Cash', bills: 2, total_paisa: 25000 }],
  products: [],
  categories: [],
  expenses: [],
};
const products = [
  {
    id: 'one',
    name: 'Milk',
    barcode: '001234',
    category: 'Dairy',
    unit: 'piece',
    vendor_id: 'v',
    cost_paisa: 6000,
    price_paisa: 10000,
    stock_milli: 5000,
    reserved_milli: 2000,
    reorder_milli: 1000,
    vendor_available_milli: 10000,
    review_status: 'Approved',
    catalog_status: 'active',
  },
  { id: 'old', name: 'Deleted', deleted_at: '2026-10-01', stock_milli: 9000 },
];
test('Excel/PDF downloads have real file formats, separate products/stock and accurate numbers', async () => {
  const sheets = reportSheets({
    report,
    products,
    vendors: [{ id: 'v', name: 'Supplier' }],
    stock: p => Number(p.stock_milli),
  });
  assert.equal(sheets.find(s => s.name === 'Products').rows.length, 1);
  const stock = sheets.find(s => s.name === 'Stock').rows[0];
  assert.equal(stock[3], 5);
  assert.equal(stock[4], 2);
  assert.equal(stock[5], 3);
  assert.equal(stock[6], 10);
  assert.equal(sheets[0].rows.find(r => r[0] === 'Sales (Rs)')[1], 250);
  const downloads = [];
  globalThis.document = {
    body: { append() {} },
    createElement() {
      return { remove() {}, click() {} };
    },
  };
  const original = URL.createObjectURL;
  URL.createObjectURL = blob => {
    downloads.push(blob);
    return 'blob:test';
  };
  try {
    await downloadExcel(sheets, 'test');
    const buf = Buffer.from(await downloads[0].arrayBuffer());
    assert.equal(buf.subarray(0, 2).toString(), 'PK');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buf);
    assert.equal(workbook.getWorksheet('Stock').getCell('F2').value, 3);
    assert.equal(workbook.getWorksheet('Products').getCell('B2').value, '001234');
    // jsPDF saves through its own file saver in browsers; capture its Node output for format verification.
    const { jsPDF } = await import('jspdf');
    const save = jsPDF.API.save;
    let pdfBytes;
    jsPDF.API.save = function () {
      pdfBytes = this.output('arraybuffer');
      return this;
    };
    try {
      await downloadPdf(sheets, 'test');
      assert.equal(Buffer.from(pdfBytes).subarray(0, 4).toString(), '%PDF');
    } finally {
      jsPDF.API.save = save;
    }
  } finally {
    URL.createObjectURL = original;
    delete globalThis.document;
  }
});
