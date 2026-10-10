# Star Mart — Code Audit Report

| | |
|---|---|
| **Date** | 2026-10-09 |
| **Codebase** | `star-mart-main` (React 19 + Vite 7 SPA; Node 22 API in `server/api.mjs` deployed as one Vercel function; PostgreSQL/Neon in production via `pg`, embedded PGlite in `.data/` locally) |
| **Scope** | `server/` (20 modules), `src/` (~45 modules incl. `components/ui`), `tests/` (8 files), `api/index.js`, `dev.mjs`, `vite.config.js`, `vercel.json`, `package.json`/lockfile, `index.html`, `.env.example`, `.gitignore`, `public/` |
| **Out of scope** | Firebase console configuration, Neon project settings, Vercel project settings, the contents of any live database |
| **Method** | Every server module read end to end; the frontend, tests, build config and assets read in full; a second independent review of the server layer to cross-check severities; `npm audit` run against the lockfile. No source files were modified. |
| **Findings** | 49 total: **1 Critical · 9 High · 19 Medium · 18 Low · 2 Info** |

> **Remediation record (2026-10-10).** Every finding below has been addressed in the codebase unless its Status cell says otherwise. Highlights: the API was rewritten as a declarative route table with per-route guards, rate limits and transactions; stock is now materialised by triggers and verified by an invariant test; POS checkout is idempotent; guest WhatsApp orders no longer reserve stock and every hold expires; vendors can no longer reprice stocked products; security headers ship with a Report-Only CSP; the client was split into lazy portal chunks with shared libraries; 20 new test cases cover the gaps listed in T1. Open items: the CSP must be switched from Report-Only after a monitoring week, three transitive `npm audit` advisories remain in `firebase`/`firebase-admin`/Vite, and the Firebase sign-in success path still has no automated test.

**How to read this document.** Findings are grouped by area and numbered (S = security & abuse, C = correctness & business logic, P = performance, M = maintainability, T = tests, D = dependencies & deploy). Each has a severity, a priority, an effort size, a location, verbatim evidence from the source, an impact scenario, a concrete fix and a way to verify it. Section 5 gives code-level sketches for the twelve highest-value fixes; Section 6 sequences all of them into four phases; the appendices hold the endpoint matrix, DDL, test plan, tooling files and the `vercel.json` headers block, ready to copy.

Line references are approximate because the code is written in very long lines (for example `server/api.mjs` line 40 is a single 27,568-character statement). Each location therefore names the function or route rather than relying on a line number.

---

## 1. Executive summary

Star Mart has a sound security core. SQL is parameterized everywhere, passwords use `scrypt` with per-user salts and constant-time comparison, session tokens are 256-bit random values stored hashed, cookies are `HttpOnly` with `SameSite`, money is handled as integer paisa with BigInt line math, and every stock mutation takes a row lock inside a transaction. The customer order flow already has idempotency keys, and the role separation between owner, staff and vendor is enforced server-side and partly tested.

That core is undermined by gaps in abuse resistance, operational robustness and scale:

- **Anyone can lock up the inventory.** Guest "WhatsApp orders" need no account and hard-reserve stock that never expires. Reserved stock blocks POS sales, stock corrections, vendor returns and product deletion. Twenty orders of a hundred lines each from one IP every fifteen minutes is enough to stop the shop trading, and customer signup is not rate-limited at all. (S1, S2)
- **Money leaks through the POS.** A cashier can apply any discount up to the full bill and enter any tax figure. A POS sale is not idempotent, so a timeout followed by a retry records the sale twice; the admin client makes that retry likely by reporting a successful sale as a failure whenever the post-sale refresh fails. Vendors can change the selling price of stocked products at will. (S3, S4, C1)
- **The serverless function is fragile.** A single failed cold-start migration leaves that instance returning 500 until it is recycled, and concurrent cold starts race on the trigger DDL. The `pg` pool has no error handler, so a Neon idle disconnect crashes a self-hosted server. About twenty writes run outside the transaction helper, which on the local PGlite engine can silently lose them and in production loses the audit actor. (C2, C3, C4)
- **It will not scale past a small store.** The public `/live/version` endpoint is polled every three seconds by every open tab and runs eleven unindexed full-table aggregates per poll. The admin `/state` endpoint returns every sale, receipt and purchase ever recorded and is re-fetched after every change; it will hit Vercel's 4.5 MB response cap and the admin panel will stop loading. (P1, P2, P5)
- **The code resists maintenance.** The entire API is one if-chain in a single 27 KB line. There is no linter, formatter, type checking or CI. Three copies of the storefront exist in `src/`, one of them live. (M1, M2, M4)

### Scorecard

| Area | Grade | Critical | High | Medium | Low | Info | Headline |
|---|---|---|---|---|---|---|---|
| Security & abuse | **C** | 1 | 3 | 3 | 5 | 2 | Anonymous inventory lock-up (S1); unlimited POS discount (S3) |
| Correctness & business logic | **C+** | – | 3 | 7 | 7 | – | POS double sale (C1); poisoned `init()` (C2) |
| Performance & scalability | **C-** | – | 2 | 4 | 2 | – | Public 3-second poll runs 11 table scans (P1); unbounded `/state` (P2) |
| Maintainability | **D** | – | 1 | 3 | 2 | – | 27 KB single-line router; no lint/format/CI (M1, M4) |
| Tests | **C** | – | – | 1 | 1 | – | No coverage of rate limits, CSRF, idempotency, image rejection (T1) |
| Dependencies & deploy | **C** | – | – | 1 | 1 | – | No security headers (S5); 7 `npm audit` findings (S11) |

### Do today (Phase 0, no schema changes)

1. Apply the existing `authLimit()` to `/customer/signup`, `/customer/orders`, `/password/reset`, `/setup`, `/admin/firebase-login`, `/admin/link`, `/account/password`, `/customer/password` (S2).
2. Add the `headers` block from Appendix E to `vercel.json` (S5).
3. Make `init()` reset its memo on failure (C2) and wrap the Origin parse in try/catch (S7).
4. Split the admin `action()` helper so a failed refresh after a successful sale no longer looks like a failed sale (C1, client half).
5. Make tests ignore `DATABASE_URL` (C10) and delete the dead files in Appendix F (M2).

---

## 2. Legend

| Term | Meaning |
|---|---|
| **Critical** | Exploitable now by an anonymous party with store-stopping or money-losing impact |
| **High** | Exploitable by a low-privilege party or likely to occur in normal operation, with financial, data-loss or availability impact |
| **Medium** | Real defect with bounded impact, or a High that needs an unusual precondition |
| **Low** | Defect with minor impact, or defence-in-depth gap |
| **Info** | Observation worth recording; no action strictly required |
| **Priority P0–P3** | Severity × ease of fix; maps to roadmap Phase 0–3 |
| **Effort S / M / L** | Hours / a day / several days for one engineer familiar with the code |
| **Regression risk** | Low = isolated change; Med = touches shared behaviour; High = changes data semantics |
| **Status** | Open / In progress / Fixed / Accepted — left blank for tracking |

---

## 3. Architecture as audited

### 3.1 Request flow

```
 Browser (one Vite bundle, no code splitting)        Vercel                  Function (api/index.js)                       Database
 ┌──────────────────────────────────────────┐        ┌────────────┐          ┌─────────────────────────────────────────┐   ┌───────────────┐
 │ /shop, /, /signup, /login ... shop.jsx   │ /api/* │ rewrites   │ invoke   │ handle(req,res)                         │   │ Neon Postgres │
 │ /account            customer-dashboard  │ ─────▶ │ (no headers│ ───────▶ │  └ withRequestContext (AsyncLocalStorage)│──▶│  pg Pool      │
 │ /admin, /staff, *   main.jsx App        │        │  block)    │          │     └ handleRequest                     │   │  max: 1       │
 │ /vendor             main.jsx + vendor   │ ◀───── │            │ ◀─────── │        ├ await init()   (≈60 DDL/cold)   │◀──│               │
 │ cookies: sm_session (Strict)            │        └────────────┘          │        ├ Origin check (mutations)        │   └───────────────┘
 │          sm_customer (Lax)              │                                │        ├ public routes                   │   Local dev / npm start:
 │ header:  Authorization: Bearer <FB id>  │                                │        ├ let user = await auth(req)      │   PGlite in ./.data
 │ poll:    GET /api/live/version every 3 s│                                │        └ ~45 authenticated routes       │   single session,
 └──────────────────────────────────────────┘                                │  json() / fail() / catch-all           │   tx() promise queue
          │ popup                                                            └─────────────────────────────────────────┘
          ▼
 Firebase Auth (Google / Facebook / phone)  ── ID token ──▶  firebase-admin verifyIdToken (FIREBASE_PROJECT_ID)
```

Every request pays `await init()` (memoized per instance), then the Origin check for `POST/PUT/PATCH/DELETE`, then walks a flat if-chain. Everything above `let user=await auth(req)` in `handleRequest` is reachable without a store session; everything below requires a valid `sm_session` cookie and applies `owner(user)` / `worker(user)` / role checks branch by branch.

### 3.2 Identities and trust boundaries

| Boundary | Who | How identified | Notes |
|---|---|---|---|
| TB1 Public | Anyone | none | `/public/*`, `/live/version`, `/images/:id`, `/customer/signup`, `/customer/login`, `/vendor/apply`, `/password/*`, `/setup`, `/setup/status`, `/login`, `/account/login` |
| TB2 Customer | Registered customer | `sm_customer` cookie → `customer_sessions` | Falls back to a Firebase Bearer token whose uid may not exist in `customer_accounts` (S10) |
| TB2' Guest | Anyone | `requestKey` only | `/public/whatsapp-order` fabricates `customer.id='guest-'+hash(requestKey)` and places a real reserving order (S1) |
| TB3 Store | Owner / staff / vendor | `sm_session` cookie → `sessions` (owner, fixed id `'owner'`) or `account_sessions` → `store_accounts.role` | `owner()` = admin only; `worker()` = admin or staff; vendor checked inline |
| TB4 Database | Server | single DB role | Audit actor comes from `set_config('star_mart.actor')`, which only `tx()` sets (C3) |
| TB5 Proxy headers | Vercel edge | `x-forwarded-for`, `x-forwarded-host` | Trusted as-is; correct on Vercel, spoofable when self-hosted or behind the Vite dev proxy (S2, S7) |

### 3.3 Data model essentials

- **Money** is integer paisa (`price_paisa`, `*_paisa`), parsed by `fixed()` in `server/money.mjs`, which rejects negatives, exponents and more than two decimals. Line totals use BigInt with half-up rounding; discounts and taxes are allocated by largest remainder.
- **Quantities** are thousandths of a unit (`qty_milli`). Online orders must be whole units.
- **Stock** is not stored. It is `SUM(qty_milli) FROM stock_movements WHERE product_id=…`, recomputed on every read and every mutation.
- **Reservations** are `customer_order_items` of orders with `status='Pending'`. Every stock path subtracts them, so a pending order is a hard hold with no expiry.
- **Audit log** is `activity_events`, filled by an `AFTER INSERT OR UPDATE OR DELETE` trigger on 16 tables plus `product_images`.
- **Two engines**: with `DATABASE_URL` set, a `pg.Pool`; otherwise PGlite (single in-process session). `tx()` serializes PGlite transactions through a promise queue, but plain `db().query()` calls bypass the queue.

---
## 4. Findings

### 4.1 Security & abuse

#### S1 — Anyone can lock up the entire inventory with unauthenticated orders that never expire

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Critical** | P0 | M | Med | Fixed |

**Location:** `server/api.mjs` → route `POST /public/whatsapp-order`; `server/orders.mjs` → `placeOrder()`, `reserved()`; consumers `checkout()`, `addAdjustment()` in `api.mjs`, `setStock()`/`catalogAction()` in `server/catalog-actions.mjs`, `returnToVendor()` in `server/vendor-ledger.mjs`.

**Evidence:**
```js
// api.mjs, /public/whatsapp-order — a guest needs only a name and any 7-digit string
customer={id:'guest-'+hash(b.requestKey),name:str(b.name),phone:str(b.phone,30),email:''}
// orders.mjs, placeOrder — the only size limits
if(!Array.isArray(b.lines)||!b.lines.length||b.lines.length>100)throw fail('Basket is empty')
// api.mjs, checkout — every stock path subtracts pending holds
available-=held;if(x.qty>available)throw fail(p.name+' has insufficient stock. Available: '+available/1000)
// auth-limits.mjs — 20 requests per 15 minutes per IP is the only brake
if(Number(r.rows[0].attempts)>20)throw Object.assign(new Error('Too many attempts...'),{status:429})
```

**Impact:** The guest path creates a real `customer_orders` row with `status='Pending'` and real `customer_order_items`. `placeOrder` validates only that quantities are whole units and that each line does not exceed `stock − reserved`; there is no per-line cap, no cap on pending orders per customer or IP, and nothing ever expires a pending order. One IP can submit 20 orders × 100 lines, each line for the full available quantity, every 15 minutes: up to 2,000 SKUs fully reserved per window, repeatable indefinitely. Because `checkout`, `addAdjustment`, `setStock`, `returnToVendor` and the bulk `delete` action all refuse to touch reserved stock, the POS then rejects every walk-in sale with "insufficient stock", the storefront shows zero stock, and the owner cannot correct, return or delete the affected products until staff cancel each order by hand through the admin. `allOrders()` is `LIMIT 1000`, so a flood also pushes genuine orders out of the admin view. The same lock-up is reachable with **no** rate limit via `/customer/signup` (unthrottled, S2) followed by `POST /customer/orders` (unthrottled).

**Fix (see F1 in Section 5):**
1. Do not hard-reserve for guests. Store guest WhatsApp orders with `status='Inquiry'` and exclude that status from `reserved()`; staff convert to `Pending` when they confirm on WhatsApp.
2. Add `customer_orders.expires_at`; set it in `placeOrder` (guests 2 h, signed-in customers 48 h, transfer-reference orders 24 h) and make `reserved()` ignore expired rows.
3. Cap each line (for example 10 units for guests, 50 for customers) and cap pending orders per `customer_uid` (3) and per guest IP hash.
4. Add a sweeper that cancels expired orders, run opportunistically from `/live/version` at most once a minute under `pg_try_advisory_xact_lock`, with a Vercel cron as fallback.
5. Rate-limit signup and order placement (S2) and give the owner a "release holds" action at the POS.

**Verify:** `tests/order-expiry.test.mjs` — a guest order with `expires_at` in the past is cancelled by `sweep()` and the product's `publicProducts` stock returns; a 21st line-item above the cap returns 400; a fourth pending order for the same customer returns 429.

**Related:** S2, P2, F1.

---

#### S2 — Rate limiting is missing on the endpoints that matter most, and the limiter key can be side-stepped

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **High** | P0 | S | Low | Fixed |

**Location:** `server/api.mjs` routes `/customer/signup`, `POST /customer/orders`, `/password/reset`, `/setup`, `/admin/firebase-login`, `/admin/link`, `/account/password`, `/customer/password`; `server/auth-limits.mjs` → `authLimit()`.

**Evidence:**
```js
// api.mjs — signup has no authLimit call at all
if(path==='/customer/signup'&&method==='POST'){let b=await body(req),name=required(b.name,'Name'),email=required(b.email,'Email').toLowerCase(), ...
// auth-limits.mjs — key includes the caller-supplied email
const ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'local').split(',')[0].trim();
const key=hash(scope+'|'+ip+'|'+String(email).trim().toLowerCase());
// api.mjs — vendor applications are limited per (ip, email), so a new email resets the counter
await authLimit(req,'vendor-application',email);
```

**Impact:**
- `/customer/signup`: unlimited account creation. Each call costs a synchronous `scrypt` (≈60–100 ms of blocked event loop, S6), inserts a `customer_accounts` and a `customer_sessions` row forever (S9), and enumerates emails via the 409 (S8). It is the unthrottled entry to S1.
- `/vendor/apply`: varying the email per request means the counter never reaches 20. Thousands of Pending rows, each with a password hash, bury the owner's queue (`LIMIT 500`).
- `/account/password` and `/customer/password` verify `currentPassword` with no limit, so a stolen session cookie can be upgraded to a permanent takeover by brute-forcing the current password.
- `/login` (owner) is limited per IP only; with a 6-character minimum (S6), distributed guessing is feasible. No per-account lockout exists on any login route.
- `/password/reset` and `/setup` are unthrottled; the reset token is 256-bit so guessing is infeasible, but each attempt costs a hash. `/setup` on a fresh deploy is first-visitor-wins (S13).
- `auth_limits` rows are never deleted; an attacker can inflate the table at will.
- The IP is the **first** `x-forwarded-for` entry. Vercel overwrites the header, so this is correct on Vercel; self-hosted or behind the Vite dev proxy it is attacker-controlled.

**Fix (see F2):** apply `authLimit` to every route above; extend it to `authLimit(req, scope, email, {max, windowMinutes})`; add IP-only buckets (`signup-ip`, `vendor-application-ip` with a low ceiling such as 3 per 15 minutes) and per-account buckets on all three logins (`'login-account'`, key by email regardless of IP, ≈10 attempts); add a `clientIp(req)` helper that prefers `x-real-ip` on Vercel and otherwise only trusts `x-forwarded-for` when `TRUST_PROXY=1`; prune `auth_limits` older than a day.

**Verify:** `tests/security.test.mjs` — 21st signup from one IP returns 429; 4th vendor application from one IP with different emails returns 429; 11th wrong `currentPassword` returns 429; spoofed `x-forwarded-for` does not reset a counter when `x-real-ip` is present.

**Related:** S1, S6, S8, S9, S13.

---

#### S3 — Staff can apply an unlimited manual discount and an arbitrary tax at the POS

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **High** | P1 | S | Low | Fixed |

**Location:** `server/api.mjs` → `checkout()` (route `POST /checkout`, guard `worker`).

**Evidence:**
```js
let discount=paisa(b.discount??0,'Discount'),tax=paisa(b.tax??0,'Tax'), ...
discount+=loyaltyDiscount;if(discount>subtotal)throw fail('Discount exceeds subtotal');let total=subtotal-discount+tax,
received=b.received===''||b.received==null?(payment==='Credit'?0:total):paisa(b.received,'Amount received');
```

