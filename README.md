# Star Mart — storefront and store operations

The customer shop at `/shop` restores the original Star Mart grocery design: original hero and produce artwork, header, categories, promotion, product cards and basket. The React admin at `/` manages products, POS/barcodes, stock, purchases, vendors, adjustments, customer orders, expenses and reports. Both read the same PostgreSQL data. The supplied logo lives at `public/logo.png`.

## Run in VS Code

1. Extract this folder, open it in VS Code, run `npm install` and `npm run dev`.
2. Open the Vite URL shown in Terminal (usually `http://localhost:5173`). First visit `/admin` to create the owner account with a 6+ character password.
3. Add a product and opening stock. Visit `/shop` to see it in the customer storefront. `/` opens the customer signup view. Existing shop tabs refresh every 15 seconds or on focus.
4. Local development uses embedded PGlite in `.data/` by default. **Preserve `.data/` when updating code**; it holds your admin account and all store records.

## Customer sign-in setup

Customer accounts and optional linked owner sign-in use Firebase Authentication. Copy `.env.example` to `.env.local` and fill the Firebase Web App values plus `FIREBASE_PROJECT_ID` (same project ID). In Firebase Console, enable **Email/Password**, **Google**, and **Phone** under Authentication > Sign-in method, and authorize your development/deployment domains. Restart `npm run dev` after editing environment variables. The server verifies Firebase ID tokens before accepting orders; an unverified email/password account cannot order.

- Google sign-in opens a Firebase popup.
- Email sign-up sends a verification email; password reset sends an email.
- Mobile sign-in uses reCAPTCHA and a real SMS OTP. Use E.164 format such as `+923001234567`. Firebase SMS verification requires a billing-enabled plan and is billed per SMS; check Firebase's current pricing and limits before enabling Phone. For safe development, use Firebase's configured fictional test phone numbers; never ship a shared test code to users.
- Without Firebase configuration, the storefront catalog works, while customer login and ordering remain unavailable. Admin owner password login at `/admin` is separate and still works. Customer signup requires Firebase configuration; without it, the signup form explains the missing setup. After signing in as owner, use **Link sign-in** in the admin header to attach a verified Google or mobile identity. Only linked identities can subsequently open admin; a random customer account has no admin rights.

## Store panels and vendor workflow

- `/admin`: owner setup on a fresh database, then super admin login. The owner controls products, received stock, vendor applications, supplier payments, reports, expenses and team accounts. Once an owner exists in `.data/` or Neon, it cannot be registered a second time; preserve that database when updating.
- `/staff`: admin-issued email/password sign-in. Staff can use POS/barcode, fulfill or cancel customer orders, and see product names, selling prices and remaining stock. Staff cannot edit products, receive inventory, alter stock, see purchase costs or expenses, or manage accounts.
- `/vendor`: admin-issued email/password sign-in. The vendor can add/edit its own product catalog and upload product pictures, and sees its own products, every sale line, supplied stock receipts, cash/credit statuses, stock movements, and supplier payment ledger. Product stock stays zero until the owner physically receives and records it. Vendor accounts cannot access other vendors or super admin data.
- `/` or `/shop`: customer storefront. **Become a vendor** submits a public application. The owner reviews it under **Vendors**, sets a temporary password, approves and manually shares the displayed email/password. The application itself does not issue a privileged account. Customer signup uses Firebase Google/email/phone OTP once configured; it is separate from staff/vendor login.
- Admin enters **Paid**, **Unpaid** or **Part paid** when receiving stock, with an amount for partial payment. Later vendor cash/bank/card payments are recorded under **Vendors**. The supplier balance is received stock cost minus payments. Older imported “Part paid” records lack the original paid amount and require reconciliation. POS credit sales are recorded as credit, but customer debt collection is not implemented.
- Product images upload with the **Image** button, resize in the browser and persist in PostgreSQL (1 MB server limit). No image URL is needed. This is suitable for a small catalog; a large image library should move to object storage.

## Customer orders

A signed-in customer adds products to the basket and requests pickup or delivery with a contact number. Placing an order reserves available stock atomically. In admin **Customer orders**, cancelling releases stock; fulfilling requires explicit confirmation that payment was collected, then records the sale and deducts stock. No online card charge or courier dispatch is claimed.

## Vercel deployment

Upload this folder to your own GitHub repository, import it into Vercel as Vite, and connect Neon through Vercel Marketplace, then set the Neon pooled PostgreSQL URL as `DATABASE_URL` (ensure `sslmode=require`). The root directory should be the folder containing this README and `package.json`. Set framework preset **Vite** and keep the `vercel.json` rewrites. Add the Firebase variables from `.env.example` to the Vercel environment and authorize the deployed domain in Firebase Authentication. The app refuses ephemeral local database use on Vercel. Configure database backups with your PostgreSQL provider. `npm run build` verifies the frontend and `npm test` runs calculation, stock, import and order tests.

The supplied ZIP is a MongoDB-based warehouse reference. Its MongoDB records and unused warehouse modules were not copied. The linked `arnobt78/Warehouse-Stock-Inventory-Management-System--NextJS-FullStack` is an external reference with broader warehouse and multi-role features. This Star Mart app is an independent implementation. It does not include Stripe, warehouse transfers, invoice PDF, tax compliance or shipping integration.

## Inventory and financial rules

Money is stored as integer paisa, quantities as thousandths of a unit. Stock = opening + purchases − sales + signed adjustments. Pending customer orders reserve stock separately so POS and another order cannot oversell it. Every sale writes a receipt and stock movement in one transaction. Gross margin and expenses in the dashboard are management estimates, not tax statements. Expiry alerts show dated purchases; batch-specific remaining stock requires a later allocation ledger.

## Import old data

From the old static manager, use **Export backup**. On the new admin, sign in and choose **Import old backup** while its database is empty. The transaction is atomic and preserves products, vendors, purchases, sales, adjustments and expenses. Keep both the old JSON and database backups. The new **Export** is an operational JSON data export and is not a database restore mechanism.
