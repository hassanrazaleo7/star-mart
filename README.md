# Star Mart — storefront and store operations

The customer shop at `/shop` uses Star Mart artwork, categories, featured banners, live product cards and a basket. The React admin at `/admin` manages products, POS/barcodes, stock, purchases, vendors, adjustments, customer orders, expenses and reports. Both read the same PostgreSQL data. The supplied logo lives at `public/logo.png`.

## Run in VS Code

1. Open this folder in VS Code, run `npm install` and `npm run dev`.
2. Open the Vite URL shown in Terminal (usually `http://localhost:5173`). First visit `/admin` to create the owner account with a password of at least 8 characters.
3. Add a product and opening stock. Visit `/shop` to see it in the customer storefront. `/` opens the storefront; `/signup` and `/login` open the customer account pages. Open shop, admin and vendor tabs poll a lightweight change version (every 3 s for the POS, every 10 s for the storefront and dashboards) and refetch only after a change. This is near-live synchronization, not WebSocket push.
4. Local development uses embedded PGlite in `.data/` by default. **Preserve `.data/` when updating code**; it holds your admin account and all store records. The local API binds to `127.0.0.1:8787`; set `HOST=0.0.0.0` to expose it on your LAN deliberately.

Useful scripts: `npm test` (runs every test against a throwaway local database), `npm run lint`, `npm run format`, `npm run build`, and `npm run check` (lint, format check, tests and build together, the same steps CI runs).

## Customer sign-in and account dashboard

Customer email/password accounts are stored in Neon PostgreSQL (or local PGlite in development). Customers create an account from the shop and can sign in, place orders, and open **/account**. Passwords are hashed with scrypt (N = 2^17) and per-user salts; older hashes are upgraded transparently at the next sign-in. Customer sessions use HttpOnly cookies (`__Host-` prefixed and `Secure` on HTTPS). Optional Google and SMS sign-in require a separate Firebase setup. Google/phone identities that are not linked to a store profile can browse and place orders but are asked to create a profile before using preferences, avatars or the dashboard.

A customer dashboard shows linked counter receipts, item quantities/prices, this month's spending, monthly totals, online order status (including WhatsApp inquiries awaiting confirmation and the time until a reservation expires), outstanding credit, credit payment history and Star Points. At POS, staff select a **registered customer** to link the bill. Walk-in bills remain anonymous. Credit sales require a selected customer. Staff record partial or full credit collections against a specific bill.

**Rewards:** On a fully paid registered-customer receipt, earn one point per whole Rs 100, capped so the future Rs 0.50 per point liability is no more than 10% of recorded gross profit. Products need recorded purchase costs; unknown costs do not earn points. Credit purchases earn only after full settlement and online orders after paid fulfillment. A customer may redeem exactly 100 previously earned points for Rs 50 on a later POS bill of at least Rs 3,000, once per bill; no stacking with a manual discount. Redemption requires recorded costs and at least 8% gross margin after the reward. The server checks all rules inside checkout, with an audit ledger.

## Store panels and vendor workflow

- `/admin`: owner setup on a fresh database, then owner login. Views are addressable (`/admin/orders`, `/admin/pos`, …) and the browser back button works. The owner controls products, received stock, vendor applications, supplier payments, reports, expenses and team accounts. Once an owner exists it cannot be registered a second time. Set `SETUP_SECRET` on a public deployment so the first visitor cannot claim the owner account.
- `/staff`: admin-issued email/password sign-in. Staff can use POS/barcode, fulfill or cancel customer orders, and see product names, selling prices and remaining stock. Staff cannot edit products, receive inventory, alter stock, see purchase costs or expenses, or manage accounts. Staff discounts are capped (default 5% of the bill or Rs 500, whichever is lower; see `STAFF_MAX_DISCOUNT_BPS` and `STAFF_MAX_DISCOUNT_PAISA`), every discount needs a reason, and large discounts are flagged in the activity log. Tax is calculated from each product's tax rate; only the owner can override it.
- `/vendor`: admin-issued email/password sign-in. The vendor can add/edit its own product catalog and upload product pictures, and sees its own products, every sale line, supplied stock receipts, cash/credit statuses, stock movements and supplier payment ledger. Product stock stays zero until the owner physically receives and records it. Once a product has been received or sold, a vendor can no longer change its price, cost, name, barcode, unit or category directly: price changes become proposals the owner accepts or declines from the product list.
- `/` or `/shop`: customer storefront. **Become a vendor** submits a public application with the applicant's own password; the owner reviews it under **Vendors** and approves it.
- Admin enters **Paid**, **Unpaid** or **Part paid** when receiving stock. Later vendor cash/bank/card payments and supplier returns are recorded under **Vendors**; the supplier statement there uses the complete history. A negative balance means the vendor owes the store (returns against paid stock).
- Product images upload with the **Image** button, resize in the browser and persist in PostgreSQL (1 MB, 8,000-pixel server limit). A large image library should move to object storage.

## Customer orders

A signed-in customer adds products to the basket and requests pickup or delivery with a contact number. Placing an order reserves available stock atomically for a limited time (48 hours by default, 24 hours for advance-transfer orders); the hold can be extended or cancelled from **Customer orders**, and expired holds are released automatically. A customer may keep up to three open orders. **WhatsApp orders** can be placed without an account; they are saved as _inquiries_ that reserve nothing until staff press **Confirm & reserve stock**. Fulfilling requires explicit confirmation that payment was collected, then records the sale and deducts stock. No online card charge or courier dispatch is claimed.