**Impact:** The only constraint on a manual discount is that it does not exceed the subtotal. A cashier rings up Rs 5,000 of goods with `discount: "5000"` and `received: "0"`: the receipt is valid, stock is deducted, nothing requires a reason or approval, and nothing alerts the owner (the activity trigger logs a plain `receipts INSERT`). The `tax` figure is likewise free text; `products.tax_rate_bps` is stored but never used to compute it, so tax reporting is whatever was typed. The loyalty rule blocks stacking points with a manual discount but not the size of the discount.

**Fix (see F4):** add a role-based cap (`STAFF_MAX_DISCOUNT_BPS`, `STAFF_MAX_DISCOUNT_PAISA`; owner unlimited); compute `tax` server-side from each line's `tax_rate_bps` and ignore the client value; add `receipts.discount_reason` (required when discount > 0); insert an explicit `activity_events` row `('receipts', receipt, 'DISCOUNT')` when the discount exceeds a threshold so it appears in the owner's activity feed.

**Verify:** `tests/checkout-policy.test.mjs` — staff discount above the cap returns 403; owner succeeds; tax in the response equals the computed per-line tax regardless of the client's `tax` field.

**Related:** C1, S4.

---

#### S4 — Vendors can change the selling price, cost, name, barcode and unit of products the store already stocks and sells

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **High** | P1 | S | Low | Fixed |

**Location:** `server/api.mjs` → `saveProduct(b, productId, actor)` (routes `POST /products`, `PUT /products/:id`, allowed for `['admin','vendor']`).

**Evidence:**
```js
// fields = [name,sku,barcode,brand,category,packSize,unit,location,vendorId,cost,price,reorder,reorderQty,taxRate,image,description]
if(actor.role==='vendor'){const old=exists.rows[0];fields[1]=old.sku;fields[7]=old.location;fields[11]=old.reorder_milli;fields[12]=old.reorder_qty_milli;fields[13]=old.tax_rate_bps;}
```
Indices 0 (name), 2 (barcode), 4 (category), 6 (unit), 9 (`cost_paisa`) and 10 (`price_paisa`) are written from the vendor's request body.

**Impact:** `checkout()` prices every line live from `p.price_paisa` and records `cost_at_sale_paisa` from `p.cost_paisa`. A vendor who signs in to `/vendor` can set `price` to `0.01` on a product the owner has already received and paid for, and staff will sell it at that price (the POS shows the database price). Setting `cost` to `0` makes `costsKnown` false and silently disables loyalty; setting it high makes gross profit negative and corrupts every margin report. Renaming, re-barcoding or changing `unit` from `kg` to `piece` changes what the scanner sells. The README promises that stock stays zero until the owner records it, but says nothing about price control; `adminOverview()` and `awardPoints()` trust these fields.

**Fix (see F5):** for `actor.role==='vendor'` on update, also preserve `price_paisa`, `cost_paisa`, `name`, `barcode`, `unit` and `category` once the product has any `stock_movements`, `purchases` or `sales` row (or always, and store the vendor's wish in a new `vendor_proposed_price_paisa` column that the owner approves from the Vendors screen). Consider creating vendor-submitted products with `catalog_status='hidden'` until the owner reviews them.

**Verify:** extend `tests/vendor-flow.test.mjs` — after the owner records a purchase, a vendor `PUT` with a new `price` returns 200 but `price_paisa` is unchanged (or the proposal column is set).

**Related:** S3.

---

#### S5 — No security headers; the password-reset token travels in the URL

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Medium** | P0 | S | Low (headers) / Med (CSP, mitigated by Report-Only) | Fixed (CSP in Report-Only) |

**Location:** `vercel.json` (no `headers` block); `index.html` (no CSP meta); `server/api.mjs` → `json()` (only `content-type` and `cache-control`); `server/account-security.mjs` → `issueReset()`; `src/account-security.jsx` → `PasswordHelp`.

**Evidence:**
```json
{"version":2,"functions":{"api/index.js":{"maxDuration":30}},"rewrites":[{"source":"/api/(.*)","destination":"/api/index.js"},{"source":"/(.*)","destination":"/index.html"}]}
```
```js
return {path:'/reset-password?token='+token,email:r.email,expiresMinutes:30}
```

**Impact:** The admin and POS pages can be framed by any site (clickjacking of the "Complete sale", "Approve vendor" and "Set stock" buttons). There is no HSTS, so a first visit over HTTP is not upgraded. There is no CSP, so any future injection bug is unmitigated. The reset token sits in the query string, so it lands in browser history, proxy logs and the `Referer` of the Google Fonts requests the reset page makes. Only `/api/images/*` and the avatar route send `X-Content-Type-Options`.

**Fix (see F6 and Appendix E):** add `headers` to `vercel.json` with `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=()`, `Cross-Origin-Opener-Policy: same-origin-allow-popups` (Firebase popups need this value), and a CSP shipped first as `Content-Security-Policy-Report-Only`. Give `/reset-password` `Referrer-Policy: no-referrer`, move the token to `location.hash` (`/reset-password#token=…`) and read it with `new URLSearchParams(location.hash.slice(1))`, keeping query support for one release. Add `nosniff` in `json()` for non-Vercel hosting.

**Verify:** `curl -I https://<host>/admin` shows the headers; a walkthrough of all four portals including Google sign-in and phone OTP produces no CSP violation in DevTools; `tests/security.test.mjs` asserts `x-content-type-options` on JSON responses.

**Related:** S7, M4.

---

#### S6 — Inconsistent password policy and synchronous `scrypt` on the event loop

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Medium** | P1 | S | Low | Fixed |

**Location:** `server/api.mjs` routes `/setup` and `POST /accounts`; `server/auth.mjs` → `passwordHash()`, `verify()`; `server/bulk-import.mjs` → customer rows.

**Evidence:**
```js
// /setup and /accounts
if(password.length<6||password.length>128)throw fail('Password must be 6–128 characters');
// /customer/signup, /vendor/apply, account-security.mjs
if(password.length<8||password.length>128)throw fail('Password must be 8–128 characters');
// auth.mjs
export function passwordHash(password,salt){return scryptSync(password,salt,64).toString('hex')}
```

**Impact:** The two most privileged accounts (owner, staff) accept the weakest passwords. `scryptSync` with the default cost (N = 16384, r = 8, p = 1) blocks the Node event loop for tens of milliseconds per call; on a single-instance function that stalls every concurrent request, including the 3-second polls. A signup loop (S2) is therefore also a CPU denial of service, and the bulk importer hashes up to 80 customer passwords synchronously inside one 30-second function invocation (D1).

**Fix (see F12):** centralize `PASSWORD_MIN = 8` (consider 12 for owner/staff) in `auth.mjs` with a `checkPassword(p)` helper used by every route; switch to `promisify(scrypt)` with `{N: 2**17, r: 8, p: 1, maxmem: 256 * 1024 * 1024}` and async call sites; keep the sync exports for one release so existing tests still import.

**Verify:** `tests/security.test.mjs` — `/setup` with a 7-character password returns 400; `tests/flow.test.mjs` continues to pass with the async hash.

**Related:** S2, S8, D1.

---

#### S7 — The CSRF Origin check throws on malformed or `null` Origins and trusts `x-forwarded-host`

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Medium** | P0 | S | Low | Fixed |

**Location:** `server/api.mjs` → top of `handleRequest()`.

**Evidence:**
```js
if(['POST','PUT','PATCH','DELETE'].includes(method)&&req.headers.origin){let o=new URL(req.headers.origin),host=req.headers['x-forwarded-host']||req.headers.host;if(o.host!==host){ ... throw fail('Cross-site request blocked',403)}}
```

**Impact:** `Origin: null` (sandboxed iframes, some redirects, `file://` pages) or any garbage value throws `TypeError: Invalid URL` before the check, which the catch-all turns into a generic 500 and a logged stack trace. That is a log-spam vector and masks a security decision as a server error. `x-forwarded-host` is honoured unconditionally; on Vercel it is set by the platform, but behind the Vite dev proxy (which does not set `xfwd`) or any self-hosted reverse proxy that passes client headers through, a non-browser client can satisfy the check with a forged header. Real CSRF is already mitigated by `SameSite=Strict`/`Lax` cookies and the absence of CORS headers, so this is defence in depth, but it should fail closed with a 403.

**Fix:**
```js
function sameOrigin(req){
  const origin=req.headers.origin; if(!origin) return true;
  let o; try{o=new URL(origin)}catch{return false}
  const allowed=(process.env.APP_ORIGINS||'').split(',').filter(Boolean);
  if(allowed.length) return allowed.includes(o.origin);
  const host=process.env.VERCEL?(req.headers['x-forwarded-host']||req.headers.host):req.headers.host;
  if(o.host===host) return true;
  return process.env.NODE_ENV!=='production'&&['localhost','127.0.0.1'].includes(o.hostname);
}
// in handleRequest: if(MUTATING.has(method)&&!sameOrigin(req))throw fail('Cross-site request blocked',403);
```
Set `APP_ORIGINS=https://<production-domain>` in Vercel.

**Verify:** `tests/security.test.mjs` — `Origin: null` on `/login` returns 403 (not 500); an authenticated `sm_session` cookie plus `Origin: https://evil.example` on `POST /expenses` returns 403 (currently untested, T1).

**Related:** S5, T1.

---

#### S8 — Account enumeration through status codes and timing

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Low** | P1 | S | Low | Fixed (409 wording kept) |

**Location:** `server/api.mjs` routes `/customer/signup`, `/vendor/apply`, `/customer/social`, `/customer/login`, `/account/login`.

**Evidence:**
```js
if(e.code==='23505')throw fail('This email already has an account. Please sign in.',409);
if(!account||!verify(String(b.password||''),account.salt,account.password_hash))throw fail('Incorrect email or password',401);
```

**Impact:** The 409s confirm whether an email has a customer, staff or vendor account. On the login routes `verify()` (a full `scrypt`) runs only when the account exists, so an unknown email answers roughly 60 ms faster than a known one; with S2 unthrottled this is a cheap oracle for harvesting customer emails.

**Fix:** when the account is missing, still call `verify(password, DUMMY_SALT, DUMMY_HASH)` before returning 401; rate-limit the 409 paths (S2); optionally return a neutral 202 from `/vendor/apply`.

**Verify:** timing assertion in `tests/security.test.mjs` that unknown and known emails on `/customer/login` differ by less than 20 ms over 10 samples (soft check), or a unit test that `verify` is invoked on the unknown-email path.

**Related:** S2.

---

#### S9 — Sessions never expire server-side, cookies lack the `__Host-` prefix, and `Secure` depends on `NODE_ENV`

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Low** | P1 | S | Low (dual-name grace period) | Fixed |

**Location:** `server/auth.mjs` → `cookie()`, `tokenFrom()`; `server/api.mjs` → `customerCookie()`, all session `INSERT`s; `server/db.mjs` (no cleanup).

**Evidence:**
```js
"INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '7 days')"
return `sm_session=${clear?'':token}; HttpOnly; SameSite=Strict; Path=/; ${process.env.NODE_ENV==='production'?'Secure; ':''}Max-Age=${clear?0:604800}`
```

**Impact:** Expired rows in `sessions`, `account_sessions`, `customer_sessions` and `password_reset_tokens` are never deleted (they are filtered by `expires_at>NOW()` on read, so they only cost storage and index size). There is no sliding expiry, so an active cashier is logged out every seven days mid-shift. Without the `__Host-` prefix a subdomain could set a competing `sm_session` cookie. Self-hosting with `npm start` behind TLS does not set `NODE_ENV=production`, so cookies are issued without `Secure`.

**Fix:** sweep expired rows (part of the F1 sweeper); set `Secure` when `process.env.VERCEL || req.headers['x-forwarded-proto']==='https' || NODE_ENV==='production'`; in production emit `__Host-sm_session` / `__Host-sm_customer` and accept both names for one release; optionally refresh `expires_at` on use when less than a day remains.

**Verify:** `tests/db.test.mjs` — `sweep()` deletes a session with `expires_at` in the past; `tests/security.test.mjs` — a request with `x-forwarded-proto: https` receives a `Secure` cookie.

**Related:** S2, F1.

---

#### S10 — Firebase Bearer identities without a store profile hit foreign-key errors and return 500

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Low** | P2 | S | Low | Fixed |

**Location:** `server/api.mjs` → `customerSession()` and routes `/customer/preferences`, `/customer/avatar`, `/customer/overview`, `/customer/password`; `server/customer-auth.mjs`.

**Evidence:**
```js
if(req.headers.authorization?.startsWith('Bearer '))return customerFrom(req);   // returns {id: firebaseUid, ...}
"INSERT INTO customer_shopping_preferences(customer_id,fulfillment,phone,address) VALUES($1,$2,$3,$4) ..."  // FK → customer_accounts(id)
```

**Impact:** `customerFrom()` returns the Firebase uid as `id`. `placeOrder` tolerates that (no FK on `customer_orders.customer_uid`), but `/customer/preferences` POST and `/customer/avatar` POST violate the FK (`23503`) and surface as "Server error" with a logged stack; `/customer/overview` returns 404 and `/customer/password` says the current password is wrong. The live storefront no longer sends Bearer tokens (the code paths that did are dead, C17), so this is latent, but the API still accepts them.

**Fix:** have `customerSession()` return `{...identity, linked:false}` for Bearer identities with no `customer_accounts` row and make those routes answer `409 "Create a Star Mart profile first"`; map `23503`/`23514` to 4xx in the catch-all (C12). Longer term either link Firebase uids to `customer_accounts` through `customer_identities` on first use or drop the Bearer path from `customerSession`.

**Verify:** `tests/customer-auth.test.mjs` — a request with a Bearer header for an unlinked uid to `/customer/preferences` returns 409, not 500.

**Related:** C12, C17.

---

#### S11 — Known-vulnerable dependencies and build tooling in `dependencies`

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Low** | P2 | S | Low | Partially fixed (transitive advisories remain) |

**Location:** `package.json`, `package-lock.json`.

**Evidence (`npm audit --omit=dev`, 2026-10-09):**

| Package | Path | Severity | Advisory | Used by this app? |
|---|---|---|---|---|
| `@grpc/grpc-js` ≤ 1.13.5 | `firebase` → `@firebase/firestore` | High ×2 | GHSA-m9gg-hp2v-232j, GHSA-f596-whhp-79r4 | No — only `firebase/app` and `firebase/auth` are imported; Firestore is tree-shaken out of the bundle |
| `source-map-js` 1.0.0–1.2.1 | Vite toolchain | High | GHSA-68fv-2mgg-jv7q | Build time only |
| `uuid` < 11.1.1 | `firebase-admin` → `gaxios` | Moderate | GHSA-w5hq-g745-h8pq | Server, only when a Bearer token arrives |

`tailwindcss` and `@tailwindcss/vite` are listed under `dependencies` while `vite` is a devDependency. `tw-animate-css` is not installed although the shadcn components use its classes (M5).

**Impact:** No exploitable path was found, but the audit will fail any policy gate, and `npm audit fix --force` would downgrade `firebase` to 9.x and break the build.

**Fix:** `npm audit fix` (non-breaking) now; bump `firebase` and `firebase-admin` to the first releases that pull patched transitive versions; move `tailwindcss`, `@tailwindcss/vite` to `devDependencies`; add `npm audit --audit-level=high` to CI (non-blocking until clean).

**Verify:** `npm audit --omit=dev --audit-level=high` exits 0.

**Related:** M5, D1.

---

#### S12 — Customer PII is kept in `sessionStorage` and not cleared on failure

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Low** | P2 | S | Low | Fixed |

**Location:** `src/shop.jsx` → `checkout()` (writes `star-checkout-details`, `star-order-attempt`) and the session-restore effect (reads and removes `star-checkout-details`).

**Evidence:** `star-checkout-details` holds `{name, phone, address, note, paymentMethod, paymentReference}`; `star-order-attempt` holds `{fingerprint, key}` where the fingerprint is the full order payload as JSON.

**Impact:** On a shared or kiosk browser the previous shopper's name, phone, delivery address and bank-transfer reference remain readable until the tab closes or the next successful order. A failed order leaves `star-order-attempt` behind indefinitely.

**Fix:** own the keys in one `useCheckoutDraft()` hook (R5) that clears them on terminal failure and on logout; store only the idempotency key and a hash of the payload, not the payload itself.

**Verify:** manual — place an order that fails validation, reload, inspect `sessionStorage`: no PII present.

**Related:** C9, R5.

---

#### S13 — Minor hardening observations

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Info** | P3 | S | Low | Fixed |

- **CSV formula injection** — `src/vendor.jsx` `csvDownload` quotes fields but does not neutralize leading `=`, `+`, `-`, `@`; a product named `=HYPERLINK(...)` executes when the export is opened in Excel. Prefix such cells with `'`.
- **Guest name becomes the audit actor** — `api.mjs` `setActor('WhatsApp guest: '+customer.name)` stores free text in `activity_events.actor`. React escapes it in the admin, so no XSS, but store the guest id instead of the name.
- **Staff can list every customer's email and phone** — `GET /customers` (guard `worker`) returns all rows with no paging. Acceptable for POS lookup; consider prefix search with a limit.
- **`/setup` is first-visitor-wins on a fresh deployment** — the race is safely resolved by the `'owner'` primary key, but a `SETUP_SECRET` environment variable required by `/setup` on Vercel removes the window entirely.
- **`Secure` flag and `localDev` ports are hard-coded** — the Origin allow-list enumerates ports 5173–5176 and 8787; move to `APP_ORIGINS` (S7).

---

#### S14 — Image handling notes

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Info** | P3 | S | Low | Fixed |

**Location:** `server/api.mjs` → `imageBody()`, routes `POST /products/:id/image`, `POST /customer/avatar`, `GET /images/:id`.

Magic-byte sniffing (JPEG/PNG/WebP only, no SVG), the 1 MB cap and `X-Content-Type-Options: nosniff` on responses are correct. Two improvements: (1) the data is sent to Postgres as `decode($2,'base64')`, doubling the wire size — `pg` accepts a `Buffer` directly for `BYTEA` parameters; (2) there is no pixel-dimension check, so a 1 MB PNG can still be a 10,000 × 10,000 decompression bomb for the browser. The client resizes before upload, but the server should not rely on that; reading the IHDR/SOF header for dimensions is a few lines.

---
### 4.2 Correctness & business logic

#### C1 — A POS sale can be recorded twice: the client reports success as failure, and the server has no idempotency key

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **High** | P0 (client) / P1 (server) | M | Low–Med | Fixed |

**Location:** `src/main.jsx` → `action()`, `checkout()`; `server/api.mjs` → `checkout()`.

**Evidence:**
```js
// main.jsx — the refresh runs inside the same try as the write
async function action(path,method,payload,onDone){setBusy(true);setError('');try{let result=await api(path,method,payload);await refresh();onDone?.(result);flash('Saved successfully.');return result}catch(e){setError(e.message);return null}finally{setBusy(false)}}
// api.mjs — receipt id is time-based; nothing ties a retry to the first attempt
receipt='SM-'+Date.now().toString(36).toUpperCase()+'-'+id().slice(0,4).toUpperCase();
```
Compare `server/orders.mjs` `placeOrder`, which already implements `requestKey` + `request_hash` + a partial unique index for online orders.

**Impact:** `refresh()` makes four requests (`/me`, `/state`, `/orders`, `/customers`, then `/admin/activity`). If any of them fails after `POST /checkout` has committed (Neon wake-up, a 502, a flaky network), the code lands in `catch`: `onDone` never runs, the cart stays full, no receipt is shown and the cashier sees an error. They press "Complete sale" again and the server, having no idempotency key, records a second receipt, deducts stock twice, awards loyalty points twice (the `awardPoints` guard is per receipt id, which differs) and, for a credit sale, doubles the customer's debt. There is no returns or refund path to undo it. The same shape affects purchases and expenses: the modal stays open after a successful save and invites a second save. A 30-second Vercel timeout on a slow checkout produces the same retry without any client bug.

**Fix (see F3):**
- Client: run `onDone` and the success toast immediately after the write resolves; run the refresh in its own try and show "Saved. Refreshing…" if it fails.
- Server: add `receipts.request_key TEXT` and `request_hash TEXT` with `CREATE UNIQUE INDEX … ON receipts(request_key) WHERE request_key IS NOT NULL`; in `checkout()` validate `requestKey` with the `placeOrder` regex, prefix it with the cashier's account id, look it up inside the transaction and return the stored result on replay (409 if the payload hash differs).
- Client POS: generate `crypto.randomUUID()` when the cart becomes non-empty, send it as `requestKey`, rotate only after a 2xx — the same pattern `shop.jsx` already uses with `star-order-attempt`.

**Verify:** `tests/checkout-idempotency.test.mjs` — two sequential `POST /checkout` with the same key yield one `receipts` row and identical bodies; same key with a changed basket returns 409; two concurrent posts (`Promise.all`) yield exactly one receipt and one set of `stock_movements`.

**Related:** S3, P2 (the double refresh), F11.

---

#### C2 — `init()` memoizes a rejected promise and runs racy DDL on every cold start

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **High** | P0 | S | Low | Fixed |

**Location:** `server/db.mjs` → `init()`.

**Evidence:**
```js
export function init(){initialized ||= (async()=>{ ... ≈60 DDL statements ... })();return initialized}
await d.query(`CREATE OR REPLACE FUNCTION star_mart_log_change() RETURNS trigger AS $$ ... $$ LANGUAGE plpgsql`);
await d.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='star_mart_activity' AND tgrelid='${table}'::regclass) THEN CREATE TRIGGER star_mart_activity ... END IF; END $$`);
```

**Impact:** Every request awaits `init()`. If the first run on an instance rejects, `initialized` holds that rejected promise forever and the instance answers "Server error" to every request until Vercel recycles it. Rejection is not rare: a Neon auto-suspend wake-up can time out; and when two instances cold-start together, `CREATE OR REPLACE FUNCTION` raises `tuple concurrently updated` on the loser, while the `IF NOT EXISTS … CREATE TRIGGER` block is not atomic and raises `trigger "star_mart_activity" already exists`. Under Vercel Fluid Compute one poisoned instance serves a slice of all traffic. Independently, ≈60 DDL round-trips per cold start add latency and WAL churn to the first request after every idle period (P8).

**Fix (see F7):**
```js
export function init(){
  initialized ||= run().catch(e=>{initialized=null;throw e});
  return initialized;
}
async function run(){ const d=await db();
  await d.query('SELECT pg_advisory_lock(727401)');            // serialize migrators across instances
  try{ const v=await currentSchemaVersion(d); if(v<SCHEMA_VERSION){ ...DDL...; await setSchemaVersion(d,SCHEMA_VERSION) } }
  finally{ await d.query('SELECT pg_advisory_unlock(727401)') } }
