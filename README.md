SmartBiz helps small kirana shops replace difficult paper bookkeeping with
product and inventory management, low-stock and expiry notifications, sales
tracking, and business reports.

The Admin/Manager dashboard charts use recorded sales and gross profit for the
last seven months and rank products by units sold. Charts remain empty until
real sales are entered; demo data is not seeded. Other roles see empty sales-chart
states and do not receive management sales data.

Inventory supports in-app camera scanning and handheld barcode scanners that
type a code into the "Scan & receive stock" flow. Camera access requires
browser permission and HTTPS or localhost. Camera decoding tries common retail
1D and 2D barcode formats, but damaged, blurred, or obscured labels may still
need a handheld scanner or manual entry. Existing products are matched by
barcode; new numeric barcodes can be looked up in Open Food Facts for name,
brand, and category suggestions (source:
[Open Food Facts](https://world.openfoodfacts.org/)). Verify catalog suggestions
and enter prices, received quantity, and package expiry yourself. Expiry
tracking stores the earliest date per product rather than tracking individual
batches.

## SmartBiz AI Assistant

The authenticated `POST /api/ai/chat` endpoint is a local, deterministic
JavaScript assistant. It uses intent and phrase matching plus a small built-in
guide to answer common SmartBiz questions. It does not call an external AI
provider, require an AI API key, or train a language model. Questions outside
its supported patterns receive an honest request to rephrase; sales prediction
is not available.

Supported business questions use bounded, read-only functions and parameterized
queries against the database connection already used by the Express app.
Generated SQL is never executed. The assistant recognizes alternate question
phrasing and common date ranges, including yesterday, this/last week,
this/last month, and the last 7, 30, or 90 days. It can summarize sales, compare
month/week/adjacent 30-day periods, calculate average billed order value,
rank products by sold units or net revenue, look up matching product sales and
supplier assignments, count customers, and answer questions about current,
low, zero-stock, and expiring products, purchases, balances, returns, payments,
and reports. Follow-ups can narrow a product ranking or change the reporting
period for the preceding product-sales question.

The assistant does not invent missing values. Gross profit is product margin
after returned quantities and proportionally allocated invoice discounts; it
excludes operating expenses and income tax. Pending-payment lists, forecasts,
day-by-day sales history, category profitability, stock movement/demand
forecasts, incoming purchase orders, and multi-product comparisons are not
currently implemented; the assistant identifies these limitations instead of
substituting unrelated totals.

The server uses SQLite locally by default. When `MYSQL_URL` is set, it connects
to MySQL over TLS and initializes any missing tables from `server/schema.sql`.
By default, TLS trusts the bundled Aiven CA in `server/ca.pem`. Set
`MYSQL_SSL_CA=system` to use Node.js's trusted root CAs, or set `MYSQL_SSL_CA`
to a provider's PEM certificate contents. The assistant uses the same active
database as the rest of the API.

Assistant data access uses the existing authenticated account role: all roles
can read product stock; Cashiers and above can read sales, customer balances,
returns, sales payments, and customer names; Admin and Manager roles can also
read supplier and purchase data, supplier payment information, gross profit,
and the dashboard report. Supplier directory results contain names only.

### Local setup

Use Node.js 22.12.0 or newer (the backend uses `node:sqlite`, and Vite 8
requires Node.js 20.19+ or 22.12+). Install the existing frontend and backend
dependencies from the project root:

```sh
npm --prefix client install
npm --prefix server install
```

Create a local `server/.env` file (do not commit it) and configure `JWT_SECRET`,
`PORT` (optional; defaults to `5000`), and `CLIENT_ORIGIN` (the frontend origin,
typically `http://localhost:5173`). To use MySQL locally, also set `MYSQL_URL`
to its connection URL. Without it, the backend uses SQLite. No AI provider key
is required.

Password recovery emails require `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASS`, and `SMTP_FROM` in the server environment. Use `SMTP_SECURE=true`
for implicit TLS (usually port 465); port 587 uses STARTTLS by default. Keep
these settings private and configure them in both `server/.env` and the
production API environment. Reset codes expire after 10 minutes and can only be
used once.

Start both app processes from the project root with `npm run dev`. To run them
separately in different terminals, use `npm --prefix server run dev` and
`npm --prefix client run dev`. The Vite development setup checks `VITE_API_URL`
(defaults to `http://localhost:5000/api`) and reuses an already-running
SmartBiz API rather than starting a duplicate. If another service occupies the
API port, Vite warns instead of crashing. Vite may choose another frontend port
when its default is occupied; the API's development CORS configuration permits
localhost origins.

### Deployment

The checked-in [Netlify configuration](./netlify.toml) builds the client from
`client/` and points it at the Render API. If the Render service URL changes,
update `VITE_API_URL` there and trigger a new Netlify deploy. The Render service
must allow the Netlify site origin through `CLIENT_ORIGIN`; the checked-in
[Render blueprint](./render.yaml) sets it for the published site.

The Render blueprint runs the API in production and requires `MYSQL_URL` to be
set in the Render service's environment settings. Set it to the private
connection URL for the chosen MySQL-compatible provider; do not commit it or
share it in chat. For Aiven, leave `MYSQL_SSL_CA` unset. For TiDB Cloud Starter,
set `MYSQL_SSL_CA=system`; use the prefixed database username from TiDB's
connection details. The backend creates missing tables and keeps existing
rows. Point the URL at a database containing the accounts you want to use.
TiDB Cloud Starter is MySQL-protocol compatible, but its free quota is limited
to 5 GiB row storage, 5 GiB columnar storage, and 50 million request units per
month; exceeding the quota can block new connections. The schema uses foreign
keys, so verify the selected TiDB version supports them (generally available
starting with TiDB 8.5) and test the schema before production use.
Changing providers does not copy data: export the old database and import it to
the new provider before switching the production URL. In particular, Aiven must
be accessible again before its existing rows can be exported. Accounts are
created from the sign-up page and become active immediately. The first
registered account receives the Admin role; subsequent sign-ups receive Staff
access. Admins can create employee accounts with Manager, Cashier, or Staff
roles. Public sign-up cannot select a role. SmartBiz does not send
email-verification links; password recovery uses a one-time email code. No demo
accounts are created automatically.

Render's free service may sleep, and its local filesystem is ephemeral. Keep
business data in the configured MySQL provider, not on the Render filesystem.
The deployed service refuses to start in production if `MYSQL_URL` is missing,
rather than silently using a separate local database.

There is no external AI service, outbound AI request, or AI provider credential
to configure.

All chat requests require the existing bearer-token authentication. The
endpoint limits each authenticated account to 20 requests per 10 minutes and
restricts request and conversation size.

Run the tests with `npm --prefix server test`. They execute read-only assistant
queries against `server/smartbiz.db`; set `DB_PATH` to test another existing
SQLite database.
