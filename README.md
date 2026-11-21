SmartBiz helps small kirana shops replace difficult paper bookkeeping with
product and inventory management, low-stock and expiry notifications, sales
tracking, and business reports. Each shop has its own Admin, employees, catalog,
inventory, reports, and notifications.

The Admin/Manager dashboard charts use shop-scoped sales and gross profit for
the last seven months and rank products by units sold. New shops start with no
sample history; sample data is never added automatically. Other roles see empty
sales-chart states and do not receive management sales data.

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
Expiry alerts are refreshed at startup, after relevant inventory changes, and
daily while the API is running.

## SmartBiz AI Assistant

The authenticated `POST /api/ai/chat` endpoint is a local, deterministic
JavaScript assistant. It uses intent and phrase matching plus a small built-in
guide to answer common SmartBiz questions. It does not call an external AI
provider, require an AI API key, or train a language model. Questions outside
its supported patterns receive an honest request to rephrase; sales prediction
is not available. Open it from the floating button in the bottom-right corner
of the signed-in app.

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

### Voice stock assistant

The Inventory page has an optional multilingual voice workflow. It uses the
browser's speech-recognition and text-to-speech capabilities when available;
recognized text and extracted product details remain editable. Configure an
OpenAI-compatible extraction service on the API with `VOICE_AI_API_KEY`,
`VOICE_AI_API_URL` (defaults to the OpenAI chat-completions endpoint), and
`VOICE_AI_MODEL` (defaults to `gpt-4o-mini`). Keep the key only in the server
environment; it is never sent to the browser. Without a configured key, a
limited offline parser handles simple receipt phrases, supported quantity
units, and English month/year expiry dates; other phrasing stays editable for
correction or manual entry.

Voice extraction only creates a review preview. It does not write inventory.
Missing or uncertain values, catalog matches, and possible duplicates are
shown for correction. An authorized user must explicitly review and confirm the batch;
the authenticated API then verifies shop ownership and saves stock,
transaction, and audit records atomically. No AI-generated SQL is used.

The server uses SQLite locally by default. When `MYSQL_URL` is set, it connects
to MySQL over TLS and initializes any missing tables from `server/schema.sql`.
TLS uses the bundled TiDB/Let's Encrypt ISRG Root X1 certificate by default.
Set `MYSQL_SSL_CA=system` to use Node.js's trusted root CAs together with that
certificate, or set `MYSQL_SSL_CA` to another provider's PEM certificate
contents or a certificate path relative to the backend directory. The Render
blueprint uses `MYSQL_SSL_CA=certs/isrgrootx1.pem` for TiDB Cloud Starter. The
assistant uses the same active database as the rest of the API.

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
is required for SmartBiz's local assistant. Configure `VOICE_AI_API_KEY` and,
optionally, `VOICE_AI_API_URL` and `VOICE_AI_MODEL` only if you want to use
voice stock extraction.

Password recovery emails require `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASS`, and `SMTP_FROM` in the server environment. Use `SMTP_SECURE=true`
for implicit TLS (usually port 465); port 587 uses STARTTLS by default. Keep
these settings private and configure them in both `server/.env` and the
production API environment. Reset codes expire after 10 minutes and can only be
used once. Employee invitations use the same SMTP settings and expire after
seven days. Signed-in users can change their password from the account menu
without email; a forgotten password still requires a working email setup.

Start both app processes from the project root with `npm run dev`. To run them
separately in different terminals, use `npm --prefix server run dev` and
`npm --prefix client run dev`. The Vite development setup checks `VITE_API_URL`
(defaults to `http://localhost:5000/api`) and reuses an already-running
SmartBiz API rather than starting a duplicate. If another service occupies the
API port, Vite warns instead of crashing. Vite may choose another frontend port
when its default is occupied; the API's development CORS configuration permits
localhost origins.

### Deployment

The client can be deployed to Vercel with `client/` as the project root.
`client/vercel.json` provides the SPA fallback for React Router, and
`client/.env.production` points the client at the Render API. If the Render API
URL changes, update `VITE_API_URL` in the Vercel project settings as well. The
API's `CLIENT_ORIGIN` accepts a comma-separated allowlist so the Vercel
production domain and any retained Netlify domain can both be allowed. The
checked-in [Netlify configuration](./netlify.toml) remains available as an
alternative static-hosting setup.

The Render blueprint runs the API in production and requires `MYSQL_URL` to be
set in the Render service's environment settings. Set it to the private
connection URL for the chosen MySQL-compatible provider; do not commit it or
share it in chat. For Aiven, leave `MYSQL_SSL_CA` unset. For TiDB Cloud Starter,
set `MYSQL_SSL_CA=system`; use the prefixed database username from TiDB's
connection details. The backend creates missing tables and keeps existing
rows. Point the URL at a database containing the accounts you want to use.
To enable voice extraction in production, also configure `VOICE_AI_API_KEY`
and, if needed, `VOICE_AI_API_URL` and `VOICE_AI_MODEL` as private API
environment variables.
TiDB Cloud Starter is MySQL-protocol compatible, but its free quota is limited
to 5 GiB row storage, 5 GiB columnar storage, and 50 million request units per
month; exceeding the quota can block new connections. The schema uses foreign
keys, so verify the selected TiDB version supports them (generally available
starting with TiDB 8.5) and test the schema before production use.
Changing providers does not copy data: export the old database and import it to
the new provider before switching the production URL. In particular, Aiven must
be accessible again before its existing rows can be exported. Every public
sign-up creates a new shop and its owner becomes that shop's Admin. Login uses
only email and password, without a role selector. Admins invite employees as
Manager, Cashier, or Staff, and the invitee creates their account using the
emailed link. Public
sign-up cannot choose a role. Email addresses are globally unique, so an
existing account cannot currently join a second shop. Shop registration asks
for an address and location details; users can explicitly request browser
geolocation and review or edit the resulting address before submitting.
Reverse-geocoding uses OpenStreetMap Nominatim. SmartBiz does not send
email-verification links; password recovery uses a one-time email code. No demo
accounts are created automatically.

On startup, existing unassigned records are placed into one
`Existing SmartBiz Shop` only when the database has no shops yet. Existing
users retain their current roles as shop memberships. If a database already
contains shops but has unassigned users or business records, startup stops with
an error instead of guessing which shop owns them. Back up production data
before deploying schema changes.

Render's free service may sleep, and its local filesystem is ephemeral. Keep
business data in the configured MySQL provider, not on the Render filesystem.
The deployed service refuses to start in production if `MYSQL_URL` is missing,
rather than silently using a separate local database.

### Costs

SmartBiz has no application license fee and does not use a paid AI service.
Running it locally has no hosting or AI API charge. Public hosting and database
providers may offer free tiers, but those tiers have quotas, availability
limits, and terms that can change; Render's free service can sleep, and database
overages may block service or incur charges. Email delivery, a custom domain,
and any paid hosting or database plan can also cost money. OpenStreetMap
Nominatim and Open Food Facts are public services with usage policies, not
unlimited service guarantees. Check each provider's current terms and pricing.

The local business assistant does not use an external AI service. The optional
voice stock extraction sends the transcript to the configured AI provider only
when the user requests extraction; no inventory is saved until the user
confirms it.

All chat requests require the existing bearer-token authentication. The
endpoint limits each authenticated account to 20 requests per 10 minutes and
restricts request and conversation size.

Run the tests with `npm --prefix server test`. They execute read-only assistant
queries against `server/smartbiz.db`; set `DB_PATH` to test another existing
SQLite database.