```
Store the version in a one-row `schema_meta(key,value)` table so steady-state cold starts run one `SELECT`. In `handle()`, map an `init()` failure to `503` with `retry-after: 5` so `useLiveRefresh` backs off naturally. (PGlite has no concurrent instances; the advisory lock is harmless there.)

**Verify:** `tests/db.test.mjs` — stub `db()` to reject once, call `init()` twice, assert the second call succeeds; assert a second `init()` on a fresh connection runs no DDL when the version matches.

**Related:** P8, C4, D1.

---

#### C3 — About twenty writes bypass `tx()`: lost writes on PGlite, lost audit actor on Postgres

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **High (PGlite) / Medium (pg)** | P1 | M | Low (mechanical) | Fixed |

**Location:** `server/db.mjs` → `tx()`; `server/api.mjs` routes `/customer/signup`, `/customer/login`, `/customer/social` (session insert), `/login`, `/account/login`, `/admin/firebase-login`, `/admin/link`, `/customer/logout`, `/logout`, `/customer/avatar` POST, `/products/:id/image` (two statements), `/vendor/applications/:id/reject`, `POST /accounts`, `PATCH /accounts/:id`, `POST /vendors`, `PUT /vendors/:id`, `POST /expenses`; `server/catalog-actions.mjs` is fine (uses `tx`).

**Evidence:**
```js
// db.mjs — only tx() goes through the PGlite queue and sets the actor
let release;const previous=localQueue;localQueue=new Promise(r=>release=r);await previous;
try{await database.query('BEGIN');try{await database.query("SELECT set_config('star_mart.actor',$1,true)",[currentActor()]); ...
// api.mjs — a typical bypass
let r=await (await db()).query('INSERT INTO expenses(id,category,description,amount_paisa,payment,reference) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', ...)
```

**Impact:**
- **PGlite (local dev, tests, and any shop running `npm start` without a Postgres URL):** PGlite is a single session. A raw `INSERT` issued while another request's `tx()` is between `BEGIN` and `ROLLBACK` executes inside that transaction and is discarded with it, after the client has already received a 201 and a session cookie. A failing bypass statement (for example a duplicate `store_accounts.email`) aborts the other request's open transaction with "current transaction is aborted". Tests share the engine, so this is also a source of flakiness.
- **Postgres (production):** no interleaving, but `set_config('star_mart.actor', …, true)` is transaction-local and only `tx()` sets it, so every expense, vendor edit, staff account change, image upload, application rejection and admin link is logged in `activity_events` as `Store operation`. The README promises the actor field; the owner cannot tell who added an expense.

**Fix (see F10):** route every write through `tx(c=>…)`; multi-statement branches (signup = account + session; image upload = `product_images` + `products.image`) become one transaction. Then make the pattern impossible by construction: once the router exists (R1), `dispatch()` opens the transaction for any body-bearing route and hands the client to the handler (R4).

**Verify:** `tests/db.test.mjs` — start a `tx()` that awaits a deferred promise, issue a plain `db().query('INSERT …')` concurrently, throw inside the `tx`, assert the plain insert survived (this documents the hazard and fails if the helper regresses); `grep -c "(await db()).query('INSERT\|UPDATE\|DELETE" server/*.mjs` is 0 after the change.

**Related:** C4, R1, R4.

---

#### C4 — The `pg` pool has no error handler or timeouts; a failed `ROLLBACK` masks the real error

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Medium** | P1 | S | Low | Fixed |

**Location:** `server/db.mjs` → `db()`, `tx()`.

**Evidence:**
```js
pool ||= new Pool({connectionString:process.env.DATABASE_URL,max:process.env.VERCEL?1:5});
... catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
```

**Impact:** `pg` emits `'error'` on the pool when an idle client is closed by the server. Neon closes idle connections after a few minutes. With no listener, Node raises an unhandled `'error'` event and the process exits: `npm run dev` or `npm start` pointed at Neon dies after the first idle period. On Vercel the instance is killed mid-request instead. In `tx()`, if the socket is already gone, `ROLLBACK` throws, replacing the original error, and `c.release()` returns a broken client to the pool.

**Fix:**
```js
pool ||= new Pool({connectionString:process.env.DATABASE_URL,max:process.env.VERCEL?1:5,idleTimeoutMillis:20_000,connectionTimeoutMillis:10_000});
pool.on('error',e=>console.error('pg idle client error',e));
...
catch(e){try{await c.query('ROLLBACK')}catch{} c.release(e); throw e}
```
(`c.release(err)` destroys the client instead of returning it.)

**Verify:** `tests/db.test.mjs` with a mocked `Pool` that emits `'error'` — the process does not exit; a `ROLLBACK` that throws still surfaces the original error.

**Related:** C2, C3.

---

#### C5 — Soft-deleted products still hold their unique SKU/barcode; bulk import matches them and bulk "show" resurrects them

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Medium** | P1 | S | Low | Fixed |

**Location:** `server/db.mjs` schema (`sku TEXT UNIQUE, barcode TEXT UNIQUE`); `server/catalog-actions.mjs` → `catalogAction()`; `server/bulk-import.mjs` → product rows.

**Evidence:**
```js
// catalog-actions.mjs — "delete" is a soft delete …
"UPDATE products SET deleted_at=NOW(),catalog_status='archived',updated_at=NOW() WHERE id=ANY($1::text[])"
// … and "show" un-deletes anything selected
'UPDATE products SET catalog_status=$1,deleted_at=CASE WHEN $1=\'active\' THEN NULL ELSE deleted_at END,updated_at=NOW() WHERE id=ANY($2::text[])'
// bulk-import.mjs — matches deleted rows too
'SELECT id,sku FROM products WHERE sku=$1 OR ($2::text IS NOT NULL AND barcode=$2)'
```

**Impact:** Re-adding a product with the barcode of a deleted one fails with a bare "A record with these details already exists." Bulk import finds the deleted row, counts it as "skipped" and the product stays invisible. Selecting a deleted product in the catalog and choosing "show" silently restores it.

**Fix (see F9):** replace the column constraints with `CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku_live ON products(sku) WHERE deleted_at IS NULL` (and the same for `barcode`); add `AND deleted_at IS NULL` to the import match (or un-delete explicitly with a report line); make `show` refuse rows with `deleted_at IS NOT NULL`. Dropping the old constraints needs `ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sku_key, DROP CONSTRAINT IF EXISTS products_barcode_key` in `init()`.

**Verify:** `tests/bulk-action.test.mjs` — delete, then `POST /products` with the same barcode succeeds; bulk import of the same SKU creates a new live row; `show` on a deleted id returns 409.

**Related:** C16.

---

#### C6 — The legacy importer accepts far more than one 30-second invocation can process

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Medium** | P2 | M | Low | Fixed |

**Location:** `server/import.mjs` → `importLegacy()`; `vercel.json` (`maxDuration: 30`); `server/api.mjs` → `body()` (2 MB cap).

**Evidence:**
```js
if(data.products.length>10000||data.purchases.length+data.sales.length>100000)throw Error('Backup is too large');
// then ≥2 INSERTs per product/purchase/sale row inside one tx
```

**Impact:** At 3–5 ms per Neon round trip, 5,000 sales already cost ≈40 s. Vercel kills the function, the open transaction rolls back when the socket drops, and the owner sees a generic error, retries, and gets the same result. The 2 MB JSON cap means the advertised 100,000-row limit cannot even be uploaded; the two limits contradict each other.

**Fix:** batch inserts with `INSERT … SELECT * FROM unnest($1::text[], $2::text[], …)` or multi-row `VALUES`, cutting round trips by ~50×; or have the admin client chunk the backup into ≤500-row batches with an import session id and resumable progress (the bulk importer already works this way); lower the hard caps to what 30 s can do and align the body cap.

**Verify:** a 5,000-sale fixture imports in under 10 s against PGlite; the body cap and row caps are documented in the same place.

**Related:** D1.

---

#### C7 — Receipts are linked to online orders by matching note text

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Medium** | P1 | S | Low | Fixed |

**Location:** `server/customer-ledger.mjs` → `customerOverview()`; `server/orders.mjs` → `changeOrder()` (writes `note='Order '+order.id`).

**Evidence:**
```sql
(SELECT r.id FROM receipts r WHERE r.customer_id=o.customer_uid AND r.note='Order '||o.id LIMIT 1) receipt_id
```

**Impact:** The POS `note` field is cashier free text (`str(b.note,1000)`). A counter bill annotated "Order SMO-…" is reported on the customer dashboard as that online order's receipt; a changed note format breaks the link for all future orders. There is no index on `receipts.note`, so this is also a per-order scan.

**Fix:** `ALTER TABLE receipts ADD COLUMN IF NOT EXISTS order_id TEXT REFERENCES customer_orders(id)`; set it in `changeOrder`; backfill once with `UPDATE receipts SET order_id=substring(note from '^Order (SMO-[A-Z0-9-]+)$') WHERE order_id IS NULL AND note LIKE 'Order SMO-%' AND EXISTS (SELECT 1 FROM customer_orders o WHERE o.id=…)`; join on it in `customerOverview`.

**Verify:** `tests/storefront-payments.test.mjs` — after fulfilment, `receipts.order_id` equals the order id and `customerOverview().orders[0].receipt_id` matches.

**Related:** C1.

---

#### C8 — The credit-collection modal shares one amount box across every bill

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Medium** | P1 | S | Low | Fixed |

**Location:** `src/main.jsx` → `CreditCollection`.

**Evidence:** a single `[amount,setAmount]=useState('')` is bound to the input in every unpaid-bill row; "Record payment" on any row posts that one value for that row's `receiptId`.

**Impact:** Typing in one row fills every row. With two unpaid bills visible, a cashier who enters Rs 500 for the first and clicks "Record payment" on the second settles the wrong bill; the server's `amount>due` check only catches it when the amount exceeds that bill.

**Fix:** key the state by bill id (`useState({})`, `amount[bill.id]`), or render one `CreditRow` component with its own state; disable the button until the row's own value is positive and ≤ `duePaisa/100`.

**Verify:** manual — two unpaid bills, enter different amounts, each posts its own value. A component test if a DOM test runner is introduced.

---

#### C9 — Restored checkout details are overwritten by the later preferences fetch

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Medium** | P1 | S | Low | Fixed |

**Location:** `src/shop.jsx` → `setFulfillment()` (clears `paymentReference`), the `star-checkout-details` restore effect, and the `/api/customer/preferences` effect.

**Evidence:** both effects fire when `user` becomes set; the preferences fetch resolves later and calls `setFulfillment(p.fulfillment)`, which resets `paymentReference`, then overwrites `phone` and `address`.

**Impact:** In the sign-up-then-return flow the shopper's typed delivery address and bank-transfer reference vanish after they sign in; they either re-type or submit an order without the reference (the server then rejects transfer orders with "Enter a transfer reference").

**Fix:** apply server preferences only when the local draft is empty (`if(!draft.address) setAddress(p.address)`), and do not clear `paymentReference` inside `setFulfillment` when the method is unchanged. Owning both in `useCheckoutDraft()` (R5) makes the ordering explicit.

**Verify:** manual flow: fill address + reference as guest → sign up → return: both values persist. Unit test on the hook once extracted.

**Related:** S12, R5.

---

#### C10 — `npm test` writes to the real database when `DATABASE_URL` is in the environment

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Medium** | P0 | S | Low | Fixed |

**Location:** `server/db.mjs` → `db()`; every file in `tests/`.

**Evidence:**
```js
export async function db(){if(process.env.DATABASE_URL){pool ||= new Pool(...);return pool} ... local=new PGlite(process.env.STAR_MART_DATA_DIR||'./.data')}
// tests set STAR_MART_DATA_DIR to a temp dir but never clear DATABASE_URL
```

**Impact:** `DATABASE_URL` wins. A developer who has exported it (direnv, `vercel env pull` followed by `source`) runs `npm test` and the suite executes `/setup`, inserts customers, products and orders, and fulfils them against the live Neon store. `close()` only ends the pool; nothing is cleaned up. `npm test` does not read `.env.local`, so keeping the URL only there is safe today, which is why this has not yet caused damage.

**Fix (see F12):** in `db()`, prefer PGlite whenever `STAR_MART_DATA_DIR` is set or `NODE_ENV==='test'`, unless `STAR_MART_FORCE_PG=1` (explicit opt-in for a throwaway Neon branch); add `tests/helpers.mjs` with `isolate()` that deletes `DATABASE_URL` and `VERCEL`, plus the shared `withTempDb()` and `request()` currently copy-pasted in every test file.

**Verify:** `tests/db.test.mjs` — with both `DATABASE_URL` and `STAR_MART_DATA_DIR` set, `db()` returns a PGlite instance.

**Related:** T1.

---

#### C11 — Closing a pickup order validates the cash received but stores the order total

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Low** | P1 | S | Low | Fixed |

**Location:** `server/orders.mjs` → `changeOrder()` (`ClosePickup`).

**Evidence:**
```js
let received=paisa(body.received,'Amount received');if(received<Number(order.total_paisa))throw fail('Collect the full order total before closing the sale');
... 'INSERT INTO receipts(id,subtotal_paisa,discount_paisa,tax_paisa,total_paisa,received_paisa,...) VALUES($1,$2,0,0,$3,$4,...)',[receipt,order.total_paisa,order.total_paisa,order.total_paisa,...]
... received:pickup?paisa(body.received):Number(order.total_paisa)   // the response reports the real figure
```

**Impact:** `dailySales()` sums `received_paisa` for cash reconciliation; change given on pickup orders is under-reported, and the printed receipt disagrees with the stored one.

**Fix:** pass `received` (not `order.total_paisa`) as the sixth insert parameter.

**Verify:** `tests/orders.test.mjs` — close a pickup with `received` above total; the receipt row's `received_paisa` equals the posted amount.

---

#### C12 — Error handling: non-object bodies crash, constraint violations surface as 500, and the 500→400 mapping is a regex on message text

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Low** | P0 | S | Low | Fixed |

**Location:** `server/api.mjs` → `body()` and the catch-all at the end of `handleRequest()`; `server/money.mjs` (throws plain `Error`).

**Evidence:**
```js
try{return JSON.parse(Buffer.concat(chunks).toString()||'{}')}catch{throw fail('Invalid JSON')}   // null, [], "x" pass
let status=e.status||((e.code==='23505')?409:500);if(status===500&&/must be|supports at most|outside the allowed range|is required|too large/.test(e.message))status=400;
```

**Impact:** A body of `null` or `[]` makes `b.lines` throw a `TypeError` → 500 + stack trace. FK (`23503`) and CHECK (`23514`) violations show "Server error. Check database connection and server logs." for what is a client mistake. Changing an error message in `money.mjs` silently turns a 400 into a 500.

**Fix:** in `body()`: `if(!v||typeof v!=='object'||Array.isArray(v))throw fail('Invalid JSON')`; give `fixed()`/`wholeQuantity()` a `status: 400` property (or a `ValidationError` class) and delete the regex; map `23503`→409 "Related record not found", `23514`→400 "Value out of range", `40P01` (deadlock) → 409 "Please retry".

**Verify:** `tests/security.test.mjs` — `POST /checkout` with body `null` returns 400; a CHECK violation returns 400.

**Related:** S10.

---

#### C13 — Client correctness glitches (grouped)

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Low** | P0–P2 | S each | Low | Fixed |

| # | Where | Glitch | Fix |
|---|---|---|---|
| a | `src/main.jsx` `flash`/toast effect | `setToast(s)` + an effect on `[toast]` means the same message within 3.5 s never re-notifies ("Saved successfully." twice shows once) | call `notify.success` directly; drop the intermediate state |
| b | `src/main.jsx` `App` | one shared `error` state feeds the banner, the record modal, the legacy-import dialog and the link modal; errors leak between them | per-surface error state or an error object keyed by surface |
| c | `src/main.jsx` `logout` | resets `data` and `cart` but not `orders`, `customers`, `activities`, `accounts`, `customerInfo`; the next user on the same tab sees the previous user's lists until a refresh | reset all state, or remount `App` with a `key` |
| d | `admin-catalog.jsx`, `pickup-desk.jsx`, `store-settings.jsx` | `throw Error(j.error)` with no fallback → empty error banners on non-JSON failures | `throw Error(j.error||'Request failed ('+r.status+')')`, after checking `r.ok` |
| e | `src/main.jsx` image resize | `canvas.toBlob` can return `null`; `blob.size` then throws (bulk-import handles this; main does not) | guard `if(!blob)` |
| f | `pickup-desk.jsx`, `main.jsx` image/stock URLs | ids concatenated without `encodeURIComponent` (every other call encodes) | encode consistently in one `api()` helper |
| g | `barcode-scanner.jsx` | `keydown` listener on `document` closes on Escape; inside the Radix record dialog, Escape also closes the dialog and discards the form | `stopPropagation` or use Radix `onEscapeKeyDown` |
| h | `store-checkout.jsx` | "+" disabled when `quantity+1 > stock_milli/1000`; sample items have `stock_milli: 0`, contradicting the demo cap of 10 | branch on `isSample` |
| i | `vendor.jsx` `load` | error set on failure, never cleared on success; a transient poll error stays on screen | `setError('')` on success |
| j | `vendor-admin.jsx` `load` | `Promise.all` — one failing endpoint blanks all three lists | `Promise.allSettled`, keep previous data |
| k | `customer-dashboard.jsx` | `data.customer.name.split(' ')` and `summary.points.toLocaleString` unguarded; a poll error after a successful load replaces the whole dashboard | optional chaining; keep data on poll errors |
| l | `daily-sales.jsx` + `main.jsx` | two `useLiveRefresh` pollers while Daily Sales is open | lift the refresh to the parent |
| m | `shop.jsx` `load` | a poll-triggered fetch failure sets `status` to the error and hides the already-loaded grid | keep products, show a non-blocking banner |
| n | `shop.jsx` `message()` | `setTimeout` without cleanup; overlapping toasts clear each other early | one timer ref, clear before set |

---

#### C14 — Cart updates use stale closures

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Low** | P2 | S | Low | Fixed |

**Location:** `src/shop.jsx` → `add()`, `adjust()`; `src/main.jsx` → `add()`, `updateCart()`.

**Evidence:** `setCart({...cart, [id]: n})` reads `cart` from the render closure; `remove` already uses the functional form.

**Impact:** Two rapid scans or clicks that land before a re-render overwrite each other, dropping an item from the bill. Low frequency, but the POS is exactly where rapid scanning happens.

**Fix:** `setCart(prev=>({...prev,[id]:(prev[id]||0)+n}))` everywhere; extract `useCart()` (R5).

---

#### C15 — `dev.mjs` loads `.env.local` after the server modules have already evaluated

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Low** | P1 | S | Low | Fixed |

**Location:** `dev.mjs`; `server/store-settings.mjs` line 4.

**Evidence:**
```js
// dev.mjs — static imports are hoisted and evaluated before any statement in this file
process.chdir(dirname(fileURLToPath(import.meta.url)));
if(existsSync('.env.local'))process.loadEnvFile('.env.local');
import {createServer as viteServer} from 'vite';
import {handle} from './server/api.mjs';
// store-settings.mjs — reads env at module load
const defaults={...,jazzcash:process.env.VITE_JAZZCASH_ACCOUNT||'',easypaisa:process.env.VITE_EASYPAISA_ACCOUNT||'',bank:process.env.VITE_BANK_ACCOUNT||'',...};
```

**Impact:** The three payment-account defaults are always empty in local development no matter what `.env.local` says. `DATABASE_URL`, `FIREBASE_PROJECT_ID` and `NODE_ENV` are read lazily inside functions, so they work, which hides the bug. (`.env.example` does not list the three variables either, M5.)

**Fix:** `const {handle}=await import('./server/api.mjs')` after `loadEnvFile`, or read the env inside `storeSettings()`; also `await` `api.close()` and call `close()` from `db.mjs` in the signal handler (D2).

**Verify:** start `npm run dev` with `VITE_JAZZCASH_ACCOUNT=test` in `.env.local`; `GET /api/public/settings` returns it.

---

#### C16 — Id collisions, negative vendor balances, and a locking preview

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Low** | P2 | S | Low | Fixed |

- **Receipt and order ids** — `'SM-'+Date.now().toString(36)+'-'+id().slice(0,4)` (`api.mjs` `checkout`, `orders.mjs` `placeOrder`/`changeOrder`): two sales in the same millisecond collide with probability 1/65,536 and the primary key turns it into a confusing 409. Use 8 hex characters (`id().slice(0,8)`) or a per-day sequence.
- **Vendor returns against paid purchases** (`vendor-ledger.mjs` `vendorLedger`, `api.mjs` `/vendor/payments`): a return is credited regardless of whether the purchase was `Paid`, so the balance goes negative with no "vendor owes us" state or refund entry. Add a `vendor_refunds` entry type or surface negative balances explicitly.
- **`GET /admin/sample-cleanup`** (`sample-cleanup.mjs`): the preview (`remove=false`) runs the same `SELECT … FOR UPDATE OF p`, taking row locks on every sample product for the duration of the transaction. Lock only when `remove` is true.

---

#### C17 — Dead and inconsistent client paths

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Low** | P2 | S | Low | Fixed |

- **Firebase sign-in inside `shop.jsx`** (`google()`, the phone-OTP, Firebase-email and reset branches of `authSubmit`) signs into Firebase but never calls `setUser`; `onAuthStateChanged` is imported and unused. The whole `authOpen` modal is unreachable (`setAuthOpen(true)` is never called and `main.jsx` passes `initialSignup={false}`), as are the orders modal (`openOrders` never called) and the vendor-apply modal (`setVendorOpen(true)` never called). The live sign-in lives in `auth-pages.jsx` and works. Delete the dead modal code or wire it up; it is ≈40 % of `shop.jsx`.
- **Quantity display** — `admin-workflow.jsx` and `vendor-admin.jsx` use `Math.round(qty_milli/1000)`, so 0.5 kg shows as "1" (or "0"); `main.jsx` `Q()` shows three decimals; `admin-catalog.jsx` labels any fraction "Old stock needs correction" and its "Set stock" input is `step="1"` although `unit` offers kg and litre. Pick one formatter (`src/lib/quantity.js`) and allow `step="0.001"` for non-piece units.
- **`store-checkout.jsx`** defines `env=import.meta.env` and never uses it; `whatsappOrderLink` is unused on the client.

---
### 4.3 Performance & scalability

#### P1 — `/live/version` is a public, unindexed, eleven-aggregate query polled every three seconds by every tab

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **High** | P1 | S | Low | Fixed |

**Location:** `server/api.mjs` → route `GET /live/version`; `src/live.js` → `useLiveRefresh()` (used by `main.jsx`, `shop.jsx`, `vendor.jsx`, `customer-dashboard.jsx`, `daily-sales.jsx`); `server/db.mjs` (`max: process.env.VERCEL ? 1 : 5`).

**Evidence:**
```sql
SELECT (SELECT COALESCE(MAX(updated_at)::text,'') FROM products) product,(SELECT COALESCE(MAX(created_at)::text,'') FROM stock_movements) movement,(SELECT COALESCE(MAX(updated_at)::text,'') FROM customer_orders) orders,(SELECT ... FROM vendor_applications) applications,(SELECT ... FROM vendor_payments) payments,(SELECT ... FROM store_accounts) accounts,(SELECT ... FROM receipts) receipts,(SELECT ... FROM customer_credit_payments) credit,(SELECT ... FROM loyalty_entries) loyalty,(SELECT ... FROM store_settings) settings,(SELECT COALESCE(MAX(id),0)::text FROM activity_events) activity
```
```js
export function useLiveRefresh(refresh,interval=3000){ ... let timer=setInterval(check,interval) ... }
```

**Impact:** Nine of the eleven sub-selects aggregate a column with no index (`products.updated_at`, `stock_movements.created_at`, `customer_orders.updated_at`, `receipts.created_at`, …), so each poll is nine sequential scans whose cost grows with the store's history. Twenty open shopper tabs plus five admin tabs is ≈8 requests per second, ≈75 table scans per second, each invocation also paying `init()`. On Vercel the pool is `max: 1`, so polls queue behind any running `tx()` and vice versa. The endpoint is unauthenticated, so anyone can hammer it, and its response discloses the exact time of the last sale, vendor payment, credit payment and staff-account creation.

**Fix (see F8):** every table in that query already fires the `star_mart_activity` trigger into `activity_events` (and `saveSettings` inserts an `activity_events` row by hand), whose identity primary key makes `MAX(id)` an O(1) index-only scan. Replace the query with `SELECT COALESCE(MAX(id),0)::text AS version FROM activity_events`. Raise the shopper and dashboard interval to 10 s (POS stays at 3 s). Do not introduce a single-row counter table bumped by trigger: it would serialize every write transaction on one row lock.

**Verify:** `tests/live-version.test.mjs` — the version changes after a product save, a settings save and an image upload; `EXPLAIN` on Neon shows an index-only backward scan; p95 under 5 ms.

**Related:** P2, P5, P8, F8, R3.

---

#### P2 — `/state` returns the store's entire history on every change and will hit Vercel's 4.5 MB response cap

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **High** | P1 (dedupe) / P2 (bounding) | S + M | Low / Med | Fixed |

**Location:** `server/api.mjs` → `state()`; `src/main.jsx` → `refresh()`, `action()`, `useLiveRefresh` call.

**Evidence:**
```js
d.query('SELECT * FROM vendors ORDER BY name'),d.query('SELECT * FROM purchases ORDER BY created_at DESC'),d.query('SELECT * FROM sales ORDER BY created_at DESC'),d.query('SELECT * FROM receipts ORDER BY created_at DESC'),d.query('SELECT * FROM adjustments ORDER BY created_at DESC LIMIT 1000'),d.query('SELECT * FROM expenses ORDER BY created_at DESC LIMIT 1000'),d.query('SELECT * FROM stock_movements ORDER BY created_at DESC LIMIT 3000')]);if(user.role==='vendor')throw fail('Use vendor overview',403);
// main.jsx
async function refresh(){let me=await api('/me');if(me.user.role==='vendor')return;let [v,o,c]=await Promise.all([api('/state'),api('/orders'),api('/customers')]);...if(me.user.role==='admin'){let feed=await api('/admin/activity');...}}
```

**Impact:** `purchases`, `sales` and `receipts` have no `LIMIT`. A store doing 200 bills a day with three lines each writes ≈220,000 `sales` rows a year at roughly 200 bytes of JSON each: tens of megabytes. Vercel caps function responses at 4.5 MB, so at some point the admin panel's first `/state` call fails with `FUNCTION_PAYLOAD_TOO_LARGE` and never loads again. Long before that, every admin and staff tab re-downloads everything after every sale, because any write bumps the version. The eight heavy queries run before the role check, so a vendor (who gets 403) and staff (for whom seven of eight result sets are discarded) pay the full cost. `refresh()` is three sequential round trips (`/me` → three parallel → `/admin/activity`), and `action()` calls `refresh()` itself while the poller, seeing the new version, calls it again: every save reloads everything twice on the acting tab and once on every other tab.

**Fix (see F11):** (1) dedupe: make `useLiveRefresh` return a `sync()` that records the version it just fetched so the poll after an action is a no-op; (2) check the role before running queries; (3) window the history (`?from=YYYY-MM-DD`, default the first day of the previous month in `Asia/Karachi`, plus a hard `LIMIT`) and move older data behind `/reports/range` that aggregates server-side; (4) drop `description` from list payloads; (5) return `state` from `/me` for admins to remove one hop.

**Verify:** `tests/state.test.mjs` — `/state` for staff runs no purchase/sales queries (assert via a query spy or timing); default window excludes a receipt dated three months ago; `?from=` includes it. Manual: Network tab shows one `/state` per save.

**Related:** P1, C1, F11.

---

#### P3 — Stock is recomputed by summing every movement on every operation; the public catalog aggregates the whole store per request

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Medium** | P2 | L | Med (mitigated by invariant test) | Fixed |

**Location:** `server/orders.mjs` → `publicProducts()`, `reserved()`, `placeOrder()`, `changeOrder()`; `server/api.mjs` → `checkout()`, `addAdjustment()`, `state()`; `server/catalog-actions.mjs` → `setStock()`; `server/vendor-ledger.mjs` → `returnToVendor()`.

**Evidence:**
```sql
SELECT COALESCE(SUM(qty_milli),0) stock FROM stock_movements WHERE product_id=$1          -- per line, per operation
SELECT p.id,...,p.description,p.price_paisa,COALESCE(m.stock_milli,0)-COALESCE(o.reserved_milli,0) stock_milli FROM products p LEFT JOIN (SELECT product_id,SUM(qty_milli) ... GROUP BY product_id) m ... LEFT JOIN (SELECT i.product_id,SUM(i.qty_milli) ... WHERE co.status='Pending' GROUP BY i.product_id) o ... ORDER BY p.name
```

**Impact:** `idx_movements_product` keeps the per-product sum an index range scan, but its cost grows linearly with each product's history, and a 20-line checkout runs 40 such aggregates plus 20 reservation joins under row locks. `publicProducts()` aggregates every movement and every pending item for every product on every storefront load and ships each product's 3,000-character `description` in the list.

**Fix (see R2):** add `products.stock_milli` and `reserved_milli` maintained by triggers on `stock_movements`, `customer_order_items` and `customer_orders.status`, backfilled once, with an invariant test before readers switch; omit `description` from list endpoints and serve it from a `/public/products/:id` detail route.

**Verify:** `tests/stock-invariant.test.mjs` runs the full flow and asserts `products.stock_milli = SUM(stock_movements)` and `reserved_milli = SUM(pending items)` for every product.

**Related:** P1, P5, R2.

---

#### P4 — Correlated sub-selects per customer, unbounded vendor overview, and an audit table that never shrinks

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Medium** | P2 | M | Low | Fixed |

**Location:** `server/customer-ledger.mjs` → `listCustomers()`; `server/api.mjs` → `/vendor/overview`; `server/db.mjs` triggers; `server/activity.mjs`.

**Evidence:**
```sql
-- listCustomers: four correlated sub-selects per customer, one of them nested
(SELECT COALESCE(SUM(GREATEST(0,r.total_paisa-LEAST(r.total_paisa,r.received_paisa)-COALESCE((SELECT SUM(cp.amount_paisa) FROM customer_credit_payments cp WHERE cp.receipt_id=r.id),0))),0) FROM receipts r WHERE r.customer_id=a.id) AS outstanding_paisa
-- vendor overview: no LIMIT on sales or movements
d.query('SELECT m.* FROM stock_movements m JOIN products p ON p.id=m.product_id WHERE p.vendor_id=$1 ORDER BY m.created_at DESC',[v])
```

**Impact:** `listCustomers()` backs the POS customer picker and runs on every admin refresh; with the 5,000 customers the bulk importer allows it is O(customers × receipts × credit payments) with `customer_credit_payments.receipt_id` and `loyalty_entries.customer_id` unindexed. A three-line sale writes about nine `activity_events` rows (receipt, three sales, three movements, loyalty, product `updated_at`); nothing deletes them, and `activityFeed()` only reads the latest 150. On Neon's free tier this table fills the 0.5 GB first.

**Fix:** rewrite `listCustomers` as three grouped CTEs (`receipts GROUP BY customer_id`, `customer_credit_payments GROUP BY receipt_id`, `loyalty_entries GROUP BY customer_id`) joined once; add `LIMIT 2000` and a `?before=` cursor to the vendor overview lists; add a retention sweep `DELETE FROM activity_events WHERE created_at < NOW() - INTERVAL '180 days'` to the sweeper (F1) and the indexes in P5.

**Verify:** `EXPLAIN ANALYZE` of the new `listCustomers` shows hash joins and no `SubPlan`; `tests/customer-ledger.test.mjs` totals unchanged.

**Related:** P5, F1.

---

#### P5 — Missing indexes for the queries the code actually runs

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Medium** | P1 | S | Low | Fixed |

**Location:** `server/db.mjs` → `init()`.

**Evidence:** the only indexes created are `idx_movements_product`, `idx_sales_receipt`, `idx_order_items_product`, `idx_activity_events_date`, `idx_receipts_customer`, `idx_order_request`, plus primary keys and the `sku`/`barcode` uniques.

**Impact / which query each serves:**

| Missing index | Query that scans without it |
|---|---|
| `customer_order_items(order_id)` | `changeOrder`, `customerOrders`, `allOrders` (`WHERE order_id=ANY(...)`) — every order read |
| `customer_orders(status) WHERE status='Pending'` | `reserved()` join, `publicProducts`, `addAdjustment`, `setStock`, `returnToVendor`, `catalogAction` |
| `customer_orders(customer_uid, created_at DESC)` | `customerOrders`, `customerOverview`, idempotency lookup in `placeOrder` |
| `customer_orders(updated_at)`, `products(updated_at)`, `stock_movements(created_at)`, `receipts(created_at)` | the current `/live/version` (moot after F8) and `adminOverview`/`dailySales` date filters |
| `products(vendor_id)` | `/vendor/overview` product, sales and movement joins |
| `sales(product_id)`, `sales(created_at)` | vendor sales join, `cleanupSamples` history check, reports |
| `purchases(vendor_id)`, `purchases(product_id)`, `purchases(created_at)` | `vendorLedger`, `/vendor/payments` debt calculation, `addPurchase` vendor check |
| `vendor_payments(vendor_id)`, `vendor_returns(vendor_id)`, `vendor_returns(purchase_id)`, `vendor_returns(product_id)` | `vendorLedger`, `returnToVendor` prior-returns sum |
| `loyalty_entries(customer_id)`, `loyalty_entries(receipt_id, kind)` | `pointsBalance`, `listCustomers`, the `awardPoints` exists-check |
| `customer_credit_payments(receipt_id)`, `customer_credit_payments(customer_id)` | `collectCredit`, `customerOverview`, `listCustomers` |
| `adjustments(product_id)` | `cleanupSamples` |
| `sessions(expires_at)`, `account_sessions(expires_at)`, `customer_sessions(expires_at)`, `password_reset_tokens(expires_at)` | the sweeper (S9) |
| `receipts(((created_at AT TIME ZONE 'Asia/Karachi')::date))` | `dailySales`, `adminOverview` trend, `state()` today's total |

**Fix (see F9 and Appendix B):** append `CREATE INDEX IF NOT EXISTS …` statements to `init()`; on a large existing Neon database run them once by hand with `CONCURRENTLY`, after which the idempotent statements are no-ops.

**Verify:** `EXPLAIN` on each listed query shows an index scan; `npm test` unchanged.

**Related:** P1, P3, P4, F9.

---

#### P6 — The two big components re-run every derived computation on every keystroke

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Medium** | P2 | M | Low | Fixed |

**Location:** `src/shop.jsx` → `Shop` (47 `useState`, 8 `useEffect`); `src/main.jsx` → `App` (35 `useState`), `Reports`; `src/admin-workflow.jsx` → `RecordTable.textOf`; `src/bulk-import.jsx` → `unzipSync`; `src/vendor.jsx`, `src/vendor-admin.jsx` per-row `find`.

**Evidence:** `useMemo` is imported in both `shop.jsx` and `main.jsx` and never called. In `Shop`, `preview` (O(samples × products)), `catalog`, `items` (`catalog.find` per cart line), `categories` and `shown` are rebuilt on every render; `add()` does `Object.keys(cart).some(… catalog.find …)`. In `App`, `inStock`, `low`, the cart `lines`, the quick-add filter and the full JSX row list of every table are rebuilt before pagination. `RecordTable.textOf(r)` walks the React element tree of every row to implement search. `Reports` aggregates the full sales and purchase history on each render. A ≈4.5 KB inline `<style>` block in `shop.jsx` (with two conflicting `.product-card` rule sets and many `!important`s) is re-rendered with the component. `bulk-import.jsx` calls `unzipSync` on up to 30 MB on the main thread, freezing the UI.

**Impact:** Typing in the POS scan box or the storefront search re-filters the entire catalog and re-renders every table; with the 5,000 products the importer allows this is a visible lag on a shop tablet. The zip decompression blocks the page for seconds.

**Fix (see R5):** `useMemo` for `catalog`, `shown`, `items`, `inStock`, `low`, report aggregates; index products by id once (`Map`) instead of `find` per row; search on the row's data, not its rendered elements; move the inline style to `storefront.css` (already imported); run `unzip` from `fflate` asynchronously or in a worker; split `Shop` and `App` into feature components so a keystroke re-renders one of them.

**Verify:** React DevTools profiler — a keystroke in POS search re-renders only the search/list subtree; Lighthouse "Total Blocking Time" on the storefront under 300 ms.

**Related:** M3, R5.

---

#### P7 — Bundle and asset weight

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Low** | P2 | S–M | Low | Fixed (API caching unchanged) |

- **No code-splitting:** `main.jsx` statically imports the admin, vendor, storefront, dashboard and `firebase.js`; there is no `React.lazy` anywhere, so a shopper downloads the POS and the Firebase Auth SDK. Only the zxing scanner is lazy.
- **Fonts:** `admin-premium.css`, `customer-dashboard.css`, `market.css` and `style.css` each `@import` Google Fonts — four third-party stylesheet requests before first paint, and four origins a future CSP must allow.
- **Images:** `public/produce.png` 2.6 MB, `vendor-grocery.png` 2.1 MB, `hero.png` and `grocery-hero.png` 1.9 MB each (uncompressed 1672-px PNGs); `logo.png`, used as the favicon, is 520 KB at 2146 × 733.
- **Caching:** `json()` sends `cache-control: no-store` on everything including `/public/products` and `/public/settings`; `/public/settings` is fetched by `Shop` and again on every `StoreCheckout` mount.
- **Uploads:** images are base64-encoded for the Postgres `decode()` call (S14).

**Fix (see R6):** lazy route branches with `manualChunks` for `firebase` and `zxing`; one `<link rel="preconnect">` plus a single fonts stylesheet in `index.html`; convert the heroes to WebP/AVIF at ≤ 200 KB and emit a 64-px favicon; allow `cache-control: private, max-age=5` on the two public GETs or an `ETag`; share the settings fetch through context.

**Verify:** `vite build` reports the storefront entry chunk without `firebase`; Lighthouse performance > 80 on `/shop`.

---

#### P8 — Sixty DDL statements on every cold start

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Low** | P0 (with C2) | S | Low | Fixed |

Covered by the fix for C2: a `schema_meta` version row turns the steady-state cold start into one `SELECT`.

---

### 4.4 Maintainability & code quality

#### M1 — The whole API is one if-chain in a 27,568-character line

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **High** | P3 | L | Low per step (fallthrough) | Fixed |

**Location:** `server/api.mjs` → `handleRequest()` (line 40).

**Evidence:** `awk '{ if (length($0) > max) max = length($0) } END { print max }' server/api.mjs` → `27568`. Roughly 70 `if(path===…&&method===…)` branches, each parsing its own body and applying its own guard (`owner(user)`, `worker(user)`, inline role checks, or nothing).

**Impact:** Authorization is a per-branch convention, not a property of the router, so the next route added without a guard is silently public (S2 is exactly this failure mode: eight routes forgot `authLimit`). Review and blame are impossible on a single line; a one-character change produces a 27 KB diff. Nothing validates request shapes beyond ad-hoc `str()`/`required()`/`paisa()` calls.

**Fix (see R1):** a route table (`route(method, pattern, {auth, limit, body}, handler)`) dispatched *before* the if-chain so unmoved routes fall through; migrate route groups one at a time using Appendix A as the checklist; delete the chain when it is empty; then add a small `shape()` validator per route.

**Verify:** Appendix A gains a "moved" column; `wc -c` of the longest line in `api.mjs` under 200 after formatting; a test enumerates `routes` and asserts every mutating route has `auth` ≠ `'public'` or an explicit `limit`.

**Related:** S2, C3, R1, R4.

---

#### M2 — Dead and duplicate files, including a second photo set and an uncredited stock image

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Medium** | P0 | S | Low | Fixed |

**Evidence (import graph over `src/`, see Appendix F for the greps):**

| Item | Size | Status |
|---|---|---|
| `src/shop (1).jsx` | 29 KB | Not imported anywhere; oldest snapshot (no product modal, `#home` anchors) |
| `src/shop (2).jsx` | 30 KB | Not imported anywhere; intermediate snapshot; the only importer of `product-detail.jsx` |
| `src/product-detail.jsx` | 3 KB | Dead with its importer; `shop.jsx` defines its own inline `ProductDetail` (which, unlike this one, never renders `description`) and imports only `product-detail.css` |
| `src/shop.css` | 5.5 KB | Not imported |
| `Dashboard` in `main.jsx`, `HomeSlider`/`HomePromotions` in `store-pages.jsx` | — | Never rendered |
| `SampleCleanup`, `RecoveryQueue` imports in `main.jsx`; `setupAvailable`, `accountForm`; `videoRef`, `streamRef`, `timerRef`; `useMemo`, `Table…`, `ArrowDownRight`; `onAuthStateChanged`, many lucide icons in `shop.jsx`; `selected`, `barcode`/`video`/`stream`/`timer` refs in `vendor.jsx`; `env` in `store-checkout.jsx`; `recordActivity` import in `api.mjs` | — | Unused |
| `public/public/category-photos/` | 1.6 MB | Not referenced; **not** a copy — 19 of 20 JPEGs differ from `public/category-photos/`; contains an extension-less 65 KB JPEG named `q` |
| `public/sample-catalog.json` | 1.5 MB | Not referenced (the admin links the two ZIPs instead) |
| `public/category-photos/gettyimages-458984207-612x612.jpg` | — | Not referenced and absent from `credits.html` — a Getty file with no licence record |
| `grocery-categories.mjs`: `categoryExamples()` returns `""`, `LEGACY_CATEGORIES` aliases another list, every taxonomy `items` array is empty; `SHOP_DEPARTMENTS` in `shop-departments.mjs` duplicates `GROCERY_TAXONOMY` one to one | — | Dead data |

**Impact:** Three storefronts in the tree invite editing the wrong one; `vite build` and editors index 60 KB of stale code; 3 MB of unreferenced assets ship with every deploy; the Getty file is a licensing exposure.

**Fix:** delete the items in Appendix F; reconcile the two `ProductDetail` implementations (the dead one is the better one: it shows `description` and allows direct quantity edit); either credit or remove the Getty image.

**Verify:** `vite build` succeeds; `grep -rn "shop (1)\|shop (2)\|product-detail.jsx\|sample-catalog.json" src index.html` is empty.

---

#### M3 — The same helper is written five or six times, each slightly differently

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Medium** | P2 | M | Low | Mostly fixed (focus traps still hand-written) |

| Duplicated | Copies | Divergence |
|---|---|---|
| Money formatter (`money`/`M`) | `main.jsx`, `admin-workflow.jsx`, `premium-dashboard.jsx`, `pickup-desk.jsx`, `admin-catalog.jsx`, `daily-sales.jsx`, plus `shop.jsx` and `whatsapp-order.mjs` | `premium-dashboard` rounds to whole rupees (`maximumFractionDigits: 0`); `pickup-desk` has no `||0` and prints `Rs NaN` for a missing value; `whatsapp-order` uses `toFixed(2)` |
| Fetch wrapper (`api`/`request`/`call`/`send` + inline) | `main.jsx`, `admin-workflow.jsx`, `account-security.jsx`, `bulk-import.jsx`, `vendor.jsx`, `vendor-admin.jsx`, inline in five more files | **All call `r.json()` before checking `r.ok`**, so a 502 HTML page becomes "Unexpected token <" instead of a useful message; none handles 429 |
| Focus trap | `shop.jsx` `ProductDetail`, `StoreCheckout`, `ShoppingSetup` | Hand-written three times although Radix `Dialog` (with focus management) is already a dependency and used in `components/ui` |
| Department/category taxonomy | `shop-departments.mjs` vs `grocery-categories.mjs` | Same ids, names and icons; `icon` fields unused |
| Form-field JSX | `main.jsx` L103 | Copied verbatim into both the `<details>` and `<fieldset>` branches |
| Vendor-apply form | dead `shop.jsx` modal vs `auth-pages.jsx` `VendorApply` | One sends `note`, the other does not |
| Role-filter and type map | `main.jsx` L83 | Each appears twice |
| Test harness (`request()`, temp-dir setup) | all 8 test files | Identical boilerplate |

**Fix (see R5):** `src/lib/money.js` (`formatPaisa`, `formatQty`), `src/lib/api.js` (checks `r.ok`, encodes path segments, maps 401/429), Radix `Dialog` for modals, one taxonomy module, `tests/helpers.mjs`.

---

#### M4 — No linter, formatter, type checking or CI, and a minified authoring style

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Medium** | P1 | S (setup) + M (format commit) | Low | Fixed |

**Evidence:** no `eslint*`, `.prettierrc`, `tsconfig.json`, `biome.json`, `.editorconfig` or `.github/`; `package.json` has no `lint` script; `jsconfig.json` only maps `@/*`. Longest lines: `server/api.mjs` 27,568 chars, `src/main.jsx` 5,832, `src/shop.jsx` 3,430, `src/vendor.jsx` 2,318. Magic numbers: `3000` (poll), `3500` (toast), `5000`/`300000`/`100` (loyalty, also in `loyalty-policy.mjs` as named constants but repeated as literals in `api.mjs` and the client), `'Asia/Karachi'` in four server files, `864e5`, `900`/`0.82` (image resize), `1_000_000`/`2_000_000` (body caps). Client role gating by matching server prose: `e.message.includes('sign in')` (`main.jsx` L52).

**Impact:** No automated check catches an unused import, a missing hook dependency (`admin-workflow.jsx` L30, `daily-sales.jsx` L5), an `==` comparison or a `var`. Diffs are unreviewable, so regressions ship unnoticed. The error-text match breaks the login screen if the server wording changes.

**Fix (see Section 9 and Appendix D):** Prettier + ESLint flat config with `react` and `react-hooks`, a one-time "format only" commit after Phase 0 proven by `npm test` and build-size comparison, GitHub Actions running lint, format check, tests, build and audit; `server/config.mjs` for the timezone and limits; return a machine-readable `code` from the API (`{error, code:'unauthenticated'}`) and switch the client to it.

---

#### M5 — Configuration drift

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Low** | P0–P2 | S | Low | Fixed |

- shadcn components use `animate-in`, `fade-in-0`, `zoom-in-95` (`dialog.jsx`, `alert-dialog.jsx`, `dropdown-menu.jsx`, `tooltip.jsx`) but `tw-animate-css` is not installed or imported, so the animations silently do nothing.
- `components.json` declares an `@/hooks` alias; `src/hooks` does not exist.
- `.env.example` omits `VITE_JAZZCASH_ACCOUNT`, `VITE_EASYPAISA_ACCOUNT`, `VITE_BANK_ACCOUNT`, which `server/store-settings.mjs` reads (and, confusingly, uses `VITE_`-prefixed names for server-side values).
- `.gitignore` lacks `.env.*.local`, `.vercel/`, `.DS_Store`, `coverage/`.
- `server/api.mjs`, `orders.mjs`, `bulk-import.mjs`, `store-settings.mjs` import from `../src/` (`grocery-categories.mjs`, `whatsapp-order.mjs`); it works, but shared modules belong in a `shared/` directory so neither bundle accidentally grows.
- `/categories` (authenticated) duplicates `/public/categories`.
- `customerFrom` is a bare alias of `firebaseIdentity`; `recordActivity` is imported by `api.mjs` and never called; its `allowed` set lacks `vendor_returns`, `store_settings`, `password_requests` which the triggers do log.
- `package.json` has no `packageManager` field and there is no `.nvmrc`; `engines` says `>=22`, which `process.loadEnvFile` needs.

---

#### M6 — No 404 route; application views are not addressable

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Low** | P3 | S | Low | Fixed |

**Location:** `src/main.jsx` L112 (path switch).

**Evidence:** any path that is not one of the ten known routes renders `<App portal="admin">`, so `/foo` or a mistyped `/shpo` shows the owner login. Inside `App` the active screen is a `view` state value, so a refresh always returns to the dashboard (or the POS for staff) and screens cannot be bookmarked or linked from the activity feed.

**Fix:** render a small "Page not found" component for unknown paths; mirror `view` into the URL (`/admin/orders`) with `history.pushState`, or adopt a router when R5/R6 land.

---

### 4.5 Tests

#### T1 — The suite does not cover the behaviours most likely to regress

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Medium** | P1–P2 | M | Low | Mostly fixed (Firebase success path and pg Pool branch untested) |

**What exists (8 files, all against a temp-dir PGlite through the real `handle()` or the order functions):** money maths; product → purchase → checkout → adjustment → expense flow with stock arithmetic; oversell rollback; duplicate barcode 409; legacy import; one cross-origin `/login` 403; order reservation/cancel/fulfil rules; customer signup/login/logout and session isolation; credit ledger and loyalty rules; vendor isolation and image round-trip; staff/vendor 403 matrix; bulk import skip/conflict rules; transfer-payment verification.

**Not covered (route or behaviour never exercised):**

| Area | Gaps |
|---|---|
| Auth & recovery | `/password/request`, `/password/reset`, `/account/password`, `/customer/password`, admin `/logout`, `/me`, `/setup/status`, re-running `/setup` after an owner exists, `/admin/firebase-login`, `/admin/link`, Firebase success path (only the missing-token 401 is tested) |
| Abuse controls | never drives `authLimit` to 429; `x-forwarded-for` spoofing; CSRF with an authenticated cookie plus foreign Origin; `Origin: null`; `Secure` cookie under `NODE_ENV=production` |
| Input limits | image > 1 MB (413), PNG/WebP magic bytes, non-image rejection (only JPEG is tested); oversized or malformed JSON; non-object bodies |
| Routes | `/admin/settings`, `/public/settings`, `/public/whatsapp-order`, `/reports/daily-sales`, `/admin/activity`, `/admin/sample-cleanup`, `/products/bulk-action`, `/products/:id/stock`, `/vendor/returns`, `/categories`, `/customer/avatar`, `/customer/preferences`, `/accounts/:id` PATCH, `/customers/:id/overview` for staff |
| Engine | the `pg.Pool` branch of `tx()` (`connect`/`release`/`set_config`) is never run; no concurrency through the PGlite queue; no idempotency replay test for checkout (there is none to test yet) |
| Harness | `request()` and the temp-dir dance are copy-pasted in every file; `customer-auth.test.mjs` seeds products with raw SQL, bypassing validation; the stub `res` has no `socket`, so the IP code path never runs |

**Fix (see Appendix C):** `tests/helpers.mjs`; new files `security`, `checkout-idempotency`, `order-expiry`, `image-upload`, `settings`, `whatsapp-order`, `bulk-action`, `vendor-returns`, `stock-invariant`, `db`, `live-version`; `--test-concurrency=1` in the script so PGlite temp dirs never collide; a `test:pg` script for an opt-in Neon branch.

---

#### T2 — Harness realism

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Low** | P2 | S | Low | Fixed |

The fake request has no `socket`, so `authLimit` always keys on `'local'`; add `socket:{remoteAddress:'127.0.0.1'}` and a way to set `x-forwarded-for`. Seed through the API, not raw SQL, so validation is part of the fixture. Assert on `set-cookie` attributes, not just presence.

---

### 4.6 Dependencies & deployment

#### D1 — One serverless function with a 30-second budget carries migrations, hashing and bulk work

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Medium** | P1–P2 | S–M | Low | Mostly fixed (single function kept) |

**Location:** `vercel.json`, `api/index.js`, `server/db.mjs`, `server/bulk-import.mjs`, `server/import.mjs`.

**Evidence:** `"functions":{"api/index.js":{"maxDuration":30}}`; every request runs `init()`; the bulk importer hashes up to 80 passwords synchronously per batch; the legacy importer runs up to 100,000 rows in one call (C6). Vercel's file tracing will include `firebase-admin` and, because the dynamic import is a string literal, `@electric-sql/pglite` in the function bundle even though `db()` throws before reaching PGlite on Vercel.

**Impact:** Cold starts are slow (C2/P8 plus bundle size), and the two importers can exceed the budget and roll back. The `max: 1` pool means a slow import blocks the polls on that instance.

**Fix:** C2's version gate; async `scrypt` (S6); batched inserts (C6); `serverExternalPackages`-style exclusion is not available for plain functions, so move PGlite behind an `if(!process.env.VERCEL)` with a non-literal specifier (`await import(/* @vite-ignore */ name)`) so the tracer skips it; consider `maxDuration: 60` for the import routes only once the router (R1) can set it per route or by splitting `api/import.js`.

---

#### D2 — Local development server hygiene

| Severity | Priority | Effort | Regression risk | Status |
|---|---|---|---|---|
| **Low** | P1 | S | Low | Fixed |

`dev.mjs` listens on port 8787 on all interfaces (the API is reachable from the LAN) while Vite is bound to `127.0.0.1`; pass `'127.0.0.1'` to `api.listen`. On `SIGINT` it does not await `api.close()` and never calls `close()` from `db.mjs`, so PGlite is not flushed cleanly. See C15 for the env-loading order.

---
## 5. Top 12 fixes, code level

Ordered by impact × ease. Each names the function to change and the existing utility to reuse.

### F1 — Stop guests from reserving stock; expire pending orders (S1, S9, P4)
*Effort M · Regression risk Med · Phase 1*

1. **Schema** (append to `init()`):
   ```sql
   ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
   ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS client_key TEXT;        -- sha256 of the guest IP, guests only
   ALTER TABLE customer_orders DROP CONSTRAINT IF EXISTS customer_orders_status_check;
   ALTER TABLE customer_orders ADD CONSTRAINT customer_orders_status_check CHECK(status IN ('Inquiry','Pending','Fulfilled','Cancelled'));
   CREATE INDEX IF NOT EXISTS idx_orders_pending ON customer_orders(status, expires_at) WHERE status='Pending';
   ```
2. **`reserved()` in `server/orders.mjs`** — only live, unexpired holds count:
   ```js
   async function reserved(c,pid){return Number((await c.query(
     "SELECT COALESCE(SUM(i.qty_milli),0) qty FROM customer_order_items i JOIN customer_orders o ON o.id=i.order_id WHERE o.status='Pending' AND (o.expires_at IS NULL OR o.expires_at>NOW()) AND i.product_id=$1",[pid])).rows[0].qty)}
   ```
   Apply the same predicate to the four copies of this join in `api.mjs` (`checkout`, `addAdjustment`), `catalog-actions.mjs` (`setStock`, `catalogAction`), `vendor-ledger.mjs` (`returnToVendor`) and `publicProducts` — better, export `RESERVED_SQL` from `orders.mjs` and interpolate the constant.
3. **`placeOrder(customer, b, opts)`** — add `const guest=customer.id.startsWith('guest-')`; cap `b.lines.length` (20 for guests) and per-line `qty` (10,000 milli for guests, 50,000 for customers); count open orders (`SELECT COUNT(*) FROM customer_orders WHERE customer_uid=$1 AND status IN ('Inquiry','Pending') AND (expires_at IS NULL OR expires_at>NOW())`) and refuse above 3; insert `status` as `'Inquiry'` for guests, `expires_at` as `NOW()+INTERVAL '2 hours'` (guest) / `'24 hours'` (transfer reference) / `'48 hours'` (otherwise).
4. **`changeOrder`** — add action `'Confirm'` (`worker`) that moves `Inquiry → Pending` after re-checking availability, and `'Extend'` that pushes `expires_at`.
5. **`server/sweeper.mjs`**:
   ```js
   import {tx} from './db.mjs';
   let last=0;
   export async function sweepIfDue(){if(Date.now()-last<60_000)return;last=Date.now();await tx(async c=>{
     const lock=await c.query("SELECT pg_try_advisory_xact_lock(hashtext('star-mart-sweep')) ok");if(!lock.rows[0].ok)return;
     await c.query("UPDATE customer_orders SET status='Cancelled',payment_status='Expired · not collected',updated_at=NOW() WHERE status IN ('Pending','Inquiry') AND expires_at<NOW()");
     for(const t of ['sessions','account_sessions','customer_sessions','password_reset_tokens'])await c.query(`DELETE FROM ${t} WHERE expires_at<NOW()`);
     await c.query("DELETE FROM auth_limits WHERE started_at<NOW()-INTERVAL '1 day'");
     await c.query("DELETE FROM activity_events WHERE created_at<NOW()-INTERVAL '180 days'");
   })}
   ```
   Call `sweepIfDue().catch(console.error)` (not awaited) from the `/live/version` branch; add `GET /api/sweep` guarded by `CRON_SECRET` for a Vercel cron fallback.
6. **Client**: the storefront's "my orders" view shows `Inquiry` as "Awaiting store confirmation" and the expiry time.

### F2 — Rate-limit the remaining public writes and harden the key (S2, S8)
*Effort S · Regression risk Low · Phase 0*

```js
// server/auth-limits.mjs
export function clientIp(req){
  if(process.env.VERCEL) return String(req.headers['x-real-ip']||req.headers['x-forwarded-for']||'').split(',')[0].trim()||'unknown';
  if(process.env.TRUST_PROXY) return String(req.headers['x-forwarded-for']||'').split(',').pop()?.trim()||req.socket?.remoteAddress||'local';
  return req.socket?.remoteAddress||'local';
}
export async function authLimit(req,scope,email='',{max=20,windowMinutes=15}={}){
  const key=hash(scope+'|'+clientIp(req)+'|'+String(email).trim().toLowerCase());
  const d=await db();
  const r=await d.query("INSERT INTO auth_limits(key,attempts) VALUES($1,1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth_limits.started_at<NOW()-($2||' minutes')::interval THEN 1 ELSE auth_limits.attempts+1 END,started_at=CASE WHEN auth_limits.started_at<NOW()-($2||' minutes')::interval THEN NOW() ELSE auth_limits.started_at END RETURNING attempts",[key,String(windowMinutes)]);
  if(Number(r.rows[0].attempts)>max)throw Object.assign(new Error('Too many attempts. Please wait and try again.'),{status:429});
}
```
Call sites to add in `api.mjs`: `/customer/signup` → `authLimit(req,'signup-ip','',{max:10})`; `/vendor/apply` → add `authLimit(req,'vendor-application-ip','',{max:3})`; `/customer/orders` POST and `/public/whatsapp-order` → `authLimit(req,'order',customer.id,{max:10,windowMinutes:60})`; `/password/reset` → `'reset-apply'`; `/setup` → `{max:5}`; `/admin/firebase-login`, `/admin/link` → `'admin-firebase'`; `/account/password`, `/customer/password` → `authLimit(req,'password-change',user.id,{max:10})`; all three logins → add `authLimit(req,'login-account',email,{max:10})` **without** the IP in the key (pass a fixed `'*'` IP or add a `perAccount` option). On the unknown-email path of both logins call `verify(password,DUMMY_SALT,DUMMY_HASH)` before throwing.

### F3 — Make POS checkout idempotent and stop reporting success as failure (C1)
*Effort M · Regression risk Low–Med · Phase 0 (client) + Phase 1 (server)*

**Client (`src/main.jsx`):**
```js
async function action(path,method,payload,onDone){
  setBusy(true);setError('');
  let result;
  try{result=await api(path,method,payload)}catch(e){setError(e.message);setBusy(false);return null}
  onDone?.(result);flash('Saved successfully.');
  try{await sync()}catch{flash('Saved. The screen will refresh shortly.')}   // sync() from F11
  setBusy(false);return result}
```
POS: `const requestKey=useRef(null)`; when `Object.keys(cart).length` goes from 0 to >0 set `requestKey.current=crypto.randomUUID()`; include `requestKey:requestKey.current` in the checkout payload; set it to `null` in `onDone`.

**Server (`server/api.mjs` `checkout`):**
```sql
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS request_key TEXT;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS request_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_request ON receipts(request_key) WHERE request_key IS NOT NULL;
```
```js
async function checkout(b,user){
  ... existing validation ...
  const requestKey=b.requestKey?user.id+':'+str(b.requestKey,80):null;
  if(requestKey&&!/^[a-zA-Z0-9-]+:[a-zA-Z0-9-]{10,80}$/.test(requestKey))throw fail('Invalid request key');
  const requestHash=hash(JSON.stringify({requested,discount,tax,payment,customer,customerId,redeemPoints,received:b.received}));
  return tx(async c=>{
    if(requestKey){const old=(await c.query('SELECT * FROM receipts WHERE request_key=$1',[requestKey])).rows[0];
      if(old){if(old.request_hash!==requestHash)throw fail('This bill changed since the last attempt. Start again.',409);
        const lines=(await c.query('SELECT s.qty_milli,s.unit_price_paisa,s.line_total_paisa,p.name FROM sales s JOIN products p ON p.id=s.product_id WHERE s.receipt=$1',[old.id])).rows;
        return {receipt:old.id,subtotal:Number(old.subtotal_paisa),discount:Number(old.discount_paisa),tax:Number(old.tax_paisa),total:Number(old.total_paisa),received:Number(old.received_paisa),customer:old.customer,payment:old.payment,lines:lines.map(x=>({name:x.name,qty:Number(x.qty_milli),unitPrice:Number(x.unit_price_paisa),total:Number(x.line_total_paisa)})),createdAt:old.created_at,replayed:true}}}
    ... existing body; add request_key,request_hash to the receipts INSERT ...
  })}
```
The route becomes `checkout(await body(req),user)`. On PGlite the `tx()` queue serializes concurrent replays; on Postgres the partial unique index turns a true race into a `23505`, which the catch-all maps to 409 — the client then re-sends with the same key and receives the replay.

### F4 — Cap staff discounts and compute tax server-side (S3)
*Effort S · Regression risk Low · Phase 1*

In `checkout(b,user)`: `const cap=user.role==='admin'?Infinity:Math.min(Math.floor(subtotal*STAFF_MAX_DISCOUNT_BPS/10000),STAFF_MAX_DISCOUNT_PAISA)`; after computing `subtotal` throw 403 when `discount>cap`; replace `tax=paisa(b.tax)` with `tax=purchased.reduce((n,x)=>n+Math.round(x.base*int(x.p.tax_rate_bps)/10000),0)` and allocate it by weight as today; add `receipts.discount_reason TEXT NOT NULL DEFAULT ''` and require it (`required(b.discountReason)`) whenever `discount>0`; after the insert, `if(discount>ALERT_DISCOUNT_PAISA)await c.query("INSERT INTO activity_events(entity,entity_id,action,actor) VALUES('receipts',$1,'DISCOUNT',$2)",[receipt,currentActor()])`. Constants live in `server/config.mjs`.

### F5 — Freeze vendor edits on stocked products (S4)
*Effort S · Regression risk Low · Phase 1*

In `saveProduct`, inside the `if(productId)` branch for vendors:
```js
if(actor.role==='vendor'){
  const old=exists.rows[0];
  const stocked=(await c.query('SELECT 1 FROM stock_movements WHERE product_id=$1 UNION ALL SELECT 1 FROM sales WHERE product_id=$1 LIMIT 1',[productId])).rows.length>0;
  fields[1]=old.sku;fields[7]=old.location;fields[11]=old.reorder_milli;fields[12]=old.reorder_qty_milli;fields[13]=old.tax_rate_bps;
  if(stocked){fields[0]=old.name;fields[2]=old.barcode;fields[4]=old.category;fields[6]=old.unit;fields[9]=old.cost_paisa;fields[10]=old.price_paisa;
    if(price!==Number(old.price_paisa))await c.query('UPDATE products SET vendor_proposed_price_paisa=$1 WHERE id=$2',[price,productId]);}
}
```
with `ALTER TABLE products ADD COLUMN IF NOT EXISTS vendor_proposed_price_paisa BIGINT` and a "Proposed price" column plus "Accept" button on the owner's product table.

### F6 — Security headers (S5)
*Effort S · Regression risk Low (headers) / Med (CSP, Report-Only first) · Phase 0*

Copy Appendix E into `vercel.json`. Replace `REPLACE-WITH-AUTH-DOMAIN` with the value of `VITE_FIREBASE_AUTH_DOMAIN`. Ship the CSP as `Content-Security-Policy-Report-Only`, walk through all four portals including Google sign-in and phone OTP with DevTools open, then rename the key after a week with no violations. In `src/account-security.jsx` read the token from `location.hash` first: `const params=new URLSearchParams(location.hash.slice(1)||location.search)`; in `issueReset` return `'/reset-password#token='+token`.

### F7 — Un-poison `init()` and gate migrations (C2, P8)
*Effort S · Regression risk Low · Phase 0*

```js
const SCHEMA_VERSION=2;
export function init(){initialized ||= migrate().catch(e=>{initialized=null;throw e});return initialized}
async function migrate(){const d=await db();
  await d.query('CREATE TABLE IF NOT EXISTS schema_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
  if(d.connect)await d.query('SELECT pg_advisory_lock(727401)');
  try{const v=Number((await d.query("SELECT value FROM schema_meta WHERE key='version'")).rows[0]?.value||0);
    if(v>=SCHEMA_VERSION)return;
    await securityInit(d);await settingsInit(d);await limitInit(d);
    for(const statement of DDL)await d.query(statement);   // existing statements, unchanged
    await d.query("INSERT INTO schema_meta(key,value) VALUES('version',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",[String(SCHEMA_VERSION)]);
  }finally{if(d.connect)await d.query('SELECT pg_advisory_unlock(727401)')}}
```
In `handle()`: `catch(e){if(e.initFailure)return json(res,503,{error:'Store is starting up. Try again.'},{'retry-after':'5'})}` (set `initFailure` in the `catch` above). Bump `SCHEMA_VERSION` whenever DDL changes.

### F8 — O(1) `/live/version` (P1)
*Effort S · Regression risk Low · Phase 1*

```js
if(path==='/live/version'&&method==='GET'){
  sweepIfDue().catch(console.error);                               // F1, fire and forget
  const q=await (await db()).query('SELECT COALESCE(MAX(id),0)::text AS version FROM activity_events');
  return json(res,200,{version:q.rows[0].version});
}
```
`shop.jsx` and `customer-dashboard.jsx`: `useLiveRefresh(load,10000)`. Add a test that the version changes after a product save, a settings save and an image upload, which proves every polled table still reaches `activity_events`.

### F9 — Indexes and partial uniques (P5, C5)
*Effort S · Regression risk Low · Phase 1*

Append Appendix B to the DDL list in `init()` (all `IF NOT EXISTS`). For the uniques:
```sql
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sku_key;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_barcode_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku_live ON products(sku) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_live ON products(barcode) WHERE deleted_at IS NULL;
```
In `bulk-import.mjs` add `AND deleted_at IS NULL` to the SKU/barcode match; in `catalogAction` reject `show` for rows with `deleted_at IS NOT NULL`.

### F10 — Every write inside `tx()`; pool hygiene (C3, C4)
*Effort M · Regression risk Low · Phase 1*

Produce the list with `grep -o "(await db()).query('\(INSERT\|UPDATE\|DELETE\)[^']*'" server/*.mjs`, then convert each, for example:
```js
// before
await (await db()).query('INSERT INTO customer_accounts(...) VALUES(...)',[...]);
let token=id()+id();await (await db()).query("INSERT INTO customer_sessions(...) VALUES($1,$2,NOW()+INTERVAL '7 days')",[hash(token),customerId]);
// after
const token=id()+id();
await tx(async c=>{await c.query('INSERT INTO customer_accounts(...) VALUES(...)',[...]);
  await c.query("INSERT INTO customer_sessions(...) VALUES($1,$2,NOW()+INTERVAL '7 days')",[hash(token),customerId])});
```
`db.mjs`:
```js
pool ||= new Pool({connectionString:process.env.DATABASE_URL,max:process.env.VERCEL?1:5,idleTimeoutMillis:20_000,connectionTimeoutMillis:10_000});
pool.on('error',e=>console.error('pg idle client error',e));
// tx(): catch(e){try{await c.query('ROLLBACK')}catch{} c.release(e);throw e}   — and drop release() from finally
```
Add the guard test described under C3.

### F11 — One reload per change, bounded `/state` (P2)
*Effort S (dedupe) / M (bounding) · Regression risk Low / Med · Phase 1 / 2*

```js
// src/live.js
export function useLiveRefresh(refresh,interval=3000){
  const latest=useRef(refresh);latest.current=refresh;
  const seen=useRef(null),busy=useRef(false);
  const sync=useCallback(async()=>{const r=await fetch('/api/live/version',{cache:'no-store'});if(!r.ok)throw Error('Sync unavailable');
    const {version}=await r.json();await latest.current();seen.current=version},[]);
  useEffect(()=>{let active=true;async function check(){if(!active||busy.current||document.visibilityState==='hidden')return;busy.current=true;
      try{const r=await fetch('/api/live/version',{cache:'no-store'});if(!r.ok)throw Error();const {version}=await r.json();
        if(seen.current!==null&&version!==seen.current)await latest.current();seen.current=version}catch{}finally{busy.current=false}}
    const timer=setInterval(check,interval),visible=()=>{if(document.visibilityState==='visible')check()};
    document.addEventListener('visibilitychange',visible);check();
    return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible)}},[interval]);
  return sync}
```
`main.jsx`: `const sync=useLiveRefresh(...)`; `action()` calls `sync()` (F3). Server `state(user, from)`: throw for vendors first; `const from=validDate(query.from)||firstOfPreviousMonth()`; add `WHERE created_at>=$1` and `LIMIT 5000` to purchases/sales/receipts/adjustments/expenses/movements; the Reports tab calls a new `GET /reports/range?from&to` that returns `SUM`/`GROUP BY day` rows.

### F12 — Async `scrypt`, one password policy, test isolation (S6, C10)
*Effort S · Regression risk Low · Phase 0–1*

```js
// server/auth.mjs
import {randomBytes,scrypt,scryptSync,timingSafeEqual,createHash} from 'node:crypto';import {promisify} from 'node:util';
const scryptAsync=promisify(scrypt);const PARAMS={N:2**17,r:8,p:1,maxmem:256*1024*1024};
export const PASSWORD_MIN=8;
export function checkPassword(p){const s=String(p||'');if(s.length<PASSWORD_MIN||s.length>128)throw Object.assign(new Error(`Password must be ${PASSWORD_MIN}–128 characters`),{status:400});return s}
export async function passwordHashAsync(password,salt){return (await scryptAsync(password,salt,64,PARAMS)).toString('hex')}
export async function verifyAsync(password,salt,expected){if(String(password).length>128)return false;const a=Buffer.from(await passwordHashAsync(password,salt),'hex'),b=Buffer.from(expected,'hex');return a.length===b.length&&timingSafeEqual(a,b)}
```
Existing hashes were produced with the default `N=16384`; keep `verify()` (sync, default params) as a fallback when the async verify fails, and re-hash on successful login so accounts migrate transparently. Store the parameters in the hash string (`scrypt$17$…`) to make future changes explicit.
```js
// server/db.mjs
const preferLocal=process.env.STAR_MART_DATA_DIR||process.env.NODE_ENV==='test';
if(process.env.DATABASE_URL&&(!preferLocal||process.env.STAR_MART_FORCE_PG)){ ...Pool... }
```
`tests/helpers.mjs` exports `isolate()`, `withTempDb(fn)`, `request(method,path,{body,cookie,headers})`, `loginOwner()`.

---

## 6. Remediation roadmap

| Phase | Window | Items | "Store keeps running" guard | Exit criteria |
|---|---|---|---|---|
| **0** | Same day, no schema change | F2 (rate limits + `clientIp`), F6 (headers; CSP Report-Only), F7 (`init()` reset), S7 (Origin try/catch), F12 test isolation half, F3 client half, C12 body check, C13 d/e/f (undefined messages, `toBlob`, encoding), M2 dead-file deletion (Appendix F), M5 `.gitignore`/`.env.example`, S11 `npm audit fix` (non-breaking) | Pure code changes; deploy to a preview first; rollback = redeploy previous | `npm test` green; 21st signup → 429; `curl -I` shows the headers; four-portal walkthrough with no CSP violations |
| **1** | This week | F1 (expiry + sweeper + guest caps), F3 server half, F4, F5, F8, F9, F10, F11 dedupe, F12 async scrypt, S9 (`__Host-`, `Secure` detection), C7 (`receipts.order_id`), C8, C11, C15, D2, format commit + ESLint + CI (Section 9) | All migrations `IF NOT EXISTS`/additive; cookies accepted under both names for one release; sweeper only touches rows with a non-null `expires_at`; format commit isolated and proven by tests + build-size diff | Idempotency and expiry tests green; `/live/version` p95 < 5 ms on Neon; one `/state` per save in the Network tab; CI required on the main branch |
| **2** | This month | F11 bounding + `/reports/range`, R2 materialized stock, R6 code splitting, S10, P4 `listCustomers` rewrite, activity retention, P7 assets, S11 dependency bumps + tailwind to devDependencies, T1 new tests, CSP enforced, C6 chunked legacy import, C17 dead storefront modals, S12/C9 via `useCheckoutDraft` | R2 ships only after the invariant test passes against the old SUM; `/state` default window keeps old behaviour reachable via `?from=`; CSP flipped only after a violation-free week | Lighthouse performance > 80 on `/shop`; `/state` < 300 KB for a month of data; `npm audit --audit-level=high` clean or each item documented |
| **3** | Structural (next quarter) | R1 router + `shape()` validation, R4 tx-by-construction, R5 component split, typed `ValidationError` replacing the regex mapping, `server/config.mjs` for timezone/limits, JSDoc `@typedef` or TypeScript `checkJs`, M6 routing | One route group per PR with fallthrough; no behaviour change per PR | `server/api.mjs` under 300 lines; zero `(await db()).query('INSERT` matches; no component over 300 lines; Appendix A fully "moved" |

---

## 7. Structural refactors

Constraint for all of them: `handle(req,res)` stays the only export `api/index.js` and `dev.mjs` know about, so deployment stays single-file and the tests keep using `request()`.

### R1 — Router table for `server/api.mjs`
`server/router.mjs`:
```js
export const routes=[];
export const route=(method,pattern,opts,handler)=>routes.push({method,pattern,...opts,handler});
// opts: {auth:'public'|'customer'|'worker'|'owner'|'vendor'|'catalog', limit:{scope,max,window,byEmail}, body:'json'|'image'|'none', tx:true}
export async function dispatch(ctx){for(const r of routes){if(r.method!==ctx.method)continue;const m=typeof r.pattern==='string'?(r.pattern===ctx.path?[]:null):r.pattern.exec(ctx.path);if(!m)continue;
  if(r.limit)await authLimit(ctx.req,r.limit.scope,r.limit.byEmail?ctx.body?.email:'',r.limit);
  const user=await guard(r.auth,ctx);const params=m.slice(1);
  return r.tx?tx(c=>r.handler({...ctx,user,params,c})):r.handler({...ctx,user,params})}
  return undefined}   // undefined → fall through to the legacy chain
```
Sequencing: (1) land `router.mjs` and call `dispatch()` before the if-chain; (2) move route groups one PR each — public → customer → vendor → owner/worker — using Appendix A as the checklist and adding a test per group; (3) delete the chain when Appendix A shows no legacy rows; (4) add a hand-rolled `shape({name:str(1,250),qty:milli})` validator (or `valibot`, ~1 KB, no dependencies) per route; (5) move `maxDuration`-sensitive routes to their own function file if needed.

### R2 — Materialized stock
`products.stock_milli BIGINT NOT NULL DEFAULT 0`, `reserved_milli BIGINT NOT NULL DEFAULT 0`, maintained by triggers (`AFTER INSERT/DELETE ON stock_movements` → `UPDATE products SET stock_milli=stock_milli+NEW.qty_milli`; `AFTER INSERT/DELETE ON customer_order_items` and `AFTER UPDATE OF status, expires_at ON customer_orders` → recompute `reserved_milli` for the affected products). One-time backfill guarded by a `schema_meta` row. Sequence: (1) columns + triggers + backfill, no reader changes; (2) `tests/stock-invariant.test.mjs`; (3) switch readers one at a time (`publicProducts`, `state`, `checkout`, `placeOrder`, `changeOrder`, `setStock`, `returnToVendor`, `addAdjustment`) keeping `SELECT … FOR UPDATE` on the product row, which now also protects the number being compared; (4) keep the SUM as `GET /admin/stock-audit` that reports drift.

### R3 — Cheap version signal
Delivered by F8. Rule to document in `db.mjs`: any table whose change should refresh a client must carry the `star_mart_activity` trigger; add a test that enumerates the 16 tables plus `product_images` and asserts the trigger exists in `pg_trigger`.

### R4 — Transactions by construction
After R1, routes with `body:'json'|'image'` get `tx:true` by default; the handler receives `c` and cannot reach `db()`. Read-only GET routes keep `db()`. A lint rule (`no-restricted-syntax` on `db().query` inside `server/routes/`) enforces it.

### R5 — Split `Shop` and `App`
Each step is a no-behaviour-change PR: (1) `src/lib/money.js` (`formatPaisa`, `formatQty` — pick `Intl.NumberFormat('en-PK',{maximumFractionDigits:2})` and document it), `src/lib/api.js` (checks `r.ok` before `r.json()`, encodes path segments, surfaces `code`), Radix `Dialog` replacing the three focus traps; (2) leaf components with props only — `CatalogGrid`, `ProductCard`, `BasketDrawer`, `OrdersDrawer`, `CheckoutForm`, `AuthDialog`, `VendorApplyDialog` from `shop.jsx`; `PosCart`, `ProductTable`, `ReceiptView`, `CreditCollection` (fixing C8), `Reports` from `main.jsx`; (3) hooks — `useCatalog(products, search, category)` with `useMemo`, `useCart()` with functional updates (C14), `useCustomerSession()`, `useCheckoutDraft()` owning the three `sessionStorage` keys (S12, C9); (4) inline `<style>` → `storefront.css`. Exit: no component over 300 lines.

### R6 — Code-split by portal
`main.jsx` keeps the path switch but each branch becomes `React.lazy(()=>import('./shop.jsx'))` etc.; `firebase.js` is imported dynamically inside the auth dialogs; `vite.config.js` adds `build.rollupOptions.output.manualChunks={firebase:['firebase/app','firebase/auth'],zxing:['@zxing/browser','@zxing/library']}`; the four Google-Fonts `@import`s collapse to one `<link rel="preconnect">` + one stylesheet in `index.html`. Do R6 before R5: it is mechanical and gives the bundle win immediately.

---

## 8. Verified OK

These were examined and found sound; they are listed so nobody spends time re-checking them.

- **SQL injection:** every user value is a bound parameter. Dynamic identifiers (`${cfg.table}`, `${cfg.session}`, `${table}` in trigger DDL, `'SELECT 1 FROM '+t`, `${where}`) come only from constant maps or arrays.
- **Password storage and comparison:** `scrypt` with a 16-byte random salt per user; `timingSafeEqual`; input capped at 128 characters; `verify` returns false on malformed stored hashes.
- **Sessions:** `id()+id()` = 256-bit random tokens stored as SHA-256; `HttpOnly`; `SameSite=Strict` for store accounts, `Lax` for customers; `Secure` in production; logout deletes server-side; password change and reset delete every session of the account.
- **Reset flow:** 256-bit single-use token with 30-minute expiry, validated by regex before lookup, `FOR UPDATE`, admin kind blocked, neutral response on request, owner-mediated issuance with an audit row.
- **CSRF:** Origin checked on every mutating method (failure mode aside, S7); no CORS headers; no state change on GET.
- **Social login:** no automatic merge by email, which prevents takeover through providers with unverified emails; the Firebase `password` provider requires `email_verified`.
- **Locking and isolation:** `checkout` and `placeOrder` sort product ids with `localeCompare`; `changeOrder` uses `ORDER BY product_id`; `catalogAction` uses `ORDER BY id FOR UPDATE`; `returnToVendor` is the only path that locks vendor then product, and nothing locks them in the opposite order — no cycle found (Postgres would detect one anyway). `pg_advisory_xact_lock(hashtext(email))` serializes vendor applications per email.
- **Stock invariants:** every mutation locks the product row; reservations are honoured consistently by all seven consumers; `qty_milli<>0` and `>0` CHECKs; fulfilment re-checks stock; adjustments cannot go negative or below reserved.
- **Loyalty:** exactly 100 points per bill, balance read under the customer row lock, award idempotent per receipt, no stacking with a manual discount, credit bills earn only on exact settlement, 8 % margin guard enforced server-side.
- **Money:** integer paisa throughout; `fixed()` rejects negatives, exponents and extra decimals; `lineAmount` uses BigInt with half-up rounding; `allocate` is largest-remainder with deterministic tie-breaking; `Number()` on BIGINT strings is safe within the 10¹² cap; the client sends only ids and quantities and the server re-prices.
- **Online orders:** idempotent via `request_key` + `request_hash` + partial unique index; the client persists the key across reloads.
- **Images:** magic-byte sniffing for JPEG/PNG/WebP (no SVG), 1 MB cap, `nosniff`, avatars `private, no-store`, product images cache-busted with `?v=`.
- **Role isolation:** vendor product PUT/image/overview scoped by `vendor_id`; forged `vendorId` and `opening` ignored (tested); staff `/state` strips `cost_paisa`/`tax_rate_bps` and returns empty financial arrays (tested); delivery fulfilment owner-only; vendor accounts cannot be created through `/accounts`.
- **Client:** no `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function`; `printReceipt` escapes every value through `esc()`; the WhatsApp `window.open` validates `^https://wa\.me/\d+\?text=` and sets `opener=null`; `whatsappOrderLink` uses `encodeURIComponent`; `communityUrl` is validated server-side to `https:` on WhatsApp hosts; React 19 blocks `javascript:` URLs; `useLiveRefresh` clears its interval and listener and pauses hidden tabs; the barcode scanner stops camera tracks and removes its listener.
- **Audit pattern:** `AsyncLocalStorage` + `set_config('star_mart.actor')` is a neat low-overhead design, undermined only by the non-`tx()` writes (C3).

---

## 9. Tooling baseline

1. **Install:** `npm i -D prettier eslint @eslint/js eslint-plugin-react eslint-plugin-react-hooks globals`. Move `tailwindcss` and `@tailwindcss/vite` to `devDependencies`. Either install `tw-animate-css` and import it in `admin-theme.css`, or remove the `animate-in` classes (M5).
2. **Configs:** `.prettierrc`, `.prettierignore`, `eslint.config.js`, `.editorconfig`, `.github/workflows/ci.yml` — verbatim in Appendix D.
3. **Scripts:** `lint`, `format`, `format:check`, `test` (`node --test --test-concurrency=1 tests/`), `test:pg`, `check` (lint + format:check + test + build).
4. **Un-minify procedure:** do Phase 0 first (small diffs on the minified code are still reviewable); then run `npx prettier --write "src/**/*.{js,jsx,mjs,css}" "server/**/*.mjs" "tests/**/*.mjs" "*.{mjs,js}"` as one isolated commit `chore: format codebase (no logic changes)`; prove it with `npm test` before and after and by comparing `dist/assets/*.js` sizes (within noise); add the commit hash to `.git-blame-ignore-revs` once the project is in git.
5. **CI:** the workflow in Appendix D; enable "require CI to pass" on the production branch in Vercel once it is green.
6. **Conventions to adopt:** one `fail(message,status,code)` helper exported from `server/errors.mjs`; constants in `server/config.mjs` (`TIMEZONE`, `BODY_LIMIT`, `IMAGE_LIMIT`, `STAFF_MAX_DISCOUNT_BPS`, …); shared modules in `shared/` instead of `src/` imports from `server/`.

---
## Appendix A — Endpoint × role matrix

Derived from `handleRequest()` in `server/api.mjs` in source order. *Guard* is what the code enforces today; *Limit* is the `authLimit` scope today → proposed (F2); *Tx* says whether the branch's writes run inside `tx()`.

| Method | Path | Guard today | Limit today → proposed | Body | Tx | Notes |
|---|---|---|---|---|---|---|
| GET | `/images/:id` | public | – | – | – | `public,max-age=3600`, `nosniff` |
| GET | `/live/version` | public | – → none (make O(1), F8) | – | – | 11 aggregates (P1) |
| POST | `/vendor/apply` | public | `vendor-application`(ip,email) → + `vendor-application-ip` max 3 | json | Y | advisory lock per email; 409 enumerates (S8) |
| GET | `/public/settings` | public | – | – | – | returns payment account details by design |
| GET | `/public/categories` | public | – | – | – | duplicate of `/categories` |
| POST | `/public/whatsapp-order` | public (optional customer cookie) | `whatsapp-order`(ip) → + `order` per uid, guest caps | json | Y | reserves stock (S1) |
| GET | `/public/products` | public | – | – | – | unbounded, includes description (P3) |
| POST | `/password/request` | public | `reset`(ip,email) | json | Y | neutral response |
| POST | `/password/reset` | public | **none** → `reset-apply` | json | Y | |
| POST | `/customer/password` | customer | **none** → `password-change`(uid) | json | Y | |
| POST | `/customer/signup` | public | **none** → `signup-ip` max 10 | json | **N** | |
| POST | `/customer/social` | Firebase Bearer | **none** → `social-ip` | json | partial (session insert outside) | |
| POST | `/customer/login` | public | `customer-login`(ip,email) → + `login-account`(email) | json | **N** (session) | timing leak (S8) |
| GET/POST | `/customer/preferences` | customer | – | json | POST Y | FK 500 for Bearer uids (S10) |
| GET/POST | `/customer/avatar` | customer | – | image | **N** | |
| GET | `/customer/me` | customer | – | – | – | |
| POST | `/customer/logout` | cookie | – | – | **N** | |
| GET | `/customer/overview` | customer | – | – | – | |
| GET | `/customer/orders` | customer | – | – | – | |
| POST | `/customer/orders` | customer | **none** → `order`(uid) max 10/h | json | Y | reserves stock (S1) |
| GET | `/setup/status` | public | – | – | – | |
| POST | `/setup` | public (until owner exists) | **none** → `setup` max 5 (+ `SETUP_SECRET`) | json | Y | min 6 chars (S6) |
| POST | `/login` | public | `owner-login`(ip) → + `login-account` | json | **N** (session) | |
| POST | `/account/login` | public | `team-login`(ip,email) → + `login-account` | json | **N** (session) | |
| POST | `/admin/firebase-login` | Firebase Bearer | **none** → `admin-firebase` | – | **N** | |
| — | *`let user=await auth(req)` — everything below needs `sm_session`* | | | | | |
| POST | `/admin/settings` | owner | – | json | Y | |
| POST | `/account/password` | any store role | **none** → `password-change`(id) | json | Y | |
| GET | `/admin/password-requests` | owner | – | – | – | |
| POST | `/admin/password-requests/:id/issue` | owner | – | – | Y | token returned in URL (S5) |
| GET | `/customers` | worker | – | – | – | all PII, no paging (S13) |
| POST | `/customers/credit-payment` | worker | – | json | Y | |
| GET | `/customers/:id/overview` | worker | – | – | – | |
| POST | `/admin/link` | owner + Bearer | **none** → `admin-firebase` | – | **N** | |
| POST | `/logout` | any | – | – | **N** | |
| GET | `/me` | any | – | – | – | |
| GET | `/state` | any (vendor 403 *after* queries) | – | – | – | unbounded (P2) |
| GET/POST | `/admin/sample-cleanup` | owner | – | – | Y | GET takes locks (C16) |
| GET | `/admin/activity` | owner | – | – | – | |
| GET | `/reports/daily-sales` | owner | – | – | – | |
| GET | `/vendor/overview` | vendor | – | – | – | unbounded lists (P4) |
| GET | `/vendor/applications` | owner | – | – | – | |
| POST | `/vendor/applications/:id/approve` | owner | – | – | Y | |
| POST | `/vendor/applications/:id/reject` | owner | – | – | **N** | |
| GET/POST | `/vendor/returns` | owner | – | json | POST Y | |
| GET/POST | `/vendor/payments` | owner | – | json | POST Y | |
| GET/POST | `/accounts` | owner | – | json | POST **N** | staff only; min 6 chars (S6) |
| PATCH | `/accounts/:id` | owner | – | json | **N** | |
| POST | `/products/:id/image` | admin or vendor (own product) | – | image | **N** (2 statements) | |
| GET | `/categories` | any | – | – | – | duplicate |
| GET | `/orders` | worker | – | – | – | `LIMIT 1000` |
| POST | `/orders/:id/:action` | worker (delivery fulfil: owner) | – | json | Y | |
| POST | `/products/:id/stock` | owner | – | json | Y | |
| POST | `/products/bulk-action` | owner | – | json | Y | `show` resurrects deleted (C5) |
| POST | `/bulk/import` | owner | – | json | Y | 80 sync hashes (S6) |
| POST | `/import-legacy` | owner | – | json (2 MB) | Y | 30 s budget (C6) |
| POST | `/products` | admin or vendor | – | json | Y | |
| PUT | `/products/:id` | admin or vendor (own) | – | json | Y | vendor can set price (S4) |
| DELETE | `/products/:id` | owner | – | – | Y | soft delete |
| POST | `/vendors` | owner | – | json | **N** | no email validation |
| PUT | `/vendors/:id` | owner | – | json | **N** | |
| POST | `/purchases` | owner | – | json | Y | |
| POST | `/adjustments` | owner | – | json | Y | |
| POST | `/checkout` | worker | – → none (idempotency key instead) | json | Y | unlimited discount (S3), no idempotency (C1) |
| POST | `/expenses` | owner | – | json | **N** | |

---

## Appendix B — Schema and index DDL

All statements are idempotent and safe to append to the DDL list in `init()`. On a large existing Neon database, run the `CREATE INDEX` statements once by hand with `CONCURRENTLY` first.

```sql
-- P5: indexes for the queries the code runs
CREATE INDEX IF NOT EXISTS idx_order_items_order        ON customer_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_pending           ON customer_orders(status, expires_at) WHERE status='Pending';
CREATE INDEX IF NOT EXISTS idx_orders_customer          ON customer_orders(customer_uid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_updated           ON customer_orders(updated_at);
CREATE INDEX IF NOT EXISTS idx_products_updated         ON products(updated_at);
CREATE INDEX IF NOT EXISTS idx_products_vendor          ON products(vendor_id);
CREATE INDEX IF NOT EXISTS idx_movements_product_date   ON stock_movements(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_movements_date           ON stock_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_date            ON receipts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_local_day       ON receipts(((created_at AT TIME ZONE 'Asia/Karachi')::date));
CREATE INDEX IF NOT EXISTS idx_sales_product            ON sales(product_id);
CREATE INDEX IF NOT EXISTS idx_sales_date               ON sales(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_vendor         ON purchases(vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_product        ON purchases(product_id);
CREATE INDEX IF NOT EXISTS idx_purchases_date           ON purchases(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_payments_vendor   ON vendor_payments(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_returns_vendor    ON vendor_returns(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_returns_purchase  ON vendor_returns(purchase_id);
CREATE INDEX IF NOT EXISTS idx_vendor_returns_product   ON vendor_returns(product_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_customer         ON loyalty_entries(customer_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_receipt_kind     ON loyalty_entries(receipt_id, kind);
CREATE INDEX IF NOT EXISTS idx_credit_payments_receipt  ON customer_credit_payments(receipt_id);
CREATE INDEX IF NOT EXISTS idx_credit_payments_customer ON customer_credit_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_adjustments_product      ON adjustments(product_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp             ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_account_sessions_exp     ON account_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_exp    ON customer_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_reset_tokens_exp         ON password_reset_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_limits_started      ON auth_limits(started_at);

-- C5 / F9: soft-delete-aware uniqueness
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sku_key;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_barcode_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku_live     ON products(sku)     WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_live ON products(barcode) WHERE deleted_at IS NULL;

-- C1 / F3: POS idempotency
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS request_key TEXT;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS request_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_request ON receipts(request_key) WHERE request_key IS NOT NULL;

-- C7: receipts ↔ orders
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS order_id TEXT REFERENCES customer_orders(id);
CREATE INDEX IF NOT EXISTS idx_receipts_order ON receipts(order_id);
UPDATE receipts r SET order_id=o.id FROM customer_orders o WHERE r.order_id IS NULL AND r.note='Order '||o.id AND r.customer_id=o.customer_uid;

-- S3 / F4: discount accountability
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS discount_reason TEXT NOT NULL DEFAULT '';

-- S4 / F5: vendor price proposals
ALTER TABLE products ADD COLUMN IF NOT EXISTS vendor_proposed_price_paisa BIGINT;

-- S1 / F1: order lifecycle
ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS client_key TEXT;
ALTER TABLE customer_orders DROP CONSTRAINT IF EXISTS customer_orders_status_check;
ALTER TABLE customer_orders ADD CONSTRAINT customer_orders_status_check CHECK(status IN ('Inquiry','Pending','Fulfilled','Cancelled'));

-- C2 / F7: migration gate
CREATE TABLE IF NOT EXISTS schema_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- R2 (Phase 2): materialized stock
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_milli    BIGINT NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS reserved_milli BIGINT NOT NULL DEFAULT 0;
```

---

## Appendix C — Test plan additions

Shared helper first, then one file per gap. All run under `node --test --test-concurrency=1 tests/`.

**`tests/helpers.mjs`** — `isolate()` (deletes `DATABASE_URL`, `VERCEL`); `withTempDb(fn)` (the `mkdtemp` / `STAR_MART_DATA_DIR` / `close()` / `rm` sequence now duplicated in every file); `request(method, path, {body, cookie, headers, raw})` returning `{status, headers, json, cookie}` with a fake socket (`remoteAddress: '127.0.0.1'`); `setupOwner()`, `loginOwner()`, `createStaff()`, `createVendor()`, `createCustomer()`.

| File | Assertions |
|---|---|
| `security.test.mjs` | 21st `/customer/signup` from one IP → 429; 4th `/vendor/apply` from one IP with different emails → 429; 11th wrong `currentPassword` on `/account/password` → 429; spoofed `x-forwarded-for` does not reset a counter when `x-real-ip` is present; `Origin: null` on `/login` → 403; authenticated cookie + `Origin: https://evil.example` on `POST /expenses` → 403; `POST /checkout` with body `null` → 400; `x-forwarded-proto: https` yields a `Secure` cookie; JSON responses carry `x-content-type-options: nosniff`; `/setup` with a 7-character password → 400 |
| `checkout-idempotency.test.mjs` | same `requestKey` twice → one `receipts` row, identical bodies, `replayed: true` on the second; same key with a changed basket → 409; `Promise.all` of two identical posts → one receipt, one set of movements, one loyalty entry |
| `checkout-policy.test.mjs` | staff discount above cap → 403, owner → 201; response `tax` equals per-line computed tax regardless of client `tax`; `discount_reason` required when discount > 0 |
| `order-expiry.test.mjs` | guest order lands as `Inquiry` and does not reduce `publicProducts` stock; customer order with `expires_at` in the past is cancelled by `sweepIfDue()` and stock returns; 4th open order for one customer → 429; per-line cap → 400 |
| `image-upload.test.mjs` | 1 MB + 1 byte → 413; PNG and WebP magic bytes accepted and served with the right `content-type`; GIF/SVG/text → 400; vendor upload to another vendor's product → 404 |
| `settings.test.mjs` | `/admin/settings` round-trips every key; `communityUrl` on a non-WhatsApp host → 400; `whatsapp` invalid → 400; `/public/settings` reflects the change; `/live/version` changes |
| `whatsapp-order.test.mjs` | missing store number → 400; transfer method without configured account → 400; valid guest order returns a `wa.me` URL whose `text` decodes to the order summary; `guest: true` |
| `bulk-action.test.mjs` | `delete` with a pending order → 409 with `pendingOrders`; re-adding a deleted barcode succeeds (partial unique); `show` on a deleted id → 409; `hide`/`archive` transitions; `/products/:id/stock` reason required and reserved floor enforced |
| `vendor-returns.test.mjs` | return above received quantity → 400; return beyond unreserved stock → 400; ledger balance after return; return against a `Paid` purchase surfaces a negative balance (C16) |
| `customer-auth.test.mjs` (extend) | Bearer uid without a profile on `/customer/preferences` → 409 (S10); seed products through `POST /products`, not SQL |
| `orders.test.mjs` (extend) | `ClosePickup` with `received` above total stores the posted amount (C11); `receipts.order_id` set on fulfilment (C7) |
| `db.test.mjs` | `init()` recovers after a first failure; second `init()` runs no DDL when the version matches; a plain `db().query` insert concurrent with a rolled-back `tx()` survives (documents C3; remove once R4 forbids bare writes); `db()` returns PGlite when both `DATABASE_URL` and `STAR_MART_DATA_DIR` are set; a `ROLLBACK` that throws still surfaces the original error |
| `live-version.test.mjs` | version string changes after product save, settings save, image upload, order placement; every table in the trigger list has `star_mart_activity` in `pg_trigger` |
| `stock-invariant.test.mjs` (after R2) | run the flow test, then assert `products.stock_milli = SUM(stock_movements)` and `reserved_milli = SUM(pending items)` for every product |

---

## Appendix D — Tooling files

**`.prettierrc`**
```json
{"printWidth":100,"singleQuote":true,"semi":true,"trailingComma":"es5","arrowParens":"avoid","bracketSpacing":true}
```

**`.prettierignore`**
```
dist/
node_modules/
.data/
public/
package-lock.json
```

**`.editorconfig`**
```
root = true
[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
```

**`eslint.config.js`**
```js
import js from '@eslint/js';
import react from 'eslint-plugin-react';
import hooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx,mjs}'],
    plugins: { react, 'react-hooks': hooks },
    languageOptions: { globals: globals.browser, parserOptions: { ecmaFeatures: { jsx: true } } },
    settings: { react: { version: '19' } },
    rules: {
      ...react.configs.recommended.rules,
      ...hooks.configs.recommended.rules,
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      eqeqeq: 'error',
      'no-var': 'error',
    },
  },
  {
    files: ['server/**/*.mjs', 'tests/**/*.mjs', '*.mjs', 'api/**/*.js'],
    languageOptions: { globals: globals.node },
    rules: { eqeqeq: 'error', 'no-var': 'error', 'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }] },
  },
  { ignores: ['dist/', 'node_modules/', '.data/', 'public/'] },
];
```

**`package.json` scripts**
```json
{
  "dev": "node dev.mjs",
  "build": "vite build",
  "start": "node dev.mjs",
  "lint": "eslint .",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "test": "node --test --test-concurrency=1 tests/",
  "test:pg": "STAR_MART_FORCE_PG=1 node --test --test-concurrency=1 tests/",
  "check": "npm run lint && npm run format:check && npm test && npm run build"
}
```

**`.github/workflows/ci.yml`**
```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request: {}
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm run format:check
      - run: npm test
      - run: npm run build
      - run: npm audit --omit=dev --audit-level=high
        continue-on-error: true   # make blocking once S11 is cleared
```

**`.gitignore` additions**
```
.env.*.local
.vercel/
.DS_Store
coverage/
```

**`.env.example` additions**
```
# Optional defaults for the store's advance-payment accounts (editable in /admin → Store settings)
VITE_JAZZCASH_ACCOUNT=
VITE_EASYPAISA_ACCOUNT=
VITE_BANK_ACCOUNT=
# Optional: required by POST /setup on Vercel to create the owner account
SETUP_SECRET=
# Optional: comma-separated allowed origins for mutating requests (defaults to the request host)
APP_ORIGINS=
```

---

## Appendix E — `vercel.json` with security headers and a starting CSP

Requirements the policy meets: Google Fonts (`fonts.googleapis.com` CSS, `fonts.gstatic.com` files); Firebase Auth popups (the SDK loads `apis.google.com/js/api.js`, frames `https://<authDomain>/__/auth/iframe`, calls `identitytoolkit` / `securetoken`; phone auth needs the reCAPTCHA script and frame); `wa.me` links are navigations and are not governed by CSP; `/api/images/:id` and `/category-photos/*` are same-origin; canvas previews use `blob:`; the inline `<style>` in `shop.jsx` and React `style={}` props need `'unsafe-inline'` in `style-src` until R5 lands; Vite emits no inline scripts, so `script-src` has no `'unsafe-inline'`; `signInWithPopup` breaks under `Cross-Origin-Opener-Policy: same-origin`, so `same-origin-allow-popups` is used; the zxing scanner needs the camera.

```json
{
  "version": 2,
  "functions": { "api/index.js": { "maxDuration": 30 } },
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/index.js" },
    { "source": "/(.*)", "destination": "/index.html" }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin-allow-popups" },
        { "key": "Content-Security-Policy-Report-Only", "value": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self' https://apis.google.com https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://firebaseinstallations.googleapis.com; frame-src https://REPLACE-WITH-AUTH-DOMAIN https://www.google.com https://recaptcha.google.com; form-action 'self'; upgrade-insecure-requests" }
      ]
    },
    { "source": "/reset-password", "headers": [ { "key": "Referrer-Policy", "value": "no-referrer" } ] },
    { "source": "/api/(.*)", "headers": [ { "key": "Cache-Control", "value": "no-store" } ] },
    { "source": "/api/images/(.*)", "headers": [ { "key": "Cache-Control", "value": "public, max-age=3600" } ] },
    { "source": "/assets/(.*)", "headers": [ { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" } ] }
  ]
}
```

Rollout: (1) deploy as above (Report-Only) and watch DevTools during a scripted walkthrough of the storefront, checkout, customer dashboard, POS, vendor panel, Google sign-in and phone OTP; (2) replace `REPLACE-WITH-AUTH-DOMAIN` with the `VITE_FIREBASE_AUTH_DOMAIN` value; (3) after a week with no violations rename the key to `Content-Security-Policy`; (4) after R5 moves the inline style, try removing `'unsafe-inline'` (React `style={}` props may still need it). Verify with `curl -I` that `/api/images/<id>` receives `public, max-age=3600` and not `no-store`; if the platform merges the two `/api/*` rules differently, keep the images rule only and leave `no-store` to `json()`.

---

## Appendix F — Dead file removal list

Each line gives the file and the grep that proves nothing imports it (run from the repo root).

| Remove | Proof |
|---|---|
| `src/shop (1).jsx` | `grep -rn "shop (1)" src index.html` → no results |
| `src/shop (2).jsx` | `grep -rn "shop (2)" src index.html` → no results |
| `src/product-detail.jsx` | `grep -rn "product-detail.jsx" src` → only `src/shop (2).jsx` (itself dead); `shop.jsx` imports only `product-detail.css` and defines its own `ProductDetail` — reconcile first (M2) |
| `src/shop.css` | `grep -rn "shop.css" src index.html` → no results |
| `public/public/` (entire directory) | `grep -rn "/public/public\|public/category-photos" src` → only `/api/public/*` routes; `category-directory.jsx` builds `'/category-photos/'+id+'.jpg'` from the top-level folder |
| `public/sample-catalog.json` | `grep -rn "sample-catalog.json" src server` → no results (the admin links `star-mart-210-sample-catalog.zip` and `bulk-import-template.zip`) |
| `public/category-photos/gettyimages-458984207-612x612.jpg` | `grep -rn "gettyimages" src public/category-photos/credits.html` → no results; no licence recorded — remove or credit |
| In `src/main.jsx`: `Dashboard` component, `SampleCleanup`/`RecoveryQueue` imports, `setupAvailable`, `accountForm`, `videoRef`/`streamRef`/`timerRef`, `useMemo`, `Table…` imports, `ArrowDownRight`, `'vendorAvailable'` step entry | ESLint `no-unused-vars` after Appendix D |
| In `src/shop.jsx`: `samples`/`setSamples`/`preview`/`demoResult`, the `authOpen`/`ordersOpen`/`vendorOpen` modals and `applyVendor`, `onAuthStateChanged`, unused lucide icons | unreachable per C17; ESLint |
| In `src/store-pages.jsx`: `HomeSlider`, `HomePromotions` | `grep -rn "HomeSlider\|HomePromotions" src` → only their definitions |
| In `src/vendor.jsx`: `selected`, `barcode`/`video`/`stream`/`timer` refs | ESLint |
| In `server/api.mjs`: `recordActivity` import; `server/customer-auth.mjs`: `customerFrom` alias | ESLint; replace `customerFrom` with `firebaseIdentity` |
| `src/grocery-categories.mjs`: `categoryExamples()`, empty `items` arrays, `LEGACY_CATEGORIES` alias; `src/shop-departments.mjs` duplicate taxonomy | collapse to one module (M3) |

---

## Appendix G — Glossary

| Term | Meaning in this codebase |
|---|---|
| **paisa** | 1/100 rupee; all money columns are `*_paisa BIGINT` |
| **milli** | 1/1000 of a unit; all quantity columns are `*_milli BIGINT`; online orders must be multiples of 1000 |
| **movement** | a row in `stock_movements` with `kind` ∈ `opening`, `purchase`, `sale`, `adjustment` (returns use `adjustment`) |
| **stock** | `SUM(qty_milli)` of a product's movements, never stored (until R2) |
| **reserved / held** | quantity in `customer_order_items` of orders with `status='Pending'`; subtracted from stock by every consumer |
| **owner / admin** | the single `users` row with id `'owner'`; role string `'admin'` |
| **worker** | guard helper allowing `admin` or `staff` |
| **vendor** | a `store_accounts` row with `role='vendor'` linked to a `vendors` row; created only by approving a vendor application |
| **customer** | a `customer_accounts` row; session cookie `sm_customer` |
| **guest** | a WhatsApp order placed without an account; `customer_uid='guest-'+sha256(requestKey)` |
| **request key** | client-generated idempotency key (`crypto.randomUUID()`) stored with a hash of the payload |
| **actor** | the string written to `activity_events.actor` from `set_config('star_mart.actor')`, set by `tx()` from `AsyncLocalStorage` |
| **version** | the string polled from `/live/version`; any change makes clients refetch |
| **PGlite** | in-process PostgreSQL used when `DATABASE_URL` is empty; single session |

---

*End of report.*
