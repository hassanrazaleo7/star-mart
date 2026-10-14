import { db, tx } from './db.mjs';
import { fail } from './errors.mjs';
import { saveProduct, storeImage } from './catalog.mjs';
import { id } from './auth.mjs';
import { paisa, wholeQuantity, lineAmount } from './money.mjs';
import { str } from './validate.mjs';
export async function submissions(user) {
  const where = user.role === 'admin' ? '' : ' WHERE s.submitted_by=$1';
  const rows = (
    await (
      await db()
    ).query(
      `SELECT s.id,s.product_id,s.submitted_by,s.submitted_name,s.submitted_role,s.payload,s.status,s.note,s.created_at,s.reviewed_at,v.name AS vendor_name,(s.image_data IS NOT NULL) AS has_image,p.name,p.review_status,p.catalog_status,p.deleted_at FROM product_submissions s JOIN products p ON p.id=s.product_id LEFT JOIN vendors v ON v.id=p.vendor_id${where} ORDER BY s.created_at DESC LIMIT 500`,
      user.role === 'admin' ? [] : [user.id]
    )
  ).rows;
  return { submissions: rows };
}
export async function reviewSubmission(submissionId, b, user) {
  return tx(async c => {
    // Product then submission is the same lock order used by save/upload/delete.
    const initial = (
      await c.query('SELECT product_id FROM product_submissions WHERE id=$1', [submissionId])
    ).rows[0];
    if (!initial) throw fail('Submission not found', 404);
    const product = (
      await c.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [initial.product_id])
    ).rows[0];
    const s = (
      await c.query('SELECT * FROM product_submissions WHERE id=$1 FOR UPDATE', [submissionId])
    ).rows[0];
    if (s.status !== 'Pending') throw fail('This submission has already been reviewed.', 409);
    if (product.deleted_at) throw fail('This product has been deleted.', 409);
    const note = str(b.note, 1000);
    if (b.action === 'return') {
      if (!note) throw fail('Tell the submitter what needs correcting.');
      await c.query(
        "UPDATE product_submissions SET status='Returned',note=$1,reviewed_by=$2,reviewed_at=NOW() WHERE id=$3",
        [note, user.id, s.id]
      );
      if (product.review_status !== 'Approved')
        await c.query("UPDATE products SET review_status='Returned' WHERE id=$1", [product.id]);
      return { status: 'Returned' };
    }
    if (b.action !== 'approve') throw fail('Choose approve or return.');
    if (b.verified !== true)
      throw fail('Confirm that product details and received goods have been verified.');
    const qty = wholeQuantity(b.receivedQty ?? 0, 'Verified received quantity');
    if (!qty && paisa(b.paid ?? 0, 'Amount paid'))
      throw fail('Enter received stock before recording a supplier payment.');
    const payload = { ...s.payload, opening: 0 };
    if (b.price !== undefined && b.price !== '') payload.price = b.price;
    if (b.cost !== undefined && b.cost !== '') payload.cost = b.cost;
    await saveProduct(payload, product.id, user, c);
    if (s.image_data) await storeImage(c, product.id, s.image_data, s.image_mime);
    if (qty) {
      const purchase = id(),
        cost = paisa(payload.cost ?? 0, 'Cost');
      const total = lineAmount(qty, cost),
        paid = paisa(b.paid ?? 0, 'Amount paid');
      if (paid > total) throw fail('Payment exceeds this received stock bill.');
      const method = ['Cash', 'Card', 'Bank transfer'].includes(b.method) ? b.method : 'Cash';
      await c.query(
        'INSERT INTO purchases(id,product_id,vendor_id,qty_milli,unit_cost_paisa,invoice,payment,paid_paisa,payment_method,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          purchase,
          product.id,
          payload.vendorId || null,
          qty,
          cost,
          str(b.invoice, 120),
          paid === total ? 'Paid' : paid ? 'Part paid' : 'Unpaid',
          paid,
          method,
          note,
        ]
      );
      await c.query(
        "INSERT INTO stock_movements(id,product_id,qty_milli,kind,ref_id,reason,note) VALUES($1,$2,$3,'purchase',$4,'Owner verified receipt',$5)",
        [id(), product.id, qty, purchase, note]
      );
    }
    await c.query(
      "UPDATE products SET review_status='Approved',catalog_status='active',updated_at=NOW() WHERE id=$1",
      [product.id]
    );
    await c.query(
      "UPDATE product_submissions SET status='Approved',note=$1,reviewed_by=$2,reviewed_at=NOW() WHERE id=$3",
      [note, user.id, s.id]
    );
    await c.query(
      "INSERT INTO activity_events(entity,entity_id,action,actor) VALUES('product_submissions',$1,'APPROVED',$2)",
      [s.id, 'admin: ' + user.name + ' (' + user.id + ')']
    );
    return { status: 'Approved', productId: product.id, receivedQty: qty / 1000 };
  });
}
