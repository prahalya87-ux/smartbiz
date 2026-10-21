const assert = require('node:assert/strict');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { after, describe, it } = require('node:test');
const { createAiBusinessData, periodRange } = require('./aiBusinessData');

const db = new DatabaseSync(process.env.DB_PATH || path.join(__dirname, 'smartbiz.db'), { readOnly: true });
const pool = {
  query: async (sql, params = []) => [db.prepare(sql).all(...params)],
};
const businessData = createAiBusinessData(pool);
const count = (table) => Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
const todayLocal = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
};

after(() => db.close());

describe('SmartBiz AI business data against the current database', () => {
  it('calculates supported periods with exclusive end dates', () => {
    const range = periodRange('today', new Date(2026, 9, 20, 12));
    assert.deepEqual({ start: range.start, end: range.end }, { start: '2026-10-20', end: '2026-10-21' });
    assert.deepEqual(
      { start: periodRange('last_month', new Date(2026, 0, 15)).start, end: periodRange('last_month', new Date(2026, 0, 15)).end },
      { start: '2025-12-01', end: '2026-01-01' }
    );
    assert.deepEqual(
      { start: periodRange('yesterday', new Date(2026, 9, 20)).start, end: periodRange('yesterday', new Date(2026, 9, 20)).end },
      { start: '2026-10-19', end: '2026-10-20' }
    );
    assert.deepEqual(
      { start: periodRange('this_week', new Date(2026, 9, 20)).start, end: periodRange('this_week', new Date(2026, 9, 20)).end },
      { start: '2026-10-19', end: '2026-10-21' }
    );
    assert.deepEqual(
      { start: periodRange('last_week', new Date(2026, 9, 20)).start, end: periodRange('last_week', new Date(2026, 9, 20)).end },
      { start: '2026-10-12', end: '2026-10-19' }
    );
    assert.deepEqual(
      { start: periodRange('last_90_days', new Date(2026, 9, 20)).start, end: periodRange('last_90_days', new Date(2026, 9, 20)).end },
      { start: '2026-07-23', end: '2026-10-21' }
    );
    assert.deepEqual(
      { start: periodRange('previous_30_days', new Date(2026, 9, 20)).start, end: periodRange('previous_30_days', new Date(2026, 9, 20)).end },
      { start: '2026-08-22', end: '2026-09-21' }
    );
    assert.throws(() => periodRange('next_year'), /supported reporting period/);
  });

  it('answers stock and low-stock questions from active product records', async () => {
    const inventory = await businessData.execute('get_inventory', { low_stock_only: false, search: '' }, 'STAFF');
    const lowStock = await businessData.execute('get_inventory', { low_stock_only: true, search: '' }, 'CASHIER');
    assert.equal(inventory.products.length, count("products WHERE status = 'ACTIVE'"));
    assert.ok(inventory.products.length > 0);
    assert.ok(lowStock.products.length > 0);
    assert.ok(lowStock.products.every((product) => product.current_stock <= product.min_stock_level));
    const expired = await businessData.execute('get_inventory', {
      low_stock_only: false,
      search: '',
      expiry_status: 'expired',
    }, 'STAFF');
    assert.ok(expired.products.every((product) => product.expiry_date < todayLocal()));
    const injectionSearch = await businessData.execute('get_inventory', {
      low_stock_only: false,
      search: "%' OR 1=1 --",
    }, 'STAFF');
    assert.equal(injectionSearch.products.length, 0);
  });

  it('answers period sales, revenue, and management gross-profit questions from sale rows', async () => {
    const adminSummary = await businessData.execute('get_sales_summary', { period: 'all_time' }, 'ADMIN');
    const cashierSummary = await businessData.execute('get_sales_summary', { period: 'all_time' }, 'CASHIER');
    const expected = db.prepare("SELECT COUNT(*) AS count, SUM(final_amount) AS total FROM sales WHERE status <> 'RETURNED'").get();
    assert.equal(adminSummary.sale_count, expected.count);
    assert.equal(adminSummary.billed_sales_value_including_tax, expected.total);
    assert.equal(typeof adminSummary.net_merchandise_revenue_excluding_tax, 'number');
    assert.equal(typeof adminSummary.gross_profit, 'number');
    assert.equal(cashierSummary.gross_profit, undefined);
    assert.equal(cashierSummary.gross_profit_definition, undefined);
    const thisMonth = await businessData.execute('get_sales_summary', { period: 'this_month' }, 'MANAGER');
    assert.equal(thisMonth.period, 'this_month');
    assert.equal(typeof thisMonth.sale_count, 'number');
    const monthRange = periodRange('this_month');
    const expectedMonth = db.prepare("SELECT COUNT(*) AS count FROM sales WHERE status <> 'RETURNED' AND created_at >= ? AND created_at < ?")
      .get(monthRange.start, monthRange.end);
    assert.equal(thisMonth.sale_count, expectedMonth.count);
    const today = await businessData.execute('get_sales_summary', { period: 'today' }, 'MANAGER');
    const todayRange = periodRange('today');
    const expectedToday = db.prepare("SELECT COUNT(*) AS count FROM sales WHERE status <> 'RETURNED' AND created_at >= ? AND created_at < ?")
      .get(todayRange.start, todayRange.end);
    assert.equal(today.sale_count, expectedToday.count);
    assert.equal(today.average_order_value_including_tax, expectedToday.count
      ? today.billed_sales_value_including_tax / expectedToday.count
      : null);
    const lastMonth = await businessData.execute('get_sales_summary', { period: 'last_month' }, 'MANAGER');
    const lastMonthRange = periodRange('last_month');
    const expectedLastMonth = db.prepare("SELECT COUNT(*) AS count FROM sales WHERE status <> 'RETURNED' AND created_at >= ? AND created_at < ?")
      .get(lastMonthRange.start, lastMonthRange.end);
    assert.equal(lastMonth.sale_count, expectedLastMonth.count);
    const lastMonthPurchases = await businessData.execute('get_purchase_summary', { period: 'last_month' }, 'ADMIN');
    assert.equal(lastMonthPurchases.period, 'last_month');
  });

  it('compares parameterized sales periods and product sales using actual records', async () => {
    const comparison = await businessData.execute('get_sales_comparison', {
      current_period: 'this_month',
      comparison_period: 'last_month',
    }, 'MANAGER');
    const currentRange = periodRange('this_month');
    const previousRange = periodRange('last_month');
    const expectedFor = (range) => db.prepare(
      `SELECT COUNT(CASE WHEN status <> 'RETURNED' THEN 1 END) AS sale_count,
       COALESCE(SUM(CASE WHEN status <> 'RETURNED' THEN final_amount ELSE 0 END), 0) AS amount
       FROM sales WHERE created_at >= ? AND created_at < ?`
    ).get(range.start, range.end);
    const currentExpected = expectedFor(currentRange);
    const previousExpected = expectedFor(previousRange);
    assert.equal(comparison.current.sale_count, currentExpected.sale_count);
    assert.equal(comparison.current.billed_sales_value_including_tax, currentExpected.amount);
    assert.equal(comparison.comparison.billed_sales_value_including_tax, previousExpected.amount);
    assert.equal(comparison.change_amount, currentExpected.amount - previousExpected.amount);

    const soldProduct = db.prepare(
      `SELECT p.name FROM products p JOIN sale_items si ON si.product_id = p.id
       JOIN sales s ON s.id = si.sale_id WHERE s.status <> 'RETURNED'
       GROUP BY p.id ORDER BY p.name LIMIT 1`
    ).get();
    assert.ok(soldProduct);
    const productResult = await businessData.execute('get_product_sales_summary', {
      search: soldProduct.name,
      period: 'all_time',
    }, 'CASHIER');
    const matching = productResult.products.find((product) => product.name === soldProduct.name);
    assert.ok(matching);
    const expectedUnits = db.prepare(
      `SELECT SUM(si.quantity - si.returned_quantity) AS units
       FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
       WHERE p.name = ? AND s.status <> 'RETURNED'`
    ).get(soldProduct.name).units;
    assert.equal(matching.units_sold, expectedUnits);
    await assert.rejects(
      businessData.execute('get_product_sales_summary', { search: 'A', period: 'all_time' }, 'STAFF'),
      { status: 403 }
    );
  });

  it('ranks actual product revenue and returns real empty customer balance records', async () => {
    const top = await businessData.execute('get_top_products_by_revenue', { period: 'all_time' }, 'MANAGER');
    assert.ok(top.products.length > 0);
    assert.ok(top.products.every((product) => product.net_revenue_excluding_tax > 0 && product.units_sold > 0));
    const customers = await businessData.execute('get_customer_balances', { search: '' }, 'CASHIER');
    assert.equal(customers.customers.length, count('customers'));
    assert.equal(customers.customers.length, 0);
    const unlinked = db.prepare(
      `SELECT COUNT(*) AS count FROM sales s WHERE s.customer_id IS NULL
       AND s.status <> 'RETURNED' AND s.final_amount > s.amount_paid`
    ).get();
    assert.equal(customers.unlinked_outstanding_sales, unlinked.count);
  });

  it('summarizes actual purchase and supplier balances without inventing outstanding amounts', async () => {
    const purchases = await businessData.execute('get_purchase_summary', { period: 'all_time' }, 'ADMIN');
    const expected = db.prepare('SELECT COUNT(*) AS count, SUM(total_amount) AS total FROM purchases').get();
    assert.equal(purchases.purchase_count, expected.count);
    assert.equal(purchases.total_purchase_value, expected.total);
    assert.ok(Array.isArray(purchases.top_purchased_products));
    assert.ok(purchases.top_purchased_products.length > 0);
    assert.equal(purchases.purchases_missing_item_details, db.prepare(
      `SELECT COUNT(*) AS count FROM purchases p
       WHERE NOT EXISTS (SELECT 1 FROM purchase_items pi WHERE pi.purchase_id = p.id)`
    ).get().count);
    const suppliers = await businessData.execute('get_supplier_balances', { search: '' }, 'MANAGER');
    const expectedSuppliers = db.prepare(
      `SELECT s.name, COUNT(p.id) AS outstanding_purchases, SUM(p.total_amount - p.amount_paid) AS outstanding_amount
       FROM suppliers s JOIN purchases p ON p.supplier_id = s.id
       WHERE p.total_amount > p.amount_paid GROUP BY s.id, s.name ORDER BY outstanding_amount DESC LIMIT 20`
    ).all();
    assert.deepEqual(suppliers.suppliers, expectedSuppliers);
  });

  it('reads actual returns and payments, including empty returns and role-scoped payment details', async () => {
    const returns = await businessData.execute('get_returns_summary', { period: 'all_time' }, 'CASHIER');
    assert.equal(returns.return_count, count('returns'));
    assert.equal(returns.returned_units, db.prepare('SELECT COALESCE(SUM(quantity), 0) AS units FROM return_items').get().units);
    assert.deepEqual(returns.returned_products, []);
    const adminPayments = await businessData.execute('get_payment_summary', { period: 'all_time', payment_type: 'all' }, 'ADMIN');
    const cashierPayments = await businessData.execute('get_payment_summary', { period: 'all_time', payment_type: 'sales' }, 'CASHIER');
    assert.ok(adminPayments.payments.length > 0);
    assert.ok(cashierPayments.payments.every((payment) => payment.payment_type === 'sales'));
    const recordedPayments = db.prepare('SELECT SUM(amount) AS amount FROM payments').get().amount;
    assert.ok(Math.abs(adminPayments.payments.reduce((total, payment) => total + payment.payment_amount, 0) - recordedPayments) < 0.01);
    if (count('returns') === 0) assert.equal(returns.refunds, 0);
  });

  it('exposes names only in the directory and matches the existing dashboard report', async () => {
    const customers = await businessData.execute('get_directory', { entity: 'customers', search: '' }, 'CASHIER');
    const suppliers = await businessData.execute('get_directory', { entity: 'suppliers', search: '' }, 'ADMIN');
    assert.equal(customers.names.length, count('customers'));
    assert.equal(suppliers.names.length, count('suppliers'));
    assert.ok(suppliers.names.length > 0);
    assert.ok(suppliers.names.every((name) => typeof name === 'string'));
    const report = await businessData.execute('get_dashboard_report', {}, 'MANAGER');
    assert.ok(report.products.total_products > 0);
    assert.ok(Array.isArray(report.sales_by_month));
    assert.ok(Array.isArray(report.purchases_by_month));
    assert.ok(Array.isArray(report.top_selling));
  });

  it('enforces role permissions both when listing and executing tools', async () => {
    assert.ok(businessData.getTools('STAFF').every((tool) => tool.name === 'get_inventory'));
    assert.ok(businessData.getTools('CASHIER').every((tool) =>
      !['get_purchase_summary', 'get_supplier_balances', 'get_dashboard_report'].includes(tool.name)));
    await assert.rejects(
      businessData.execute('get_sales_summary', { period: 'all_time' }, 'STAFF'),
      { status: 403 }
    );
    await assert.rejects(
      businessData.execute('get_supplier_balances', { search: '' }, 'CASHIER'),
      { status: 403 }
    );
    await assert.rejects(
      businessData.execute('get_payment_summary', { period: 'all_time', payment_type: 'all' }, 'CASHIER'),
      { status: 403 }
    );
  });
});
