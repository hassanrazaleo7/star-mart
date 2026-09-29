# Star Mart — storefront and store operations

The customer shop at `/shop` uses Star Mart artwork, categories, featured banners, live product cards and basket. The React admin at `/admin` manages products, POS/barcodes, stock, purchases, vendors, adjustments, customer orders, expenses and reports. Both read the same PostgreSQL data. The supplied logo lives at `public/logo.png`.

## Run in VS Code

1. Extract this folder, open it in VS Code, run `npm install` and `npm run dev`.
2. Open the Vite URL shown in Terminal (usually `http://localhost:5173`). First visit `/admin` to create the owner account with a 6+ character password.
3. Add a product and opening stock. Visit `/shop` to see it in the customer storefront. `/` opens the customer signup view. Open shop/admin/vendor tabs check a lightweight change version every 3 seconds while visible, then refresh data after a database change. This is near-live synchronization, not WebSocket push.
4. Local development uses embedded PGlite in `.data/` by default. **Preserve `.data/` when updating code**; it holds your admin account and all store records.

## Customer sign-in and account dashboard

Customer email/password accounts are stored in Neon PostgreSQL (or local PGlite in development). Customers create an account from the shop and can sign in, place orders, and open **/account**. Passwords are salted and hashed; customer sessions use HttpOnly cookies. Optional Google and SMS sign-in require a separate Firebase setup. The account dashboard currently supports the built-in email/password account; Google/phone identities do not automatically link to a Neon customer account.

A customer dashboard shows linked counter receipts, item quantities/prices, this month's spending, monthly totals, online order status, outstanding credit, credit payment history and Star Points. At POS, staff select a **registered customer** to link the bill. Walk-in bills remain anonymous and do not appear in a customer account; historical unlinked receipts cannot be assigned safely by matching a name. Credit sales require a selected customer. Staff record partial or full credit collections against a specific bill.

**Rewards:** On a fully paid registered-customer receipt, earn one point per whole Rs 100, capped so the future Rs 0.50 per point liability is no more than 10% of recorded gross profit. Products need recorded purchase costs; unknown costs do not earn points. Credit purchases earn only after full settlement and online orders after paid fulfillment. A customer may redeem exactly 100 previously earned points for Rs 50 on a later POS bill of at least Rs 3,000, once per bill; no stacking with a manual discount. Redemption requires recorded costs and at least 8% gross margin after the reward. The server checks all rules inside checkout, with an audit ledger. This limits discount exposure but does not guarantee net profit after rent, spoilage or overhead. The POS does not yet implement returns/refunds or automatic point reversal.

If you also want Google or SMS OTP, copy `.env.example` to `.env.local` and fill Firebase Web App values plus `FIREBASE_PROJECT_ID`. Enable those providers and authorize your domain in Firebase. SMS usually needs Firebase billing and must be configured separately. Email/password accounts and their dashboard do **not** require Firebase.

## Store panels and vendor workflow

- `/admin`: owner setup on a fresh database, then super admin login. The owner controls products, received stock, vendor applications, supplier payments, reports, expenses and team accounts. Once an owner exists in `.data/` or Neon, it cannot be registered a second time; preserve that database when updating.
- `/staff`: admin-issued email/password sign-in. Staff can use POS/barcode, fulfill or cancel customer orders, and see product names, selling prices and remaining stock. Staff cannot edit products, receive inventory, alter stock, see purchase costs or expenses, or manage accounts.
- `/vendor`: admin-issued email/password sign-in. The vendor can add/edit its own product catalog and upload product pictures, and sees its own products, every sale line, supplied stock receipts, cash/credit statuses, stock movements, and supplier payment ledger. Product stock stays zero until the owner physically receives and records it. Vendor accounts cannot access other vendors or super admin data.
- `/` or `/shop`: customer storefront. **Become a vendor** submits a public application. The owner reviews it under **Vendors**, sets a temporary password, approves and manually shares the displayed email/password. The application itself does not issue a privileged account. Customer signup uses Firebase Google/email/phone OTP once configured; it is separate from staff/vendor login.
- Admin enters **Paid**, **Unpaid** or **Part paid** when receiving stock, with an amount for partial payment. Later vendor cash/bank/card payments are recorded under **Vendors**. The supplier balance is received stock cost minus payments. Older imported “Part paid” records lack the original paid amount and require reconciliation. POS credit sales are recorded as credit, but customer debt collection is not implemented.
- Product images upload with the **Image** button, resize in the browser and persist in PostgreSQL (1 MB server limit). No image URL is needed. This is suitable for a small catalog; a large image library should move to object storage.

## Customer orders

A signed-in customer adds products to the basket and requests pickup or delivery with a contact number. Placing an order reserves available stock atomically. In admin **Customer orders**, cancelling releases stock; fulfilling requires explicit confirmation that payment was collected, then records the sale and deducts stock. No online card charge or courier dispatch is claimed.

## Neon connection and live synchronization

Local development uses `.data/` by default. To connect a Neon database locally, create `.env.local` with a **pooled Neon PostgreSQL** URL as `DATABASE_URL=postgresql://...?...sslmode=require`; never commit that file. Restart `npm run dev`. On the first API request the app creates its SQL tables. Once connected, all devices using that same Neon URL share products, sales, vendor accounts and orders. The previously created local `.data/` records are **not automatically copied** to Neon. Keep a backup and import supported legacy data separately, or start fresh.

