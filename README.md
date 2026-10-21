SmartBiz helps small kirana shops replace difficult paper bookkeeping with
product and inventory management, low-stock and expiry notifications, sales
tracking, and business reports.

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

The checked-in schema files include a MySQL schema, but the active server opens
`server/smartbiz.db` through Node's built-in SQLite driver. The assistant
reuses that active database and requires no schema changes or database
migration.

Assistant data access uses the existing authenticated account role: all roles
can read product stock; Cashiers and above can read sales, customer balances,
returns, sales payments, and customer names; Admin and Manager roles can also
read supplier and purchase data, supplier payment information, gross profit,
and the dashboard report. Supplier directory results contain names only.

### Local setup

Use Node.js 22.5 or newer (the backend uses `node:sqlite`). Install the existing
frontend and backend dependencies from the project root:

```sh
npm --prefix client install
npm --prefix server install
```

Create a local `server/.env` file (do not commit it) and configure `JWT_SECRET`,
`PORT` (optional; defaults to `5000`), and `CLIENT_ORIGIN` (the frontend origin,
typically `http://localhost:5173`). No AI provider key or additional package is
required.

Start both app processes from the project root with `npm run dev`. To run them
separately in different terminals, use `npm --prefix server run dev` and
`npm --prefix client run dev`. The Vite development setup checks `VITE_API_URL`
(defaults to `http://localhost:5000/api`) and reuses an already-running
SmartBiz API rather than starting a duplicate. If another service occupies the
API port, Vite warns instead of crashing. Vite may choose another frontend port
when its default is occupied; the API's development CORS configuration permits
localhost origins.

### Deployment

Deploy the client and Express server separately. Configure `JWT_SECRET`,
`PORT` if needed, and `CLIENT_ORIGIN` as backend environment variables. Set
the frontend build variable `VITE_API_URL` to the deployed API base URL (for
example, `https://api.example.com/api`), and build with
`npm --prefix client run build`. Use Node.js 22.5 or newer on the backend.
There is no external AI service, outbound AI request, or AI provider credential
to configure.

All chat requests require the existing bearer-token authentication. The
endpoint limits each authenticated account to 20 requests per 10 minutes and
restricts request and conversation size.

Run the tests with `npm --prefix server test`. They execute read-only assistant
queries against `server/smartbiz.db`; set `DB_PATH` to test another existing
SQLite database.
