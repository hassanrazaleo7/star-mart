export function reportSheets({ report, products = [], vendors = [], stock }) {
  const money = n => Number(n || 0) / 100,
    qty = n => Number(n || 0) / 1000;
  const live = products.filter(p => !p.deleted_at),
    vendor = p => vendors.find(v => v.id === p.vendor_id)?.name || 'Store / unassigned';
  const t = report.totals;
  return [
    {
      name: 'Summary',
      headers: ['Measure', 'Value', 'Basis'],
      rows: [
        ['Report start', report.from, 'Pakistan local dates'],
        ['Report end', report.to, 'Inclusive'],
        ['Bills', t.bills, 'Completed sales'],
        ['Sales (Rs)', money(t.salesPaisa), 'Period'],
        ['Cost (Rs)', money(t.costPaisa), 'Recorded cost at sale'],
        ['Gross margin (Rs)', money(t.grossProfitPaisa), 'Sales minus cost'],
        ['Expenses (Rs)', money(t.expensesPaisa), 'Period'],
        ['Net estimate (Rs)', money(t.netPaisa), 'Before unrecorded costs/tax'],
        ['Purchases (Rs)', money(t.purchasesPaisa), 'Period'],
        [
          'Current stock value (Rs)',
          live.reduce((n, p) => n + Math.round((stock(p) * Number(p.cost_paisa)) / 1000), 0) / 100,
          'Current snapshot; last recorded cost',
        ],
      ],
    },
    {
      name: 'Daily sales',
      headers: ['Date', 'Bills', 'Total (Rs)', 'Discount (Rs)'],
      rows: report.days.map(x => [x.day, x.bills, money(x.total_paisa), money(x.discount_paisa)]),
    },
    {
      name: 'Payment methods',
      headers: ['Method', 'Bills', 'Total (Rs)'],
      rows: report.payments.map(x => [x.payment, x.bills, money(x.total_paisa)]),
    },
    {
      name: 'Top selling products',
      headers: ['Product', 'Sold units', 'Sales (Rs)', 'Margin (Rs)'],
      rows: report.products.map(x => [
        products.find(p => p.id === x.product_id)?.name || x.name || x.product_id,
        qty(x.qty_milli),
        money(x.total_paisa),
        money(x.profit_paisa),
      ]),
    },
    {
      name: 'Categories',
      headers: ['Category', 'Sold units', 'Sales (Rs)'],
      rows: report.categories.map(x => [x.category, qty(x.qty_milli), money(x.total_paisa)]),
    },
    {
      name: 'Expenses',
      headers: ['Category', 'Amount (Rs)'],
      rows: report.expenses.map(x => [x.category, money(x.total_paisa)]),
    },
    {
      name: 'Products',
      headers: [
        'Product',
        'Barcode',
        'Category',
        'Vendor',
        'Unit',
        'Pack',
        'Purchase price (Rs)',
        'Sale price (Rs)',
        'Website status',
        'Review status',
      ],
      rows: live.map(p => [
        p.name,
        p.barcode || '',
        p.category,
        vendor(p),
        p.unit,
        p.pack_size,
        money(p.cost_paisa),
        money(p.price_paisa),
        p.catalog_status,
        p.review_status,
      ]),
    },
    {
      name: 'Stock',
      headers: [
        'Product',
        'Barcode',
        'Vendor',
        'In store',
        'Reserved',
        'Available',
        'Supplier availability',
        'Reorder level',
        'Status',
      ],
      rows: live.map(p => {
        const actual = stock(p),
          reserved = Number(p.reserved_milli || 0);
        return [
          p.name,
          p.barcode || '',
          vendor(p),
          qty(actual),
          qty(reserved),
          qty(actual - reserved),
          qty(p.vendor_available_milli),
          qty(p.reorder_milli),
          p.review_status !== 'Approved'
            ? 'Pending verification'
            : actual - reserved <= 0
              ? 'Out of stock'
              : actual <= Number(p.reorder_milli)
                ? 'Low stock'
                : 'Available',
        ];
      }),
    },
  ];
}
function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function downloadExcel(sheets, range) {
  const module = await import('exceljs'),
    ExcelJS = module.default || module,
    book = new ExcelJS.Workbook();
  book.creator = 'Star Mart';
  book.created = new Date();
  for (const s of sheets) {
    const w = book.addWorksheet(s.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    w.columns = s.headers.map(h => ({
      header: h,
      width: Math.min(42, Math.max(20, h.length + 5)),
    }));
    s.rows.forEach(row => {
      const r = w.addRow(row.map(x => x ?? ''));
      r.eachCell((cell, col) => {
        if (typeof cell.value === 'number')
          cell.numFmt =
            s.headers[col - 1].includes('(Rs)') ||
            (s.name === 'Summary' && String(row[0]).includes('(Rs)'))
              ? '#,##0.00;[Red]-#,##0.00'
              : '0.###';
      });
    });
    const header = w.getRow(1);
    header.height = 28;
    header.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00745C' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle' };
    });
    w.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, w.rowCount), column: s.headers.length },
    };
    w.eachRow((r, i) => {
      if (i === 1) return;
      r.height = 24;
      r.eachCell(c => {
        c.alignment = { vertical: 'middle', wrapText: true };
        if (i % 2 === 0)
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F6F1' } };
      });
    });
  }
  download(
    new Blob([await book.xlsx.writeBuffer()], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    'Star-Mart-' + range + '.xlsx'
  );
}
export async function downloadPdf(sheets, range) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  for (let i = 0; i < sheets.length; i++) {
    if (i) pdf.addPage();
    const s = sheets[i];
    pdf.setFillColor(0, 116, 92);
    pdf.rect(0, 0, 297, 24, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(17);
    pdf.text('Star Mart | ' + s.name, 14, 15);
    pdf.setTextColor(55, 70, 60);
    pdf.setFontSize(9);
    pdf.text(
      'Report: ' +
        range +
        ' | Generated: ' +
        new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }),
      14,
      31
    );
    autoTable(pdf, {
      startY: 37,
      head: [s.headers],
      body: s.rows.map(r =>
        r.map(x =>
          typeof x === 'number'
            ? x.toLocaleString('en-PK', { maximumFractionDigits: 2 })
            : String(x ?? '')
        )
      ),
      styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
      headStyles: { fillColor: [0, 116, 92] },
      alternateRowStyles: { fillColor: [242, 247, 243] },
      margin: { top: 15, bottom: 15, left: 14, right: 14 },
    });
  }
  const pages = pdf.getNumberOfPages();
  for (let n = 1; n <= pages; n++) {
    pdf.setPage(n);
    pdf.setFontSize(8);
    pdf.setTextColor(90, 100, 92);
    pdf.text('Star Mart - Confidential | Page ' + n + ' of ' + pages, 14, 203);
  }
  pdf.save('Star-Mart-' + range + '.pdf');
}