The browser checks `/api/live/version` every 3 seconds when visible and fetches new records only after a change. Own actions refresh immediately. This normally shows other devices' changes within a few seconds; it is polling, not guaranteed instantaneous server push. More simultaneous users mean more requests and may exceed free hosting limits.

## Vercel deployment

Upload this folder to your own GitHub repository, import it into Vercel as Vite, and connect Neon through Vercel Marketplace, then set the Neon pooled PostgreSQL URL as `DATABASE_URL` (ensure `sslmode=require`). The root directory should be the folder containing this README and `package.json`. Set framework preset **Vite** and keep the `vercel.json` rewrites. Firebase variables are optional for Google/mobile sign-in; Neon email/password signup and the customer dashboard work without Firebase. The app refuses ephemeral local database use on Vercel. Configure database backups with your PostgreSQL provider. `npm run build` verifies the frontend and `npm test` runs calculation, stock, import and order tests.

The supplied ZIP is a MongoDB-based warehouse reference. Its MongoDB records and unused warehouse modules were not copied. The linked `arnobt78/Warehouse-Stock-Inventory-Management-System--NextJS-FullStack` is an external reference with broader warehouse and multi-role features. This Star Mart app is an independent implementation. It does not include Stripe, warehouse transfers, invoice PDF, tax compliance or shipping integration.

## Inventory and financial rules

Money is stored as integer paisa, quantities as thousandths of a unit. Stock = opening + purchases − sales + signed adjustments. Pending customer orders reserve stock separately so POS and another order cannot oversell it. Every sale writes a receipt and stock movement in one transaction. Gross margin and expenses in the dashboard are management estimates, not tax statements. Expiry alerts show dated purchases; batch-specific remaining stock requires a later allocation ledger.

## Import old data

From the old static manager, use **Export backup**. On the new admin, sign in and choose **Import old backup** while its database is empty. The transaction is atomic and preserves products, vendors, purchases, sales, adjustments and expenses. Keep both the old JSON and database backups. The new **Export** is an operational JSON data export and is not a database restore mechanism.

## Account screens

Customer signup: `/signup`; customer sign in: `/login`; customer dashboard: `/account`. Vendor applications start at `/become-a-vendor`; the store owner approves requests in `/admin` → Vendors and shares `/vendor` credentials. Staff use `/staff`. The owner uses `/admin` with the owner password. Registered customers, outstanding credit and points appear in `/admin` → Customers.

Google and Facebook customer sign in use Firebase Authentication. To enable them, set `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` at build time and `FIREBASE_PROJECT_ID` on the server. Enable Google and Facebook providers plus your Vercel domain in Firebase Auth. Facebook additionally needs its Meta app ID/secret and OAuth redirect configuration. The backend verifies the Firebase ID token and maps the provider UID to a Neon customer account, then issues the same customer session used by the dashboard. Existing password accounts are not automatically merged by matching email; sign in with the original method. Email/password signup works without Firebase.

## Bulk customer and grocery import

In `/admin` choose **Bulk import** and download the sample ZIP. Fill `customers.csv` (name, email, phone, temporary_password) and `products.csv` (SKU, barcode, name, category, brand, pack size, unit, selling price, purchase cost, opening stock, reorder level, shelf location, description, image filename). Put photos in its `images/` folder using matching filenames. ZIP these files together, select it in the admin panel, and press **Import ZIP** once. The importer accepts up to 5,000 customers and 5,000 products per ZIP, with a 30 MB compressed file limit; large photos are resized before upload. New products and opening stock appear in the customer shop and admin inventory. Existing emails and SKUs are skipped without changing their stock or photos; barcode conflicts stop the affected batch. Each batch of up to 80 rows is a database transaction, while photos upload afterward, so a partial failure may leave earlier batches saved. Retry skips existing rows. Keep filled ZIPs with customer passwords private; no customer password change/reset flow is included. An empty customer or product CSV may have just the header row.

## Sample grocery storefront and payment process

The storefront includes a clearly marked illustrative catalog: 21 categories with ten sample products each and generated placeholder artwork. Sample prices are estimates for layout only. The customer cannot purchase a sample item until the owner imports it, checks its real selling price/cost/barcode/photo and records actual received stock. The owner can download `star-mart-210-sample-catalog.zip` in `/admin` → **Bulk import**; it has `products.csv`, a header-only `customers.csv` and the sample images. Import creates products with **zero** opening stock; existing SKUs are skipped. The shop shows genuine stock and current sale price from the database. Editing products and receiving stock make them purchasable.

At checkout, customers choose pickup or delivery and Cash, POS card on collection, JazzCash transfer, Easypaisa transfer, or Bank transfer. For transfers, the buyer enters a transaction reference, which is **unverified**. The app does not initiate a wallet, bank or card charge. The store must provide its verified payment details outside the site and independently confirm collection in its merchant/bank account before the owner fulfills an order. On fulfillment, a transfer requires the confirmed reference. Only then do sales, stock deduction and customer points post in one database transaction. Cancellation releases the reserved quantity. Actual gateway payment requires merchant onboarding/credentials and callback verification; no online gateway is configured.

The admin **Activity log** shows the latest 150 inserts/updates/deletes across orders, products, product images, stock, purchases, sales, receipts, expenses, vendors, customer accounts and other key operational records. It records entity, record ID, operation and time. Its source field gives a broad category, **not a verified individual staff identity**. The vendor's **Customer demand** view is restricted to order lines belonging to that vendor and does not expose customer contact details.