## Neon connection and live synchronization

Local development uses `.data/` by default. To connect a Neon database locally, create `.env.local` with a **pooled Neon PostgreSQL** URL as `DATABASE_URL=postgresql://...?...sslmode=require`; never commit that file. Restart `npm run dev`. On the first API request the app creates or upgrades its SQL tables (a schema version is recorded so later cold starts skip the migration). Once connected, all devices using that same Neon URL share products, sales, vendor accounts and orders. The previously created local `.data/` records are **not automatically copied** to Neon.

The browser checks `/api/live/version` while visible and fetches new records only after a change. The version is a single indexed lookup, so polling stays cheap as the store grows. Own actions refresh immediately without a second poll.

## Vercel deployment

Upload this folder to your own GitHub repository, import it into Vercel as Vite, and connect Neon through Vercel Marketplace, then set the Neon pooled PostgreSQL URL as `DATABASE_URL` (ensure `sslmode=require`). Keep the `vercel.json` rewrites and headers: it ships HSTS, frame-ancestor and referrer policies plus a Content-Security-Policy in **Report-Only** mode. After a week without violations in the browser console (check Google sign-in and phone OTP too), rename the header key to `Content-Security-Policy` and replace the Firebase auth domain placeholder. A daily cron calls `/api/sweep` (requires `CRON_SECRET`) as a fallback for the in-request housekeeping that expires holds and prunes sessions. Firebase variables are optional. The app refuses ephemeral local database use on Vercel. Configure database backups with your PostgreSQL provider. See `.env.example` for every optional setting.

## Inventory and financial rules

Money is stored as integer paisa, quantities as thousandths of a unit. Stock = opening + purchases − sales + signed adjustments; the current total and the quantity reserved by pending orders are maintained on each product by database triggers and verified by `tests/stock-invariant.test.mjs`. Every sale writes a receipt and stock movement in one transaction, and a POS sale carries an idempotency key so a retried request after a timeout never records twice. Gross margin and expenses in the dashboard are management estimates, not tax statements. Reports are calculated by the database for any date range; the admin working set loads history since the first day of the previous month (`/api/state?from=YYYY-MM-DD` for more).

## Import old data

From the old static manager, use **Export backup**. On the new admin, sign in and choose **Import old backup** while its database is empty. The import is atomic and preserves products, vendors, purchases, sales, adjustments and expenses (up to 10,000 products and 20,000 purchase and sale rows per file). The new **Export** is an operational JSON data export and is not a database restore mechanism.

## Account screens

Customer signup: `/signup`; customer sign in: `/login`; customer dashboard: `/account`. Vendor applications start at `/become-a-vendor`; the store owner approves requests in `/admin/vendors`. Staff use `/staff`. The owner uses `/admin` with the owner password. Registered customers, outstanding credit and points appear in `/admin/customers`. Password reset links are issued by the owner from **Store settings → Password recovery** and carry the token in the URL fragment.

Google and Facebook customer sign in use Firebase Authentication. Set `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` at build time and `FIREBASE_PROJECT_ID` on the server. The Firebase SDK is loaded only when a sign-in button is used.

## Bulk customer and grocery import

In `/admin/bulk` choose **Bulk import** and download the sample ZIP. Fill `customers.csv` (name, email, phone, temporary_password of at least 8 characters) and `products.csv` (SKU, barcode, name, category, brand, pack size, unit, selling price, purchase cost, opening stock, reorder level, shelf location, description, image filename). Put photos in its `images/` folder. The importer accepts up to 5,000 customers and 5,000 products per ZIP with a 30 MB limit; the ZIP is decompressed off the main thread and large photos are resized before upload. Existing emails and SKUs are skipped; deleted products do not block re-importing the same SKU. Keep filled ZIPs with customer passwords private.

## Sample grocery storefront and payment process

The owner can download `star-mart-210-sample-catalog.zip` in `/admin/bulk`; it has `products.csv`, a header-only `customers.csv` and sample images. Import creates products with **zero** opening stock. At checkout, customers choose pickup or delivery and Cash, POS card on collection, JazzCash transfer, Easypaisa transfer, or Bank transfer. For transfers, the buyer enters a transaction reference, which is **unverified** until the owner confirms it on fulfilment. No online gateway is configured.

The admin **Activity log** shows the latest changes across orders, products, images, stock, purchases, sales, receipts, expenses, vendors, customer accounts and other key records, with the acting account for every write. Large POS discounts appear as `DISCOUNT` entries. Events older than 180 days are pruned (`ACTIVITY_RETENTION_DAYS`).

## Code layout

- `server/api.mjs` — request pipeline; routes live in `server/routes/*.mjs` and declare their guard, body type, rate limits and transaction use in `server/router.mjs`.
- `server/db.mjs` — engine selection, `tx()`, schema and triggers; `server/sweeper.mjs` — housekeeping; `server/config.mjs` — limits and policy.
- `src/main.jsx` — admin/staff shell; `src/shop.jsx` — storefront; `src/lib/` — shared API, money and image helpers; `src/hooks/` — basket and checkout draft.
- `tests/` — `node --test` suites; `tests/helpers.mjs` has the shared request harness.
- `CODE_AUDIT.md` — the audit this version was built from, with each finding's status.
