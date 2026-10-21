const assert = require('node:assert/strict');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { after, describe, it } = require('node:test');
const { createAiBusinessData, periodRange } = require('./aiBusinessData');
const { answerLocalQuestion, classifyQuestion, UNKNOWN_ANSWER, INTENT_REGISTRY } = require('./aiLocalAssistant');

const db = new DatabaseSync(process.env.DB_PATH || path.join(__dirname, 'smartbiz.db'), { readOnly: true });
const pool = { query: async (sql, params = []) => [db.prepare(sql).all(...params)] };
const businessData = createAiBusinessData(pool);
const ask = (question, role = 'ADMIN', history = []) => answerLocalQuestion({
  role,
  businessData,
  messages: [...history, { role: 'user', content: question }],
});

after(() => db.close());

describe('local SmartBiz assistant', () => {
  it('answers website help from the local knowledge guide', async () => {
    assert.match(await ask('What is SmartBiz?'), /inventory and sales management/i);
    assert.match(await ask('Does this chatbot use an API key?'), /does not call an external AI provider/i);
    assert.match(await ask('How does SmartBiz detect low stock?'), /compares each active product/i);
    assert.match(await ask('How does SmartBiz track expiry dates?'), /stores product expiry dates/i);
  });

  it('answers low-stock and stock questions from actual records', async () => {
    const answer = await ask('Which products are running low in stock?', 'STAFF');
    const count = db.prepare("SELECT COUNT(*) AS n FROM products WHERE status = 'ACTIVE' AND current_stock <= min_stock_level").get().n;
    assert.ok(count > 0);
    assert.match(answer, /Products at or below their minimum stock level/);
    assert.match(answer, /Sugar 1kg/);
    assert.match(answer, /does not account for incoming purchase orders/);
  });

  it('answers sales date windows and best-selling queries using database records', async () => {
    const sales = await ask('Show my sales for the last 30 days.', 'CASHIER');
    const period = periodRange('last_30_days');
    const expected = db.prepare("SELECT COUNT(*) AS n FROM sales WHERE status <> 'RETURNED' AND created_at >= ? AND created_at < ?")
      .get(period.start, period.end).n;
    assert.match(sales, new RegExp(`${expected} completed or partially returned sale`));

    const top = await ask('What are my best-selling products?', 'CASHIER');
    const expectedTop = db.prepare(
      `SELECT p.name, SUM(si.quantity - si.returned_quantity) AS units_sold
       FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
       WHERE s.status <> 'RETURNED' GROUP BY p.id, p.name
       ORDER BY units_sold DESC, p.name ASC LIMIT 5`
    ).all();
    assert.ok(expectedTop.length > 0);
    assert.ok(top.includes(expectedTop[0].name));
  });

  it('supports structured follow-up limits and revenue rankings', async () => {
    const history = [
      { role: 'user', content: 'Show best-selling products this month.' },
      { role: 'assistant', content: 'Here are the best-selling products.' },
    ];
    assert.deepEqual(classifyQuestion('Show only top 3', [...history, { role: 'user', content: 'Show only top 3' }]), {
      type: 'top_products',
      period: 'this_month',
      direction: 'descending',
      limit: 3,
    });
    const top = await ask('Show only top 3', 'MANAGER', history);
    assert.equal((top.match(/^\d+\./gm) || []).length, 3);
    const revenue = await ask('Which products generated the most revenue?', 'MANAGER');
    assert.match(revenue, /ranked by net revenue/);
    assert.deepEqual(classifyQuestion('Show only top 2', [
      { role: 'user', content: 'Which products generated the most revenue?' },
      { role: 'assistant', content: revenue },
      { role: 'user', content: 'Show only top 2' },
    ]), {
      type: 'top_products_revenue',
      period: 'all_time',
      limit: 2,
    });
  });

  it('recognizes sales synonyms, dates, comparisons, ranking metrics, and live product names', async () => {
    assert.ok(INTENT_REGISTRY.sales instanceof RegExp);
    assert.deepEqual(classifyQuestion('How much did I sell yesterday?'), { type: 'sales', period: 'yesterday' });
    assert.deepEqual(classifyQuestion('What are my sales this week?'), { type: 'sales', period: 'this_week' });
    assert.deepEqual(classifyQuestion('Show sales for the last 90 days.'), { type: 'sales', period: 'last_90_days' });
    assert.deepEqual(classifyQuestion('Compare this month with last month.'), {
      type: 'sales_comparison',
      currentPeriod: 'this_month',
      comparisonPeriod: 'last_month',
    });
    assert.deepEqual(classifyQuestion('Compare this week versus last week.'), {
      type: 'sales_comparison',
      currentPeriod: 'this_week',
      comparisonPeriod: 'last_week',
    });
    assert.deepEqual(classifyQuestion('Compare with the previous 30 days.', [
      { role: 'user', content: 'Show sales for the last 30 days.' },
      { role: 'assistant', content: 'Sales summary.' },
      { role: 'user', content: 'Compare with the previous 30 days.' },
    ]), {
      type: 'sales_comparison',
      currentPeriod: 'last_30_days',
      comparisonPeriod: 'previous_30_days',
    });
    assert.deepEqual(classifyQuestion('What is the average order value?'), {
      type: 'sales',
      period: 'this_month',
      metric: 'average_order_value',
    });
    assert.deepEqual(classifyQuestion('Rank the top 5 products by revenue.'), {
      type: 'top_products_revenue',
      period: 'all_time',
      limit: 5,
    });
    assert.equal(classifyQuestion('Which products are below their reorder level?').lowStockOnly, true);
    assert.equal(classifyQuestion('Which products are out of stock?').outOfStockOnly, true);
    const questionVariants = [
      ['How much did I sell today?', 'sales', 'today'],
      ['What were my sales yesterday?', 'sales', 'yesterday'],
      ['What are my sales this month?', 'sales', 'this_month'],
      ['Show sales for the last 7 days.', 'sales', 'last_7_days'],
      ['Show sales for the last 30 days.', 'sales', 'last_30_days'],
      ['Show sales for the last 90 days.', 'sales', 'last_90_days'],
      ['Which products sell the most?', 'top_products', 'all_time'],
      ['Which products sold the highest number of units?', 'top_products', 'all_time'],
      ['Which products sell the least?', 'top_products', 'all_time'],
      ['Which products generated the most revenue?', 'top_products_revenue', 'all_time'],
      ['What should I restock?', 'inventory', null],
      ['Which items need replenishment?', 'inventory', null],
      ['How much stock do I have?', 'inventory', null],
      ['Show my purchase history.', 'purchases', 'this_month'],
      ['Show my customers.', 'directory', null],
      ['Show recent returns.', 'returns', 'this_month'],
      ['Summarize payments by method.', 'payments', 'this_month'],
    ];
    for (const [question, expectedType, expectedPeriod] of questionVariants) {
      const intent = classifyQuestion(question);
      assert.equal(intent.type, expectedType, question);
      if (expectedPeriod) assert.equal(intent.period, expectedPeriod, question);
    }

    const product = db.prepare(
      `SELECT p.name FROM products p
       WHERE (SELECT COUNT(*) FROM products match_product WHERE match_product.name LIKE '%' || p.name || '%') = 1
         AND EXISTS (SELECT 1 FROM sale_items si WHERE si.product_id = p.id)
       ORDER BY length(p.name) DESC LIMIT 1`
    ).get();
    assert.ok(product);
    const firstQuestion = `Show sales for ${product.name}.`;
    const classified = classifyQuestion(firstQuestion);
    assert.equal(classified.type, 'product_sales');
    assert.equal(classified.search, product.name.toLowerCase());
    const initialAnswer = await ask(firstQuestion, 'CASHIER');
    assert.match(initialAnswer, new RegExp(product.name, 'i'));
    const history = [
      { role: 'user', content: firstQuestion },
      { role: 'assistant', content: initialAnswer },
    ];
    assert.deepEqual(classifyQuestion('What about last month?', [...history, { role: 'user', content: 'What about last month?' }]), {
      type: 'product_sales',
      search: product.name.toLowerCase(),
      period: 'last_month',
    });
    const followUpAnswer = await ask('What about last month?', 'CASHIER', history);
    assert.match(followUpAnswer, /last month/i);
    assert.match(followUpAnswer, new RegExp(product.name, 'i'));
  });

  it('handles out-of-stock results and declines analyses the available data cannot verify', async () => {
    const outOfStock = await ask('Which products are out of stock?', 'STAFF');
    const zeroCount = db.prepare("SELECT COUNT(*) AS n FROM products WHERE status = 'ACTIVE' AND current_stock = 0").get().n;
    assert.match(outOfStock, new RegExp(zeroCount ? 'Products with zero stock' : 'no active products with zero stock', 'i'));
    assert.match(await ask('Which products have high sales but low stock?'), /not available in the current approved/i);
    assert.match(await ask('Which products have not sold recently?'), /not available in the current approved/i);
    assert.match(await ask('Show pending payments.'), /not available in the current approved/i);
  });

  it('answers the remaining supported business areas with current database records', async () => {
    const expiry = await ask('Which products are expiring?', 'STAFF');
    assert.match(expiry, /Products expiring within 30 days|There are no products expiring/);

    const purchases = await ask('Show my purchases all time.', 'MANAGER');
    const purchaseCount = db.prepare('SELECT COUNT(*) AS n FROM purchases').get().n;
    assert.match(purchases, new RegExp(`${purchaseCount} purchase\\(s\\)`));
    const returns = await ask('Show returns all time.', 'CASHIER');
    const returnCount = db.prepare('SELECT COUNT(*) AS n FROM returns').get().n;
    assert.match(returns, new RegExp(`${returnCount} recorded return\\(s\\)`));

    const customerPayments = await ask('Show sales payments all time.', 'CASHIER');
    assert.match(customerPayments, /Recorded sales payments|no recorded sales payments/);
    const customerBalances = await ask('Which customer payments are outstanding?', 'CASHIER');
    assert.match(customerBalances, /Outstanding customer balances|no recorded outstanding customer balances/);
    const supplierBalances = await ask('Which suppliers are unpaid?', 'MANAGER');
    assert.match(supplierBalances, /Outstanding supplier balances|no recorded outstanding supplier balances/);
    const suppliers = await ask('Show my suppliers.', 'ADMIN');
    assert.match(suppliers, /Suppliers on record|There are no suppliers on record/);
    const customerCount = await ask('How many customers do I have?', 'CASHIER');
    const expectedCustomerCount = db.prepare('SELECT COUNT(*) AS n FROM customers').get().n;
    assert.match(customerCount, new RegExp(`${expectedCustomerCount} customer\\(s\\)`));

    const suppliedProduct = db.prepare(
      `SELECT p.name, p.sku, s.name AS supplier_name
       FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
       WHERE (SELECT COUNT(*) FROM products match_product WHERE match_product.name LIKE '%' || p.name || '%') = 1
       ORDER BY length(p.name) DESC LIMIT 1`
    ).get();
    const supplierAnswer = await ask(`Who supplies ${suppliedProduct.name}?`, 'MANAGER');
    assert.match(supplierAnswer, suppliedProduct.supplier_name
      ? new RegExp(suppliedProduct.supplier_name, 'i')
      : /no supplier assigned/i);
    await assert.rejects(ask(`Who supplies ${suppliedProduct.name}?`, 'CASHIER'), { status: 403 });

    const report = await ask('Show dashboard report.', 'MANAGER');
    const productCount = db.prepare("SELECT COUNT(*) AS n FROM products WHERE status = 'ACTIVE'").get().n;
    assert.match(report, new RegExp(`${productCount} active product\\(s\\)`));
    await assert.rejects(ask('Show dashboard report.', 'CASHIER'), { status: 403 });
  });

  it('explains role limits, unknown questions, and unsupported forecasts honestly', async () => {
    await assert.rejects(ask('What were my sales this month?', 'STAFF'), { status: 403 });
    await assert.rejects(ask('What was my gross profit last month?', 'CASHIER'), { status: 403 });
    assert.equal(await ask('What is the weather today?'), UNKNOWN_ANSWER);
    assert.match(await ask('Predict my sales for next month.'), /forecasting is not available/i);
  });

  it('does not make network calls while answering supported questions', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => { throw new Error('Network calls are disabled in this test.'); };
    try {
      assert.match(await ask('Show today sales.', 'MANAGER'), /Sales summary/);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
