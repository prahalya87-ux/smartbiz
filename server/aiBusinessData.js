const ROLE_ACCESS = {
  inventory: ['ADMIN', 'MANAGER', 'CASHIER', 'STAFF'],
  sales: ['ADMIN', 'MANAGER', 'CASHIER'],
  management: ['ADMIN', 'MANAGER'],
  customerSales: ['ADMIN', 'MANAGER', 'CASHIER'],
};

const PERIODS = new Set([
  'today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month',
  'last_7_days', 'last_30_days', 'previous_30_days', 'last_90_days', 'last_7_months', 'all_time',
]);
const pad = (value) => String(value).padStart(2, '0');
const localDate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function periodRange(period, now = new Date()) {
  if (!PERIODS.has(period)) throw Object.assign(new Error('Choose a supported reporting period.'), { status: 400 });
  if (period === 'all_time') return { start: null, end: null, period };

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(today);
  const end = new Date(today);
  end.setDate(end.getDate() + 1);
  if (period === 'yesterday') {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  } else if (period === 'this_week') {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  } else if (period === 'last_week') {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - 7);
    end.setTime(start.getTime());
    end.setDate(end.getDate() + 7);
  } else if (period === 'this_month') {
    start.setDate(1);
    end.setDate(1);
    end.setMonth(end.getMonth() + 1);
  }
  else if (period === 'last_month') {
    start.setDate(1);
    start.setMonth(start.getMonth() - 1);
    end.setDate(1);
  } else if (period === 'last_7_days') start.setDate(start.getDate() - 6);
  else if (period === 'last_30_days') start.setDate(start.getDate() - 29);
  else if (period === 'previous_30_days') {
    start.setDate(start.getDate() - 59);
    end.setDate(end.getDate() - 30);
  } else if (period === 'last_90_days') start.setDate(start.getDate() - 89);
  else if (period === 'last_7_months') {
    start.setDate(1);
    start.setMonth(start.getMonth() - 6);
    end.setDate(1);
    end.setMonth(end.getMonth() + 1);
  }
  return { start: localDate(start), end: localDate(end), period };
}

const dateClause = (column, range) => range.start
  ? { sql: `${column} >= ? AND ${column} < ?`, params: [range.start, range.end] }
  : { sql: '1 = 1', params: [] };

function createAiBusinessData(pool, clock = () => new Date()) {
  const definitions = [
    {
      name: 'get_inventory',
      description: 'Read current stock, product catalog, low-stock items, and reorder levels.',
      access: ROLE_ACCESS.inventory,
      parameters: {
        type: 'object',
        properties: {
          low_stock_only: { type: 'boolean', description: 'Only include products at or below their minimum stock level.' },
          out_of_stock_only: { type: 'boolean', description: 'Only include products with zero current stock.' },
          search: { type: 'string', description: 'Optional product-name or SKU search text.' },
          expiry_status: { type: 'string', enum: ['any', 'expired', 'expiring'], description: 'Optionally filter expired products or products expiring within 30 days.' },
        },
        required: ['low_stock_only', 'search', 'expiry_status'],
        additionalProperties: false,
      },
      run: async ({ low_stock_only = false, out_of_stock_only = false, search = '', expiry_status = 'any' }) => {
        if (typeof low_stock_only !== 'boolean' || typeof out_of_stock_only !== 'boolean'
          || typeof search !== 'string' || search.length > 100
          || !['any', 'expired', 'expiring'].includes(expiry_status)) {
          throw Object.assign(new Error('Invalid product search.'), { status: 400 });
        }
        const clauses = ["p.status = 'ACTIVE'"];
        const params = [];
        const today = localDate(clock());
        if (out_of_stock_only) clauses.push('p.current_stock = 0');
        else if (low_stock_only) clauses.push('p.current_stock <= p.min_stock_level');
        if (expiry_status === 'expired') {
          clauses.push('p.expiry_date IS NOT NULL AND p.expiry_date < ?');
          params.push(today);
        } else if (expiry_status === 'expiring') {
          const until = new Date(clock());
          until.setDate(until.getDate() + 31);
          clauses.push('p.expiry_date IS NOT NULL AND p.expiry_date >= ? AND p.expiry_date < ?');
          params.push(today, localDate(until));
        }
        if (search) {
          clauses.push('(p.name LIKE ? OR p.sku LIKE ?)');
          params.push(`%${search}%`, `%${search}%`);
        }
        const [rows] = await pool.query(
          `SELECT p.name, p.sku, p.current_stock, p.min_stock_level, p.reorder_quantity, p.expiry_date
           FROM products p WHERE ${clauses.join(' AND ')}
           ORDER BY p.current_stock ASC, p.name ASC LIMIT 50`,
          params
        );
        return { products: rows, truncated: rows.length === 50, source: 'active product records', expiry_filter: expiry_status };
      },
    },
    {
      name: 'get_sales_summary',
      description: 'Summarize sales, net merchandise revenue excluding tax, and gross profit for a period.',
      access: ROLE_ACCESS.sales,
      parameters: { type: 'object', properties: { period: { type: 'string', enum: [...PERIODS] } }, required: ['period'], additionalProperties: false },
      run: async ({ period }, role) => {
        const range = periodRange(period, clock());
        const filter = dateClause('s.created_at', range);
        const [[summary]] = await pool.query(
          `SELECT COUNT(CASE WHEN s.status <> 'RETURNED' THEN 1 END) AS sale_count,
             COALESCE(SUM(CASE WHEN s.status <> 'RETURNED' THEN s.final_amount ELSE 0 END), 0) AS billed_sales_value_including_tax,
             COALESCE(SUM(CASE WHEN s.status <> 'RETURNED' THEN s.amount_paid ELSE 0 END), 0) AS amount_paid,
             COALESCE(SUM(CASE WHEN s.status <> 'RETURNED' THEN s.tax_amount ELSE 0 END), 0) AS tax_collected,
             CASE WHEN SUM(CASE WHEN s.status <> 'RETURNED' AND NOT EXISTS
               (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id) THEN 1 ELSE 0 END) > 0 THEN NULL
               ELSE COALESCE(SUM(CASE WHEN s.status <> 'RETURNED' AND s.subtotal > 0 THEN
                 (SELECT COALESCE(SUM(si.unit_price * (si.quantity - si.returned_quantity)), 0)
                  FROM sale_items si WHERE si.sale_id = s.id) * (s.subtotal - s.discount) / s.subtotal
                 ELSE 0 END), 0) END AS net_merchandise_revenue_excluding_tax,
             ${ROLE_ACCESS.management.includes(role) ? `CASE WHEN SUM(CASE WHEN s.status <> 'RETURNED' AND NOT EXISTS
               (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id) THEN 1 ELSE 0 END) > 0 THEN NULL
               ELSE COALESCE(SUM(CASE WHEN s.status <> 'RETURNED' THEN
               CASE WHEN s.subtotal > 0 THEN
                 (s.subtotal - s.discount) *
                 (SELECT COALESCE(SUM((si.unit_price - si.cost_price) *
                    (si.quantity - si.returned_quantity)), 0)
                  FROM sale_items si WHERE si.sale_id = s.id) / s.subtotal
                 ELSE 0 END ELSE 0 END), 0) END` : 'NULL'} AS gross_profit
           FROM sales s WHERE ${filter.sql}`,
          filter.params
        );
        const [[returns]] = await pool.query(
          `SELECT COALESCE(SUM(r.refund_amount), 0) AS refunds
           FROM returns r JOIN sales s ON s.id = r.sale_id WHERE ${filter.sql}`,
          filter.params
        );
        const hasIncompleteSales = summary.net_merchandise_revenue_excluding_tax === null;
        const result = {
          period,
          sale_count: Number(summary.sale_count),
          billed_sales_value_including_tax: Number(summary.billed_sales_value_including_tax),
          average_order_value_including_tax: summary.sale_count
            ? Number(summary.billed_sales_value_including_tax) / Number(summary.sale_count)
            : null,
          billed_sales_definition: 'Recorded final_amount for sales not fully returned; includes tax and is not reduced by refund_amount.',
          amount_paid: Number(summary.amount_paid),
          tax_collected: Number(summary.tax_collected),
          net_merchandise_revenue_excluding_tax: hasIncompleteSales ? null : Number(summary.net_merchandise_revenue_excluding_tax),
          net_merchandise_revenue_definition: 'Recorded item selling value after returned quantities and proportional invoice discounts, excluding tax.',
          refunds_on_period_sales: Number(returns.refunds),
          refunds_definition: 'Recorded refund_amount linked to sales created in this reporting period.',
          currency: 'INR',
        };
        if (hasIncompleteSales) {
          result.data_limitation = 'At least one sale has no item details; item revenue and gross profit cannot be completely calculated.';
        }
        if (summary.gross_profit !== null) {
          result.gross_profit = hasIncompleteSales ? null : Number(summary.gross_profit);
          result.gross_profit_definition = 'Product margin after recorded returned quantities and invoice discounts allocated proportionally; excludes operating expenses and income tax.';
        } else if (ROLE_ACCESS.management.includes(role) && hasIncompleteSales) {
          result.gross_profit = null;
          result.gross_profit_definition = 'Product margin after recorded returns and discounts; excludes operating expenses and income tax.';
        }
        return result;
      },
    },
    {
      name: 'get_sales_comparison',
      description: 'Compare completed or partially returned sale counts and billed totals for two supported periods.',
      access: ROLE_ACCESS.sales,
      parameters: {
        type: 'object',
        properties: {
          current_period: { type: 'string', enum: [...PERIODS] },
          comparison_period: { type: 'string', enum: [...PERIODS] },
        },
        required: ['current_period', 'comparison_period'],
        additionalProperties: false,
      },
      run: async ({ current_period, comparison_period }) => {
        const summarize = async (period) => {
          const range = periodRange(period, clock());
          const filter = dateClause('created_at', range);
          const [[summary]] = await pool.query(
            `SELECT COUNT(CASE WHEN status <> 'RETURNED' THEN 1 END) AS sale_count,
               COALESCE(SUM(CASE WHEN status <> 'RETURNED' THEN final_amount ELSE 0 END), 0) AS billed_sales_value_including_tax
             FROM sales WHERE ${filter.sql}`,
            filter.params
          );
          return {
            period,
            sale_count: Number(summary.sale_count),
            billed_sales_value_including_tax: Number(summary.billed_sales_value_including_tax),
          };
        };
        const [current, comparison] = await Promise.all([
          summarize(current_period),
          summarize(comparison_period),
        ]);
        const change = current.billed_sales_value_including_tax - comparison.billed_sales_value_including_tax;
        return {
          current,
          comparison,
          change_amount: change,
          change_percent: comparison.billed_sales_value_including_tax
            ? (change / comparison.billed_sales_value_including_tax) * 100
            : null,
          metric_definition: 'Billed sales value based on recorded final_amount, including tax and not reduced by refund_amount.',
          currency: 'INR',
        };
      },
    },
    {
      name: 'get_product_sales_summary',
      description: 'Find product names/SKUs and summarize actual sold units and net revenue for a period.',
      access: ROLE_ACCESS.sales,
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Product name or SKU fragment.' },
          period: { type: 'string', enum: [...PERIODS] },
        },
        required: ['search', 'period'],
        additionalProperties: false,
      },
      run: async ({ search, period }) => {
        if (typeof search !== 'string' || search.trim().length < 2 || search.length > 100) {
          throw Object.assign(new Error('Please provide at least two characters of a product name or SKU.'), { status: 400 });
        }
        const range = periodRange(period, clock());
        const filter = dateClause('s.created_at', range);
        const [products] = await pool.query(
          `SELECT p.name, p.sku,
             COALESCE(SUM(CASE WHEN s.status <> 'RETURNED' THEN si.quantity - si.returned_quantity ELSE 0 END), 0) AS units_sold,
             COALESCE(SUM(CASE WHEN s.status <> 'RETURNED' THEN
               si.unit_price * (si.quantity - si.returned_quantity) *
               CASE WHEN s.subtotal > 0 THEN (s.subtotal - s.discount) / s.subtotal ELSE 0 END
               ELSE 0 END), 0) AS net_revenue_excluding_tax
           FROM products p
           LEFT JOIN sale_items si ON si.product_id = p.id
           LEFT JOIN sales s ON s.id = si.sale_id AND ${filter.sql}
           WHERE p.name LIKE ? OR p.sku LIKE ?
           GROUP BY p.id, p.name, p.sku
           ORDER BY p.name LIMIT 20`,
          [...filter.params, `%${search.trim()}%`, `%${search.trim()}%`]
        );
        return { period, products, truncated: products.length === 20, currency: 'INR' };
      },
    },
    {
      name: 'get_top_products_by_revenue',
      description: 'Rank products by net merchandise revenue excluding tax and proportional invoice discounts.',
      access: ROLE_ACCESS.sales,
      parameters: {
        type: 'object',
        properties: { period: { type: 'string', enum: [...PERIODS] }, limit: { type: 'integer', minimum: 1, maximum: 10 } },
        required: ['period'],
        additionalProperties: false,
      },
      run: async ({ period, limit = 10 }) => {
        if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
          throw Object.assign(new Error('Choose between 1 and 10 products.'), { status: 400 });
        }
        const range = periodRange(period, clock());
        const filter = dateClause('s.created_at', range);
        const [rows] = await pool.query(
          `SELECT p.name, p.sku,
             SUM(si.unit_price * (si.quantity - si.returned_quantity) *
               CASE WHEN s.subtotal > 0 THEN (s.subtotal - s.discount) / s.subtotal ELSE 0 END) AS net_revenue_excluding_tax,
             SUM(si.quantity - si.returned_quantity) AS units_sold
           FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
           WHERE ${filter.sql} AND s.status <> 'RETURNED'
           GROUP BY p.id, p.name, p.sku
           HAVING units_sold > 0
           ORDER BY net_revenue_excluding_tax DESC LIMIT ?`,
          [...filter.params, limit]
        );
        const [[incomplete]] = await pool.query(
          `SELECT COUNT(*) AS sales_missing_item_details FROM sales s
           WHERE ${filter.sql} AND s.status <> 'RETURNED'
             AND NOT EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id)`,
          filter.params
        );
        return {
          period,
          products: rows,
          sales_missing_item_details: Number(incomplete.sales_missing_item_details),
          currency: 'INR',
          revenue_definition: 'After item returns, excluding tax, with invoice discounts allocated proportionally.',
        };
      },
    },
    {
      name: 'get_top_products_by_units',
      description: 'Rank products by units sold in a period, highest or lowest first.',
      access: ROLE_ACCESS.sales,
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: [...PERIODS] },
          direction: { type: 'string', enum: ['ascending', 'descending'] },
          limit: { type: 'integer', minimum: 1, maximum: 10 },
        },
        required: ['period', 'direction', 'limit'],
        additionalProperties: false,
      },
      run: async ({ period, direction, limit }) => {
        if (!['ascending', 'descending'].includes(direction) || !Number.isInteger(limit) || limit < 1 || limit > 10) {
          throw Object.assign(new Error('Invalid product ranking request.'), { status: 400 });
        }
        const range = periodRange(period, clock());
        const filter = dateClause('s.created_at', range);
        const order = direction === 'ascending' ? 'ASC' : 'DESC';
        const [rows] = await pool.query(
          `SELECT p.name, p.sku, SUM(si.quantity - si.returned_quantity) AS units_sold,
             SUM(si.unit_price * (si.quantity - si.returned_quantity) *
               CASE WHEN s.subtotal > 0 THEN (s.subtotal - s.discount) / s.subtotal ELSE 0 END) AS net_revenue_excluding_tax
           FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
           WHERE ${filter.sql} AND s.status <> 'RETURNED'
           GROUP BY p.id, p.name, p.sku
           HAVING units_sold > 0
           ORDER BY units_sold ${order}, p.name ASC LIMIT ?`,
          [...filter.params, limit]
        );
        return { period, direction, products: rows, currency: 'INR' };
      },
    },
    {
      name: 'get_customer_balances',
      description: 'List customers with outstanding unpaid balances from their recorded sales.',
      access: ROLE_ACCESS.customerSales,
      parameters: { type: 'object', properties: { search: { type: 'string', description: 'Optional customer-name search.' } }, required: ['search'], additionalProperties: false },
      run: async ({ search = '' }) => {
        if (typeof search !== 'string' || search.length > 100) {
          throw Object.assign(new Error('Invalid customer search.'), { status: 400 });
        }
        const openBalance = `s.final_amount - s.amount_paid -
          COALESCE((SELECT SUM(r.refund_amount) FROM returns r WHERE r.sale_id = s.id), 0)`;
        const clauses = [`(${openBalance}) > 0`, "s.status <> 'RETURNED'"];
        const params = [];
        if (search) { clauses.push('c.name LIKE ?'); params.push(`%${search}%`); }
        const [rows] = await pool.query(
          `SELECT c.name, COUNT(s.id) AS outstanding_sales,
             SUM(${openBalance}) AS outstanding_amount
           FROM customers c JOIN sales s ON s.customer_id = c.id
           WHERE ${clauses.join(' AND ')}
           GROUP BY c.id, c.name ORDER BY outstanding_amount DESC LIMIT 20`,
          params
        );
        const [[unlinked]] = await pool.query(
          `SELECT COUNT(*) AS outstanding_sales, COALESCE(SUM(${openBalance}), 0) AS outstanding_amount
           FROM sales s WHERE s.customer_id IS NULL AND (${openBalance}) > 0 AND s.status <> 'RETURNED'`
        );
        return {
          customers: rows,
          unlinked_outstanding_sales: Number(unlinked.outstanding_sales),
          unlinked_outstanding_amount: Number(unlinked.outstanding_amount),
          currency: 'INR',
          balance_source: 'sales final_amount minus recorded amount_paid and refunds; unlinked sales are reported separately.',
        };
      },
    },
    {
      name: 'get_purchase_summary',
      description: 'Summarize purchase orders and recorded supplier payments for a period.',
      access: ROLE_ACCESS.management,
      parameters: { type: 'object', properties: { period: { type: 'string', enum: [...PERIODS] } }, required: ['period'], additionalProperties: false },
      run: async ({ period }) => {
        const range = periodRange(period, clock());
        const filter = dateClause('p.purchase_date', range);
        const [[summary]] = await pool.query(
          `SELECT COUNT(*) AS purchase_count, COALESCE(SUM(total_amount), 0) AS total_purchase_value,
             COALESCE(SUM(amount_paid), 0) AS amount_paid,
             COALESCE(SUM(total_amount - amount_paid), 0) AS outstanding_amount
           FROM purchases p WHERE ${filter.sql}`,
          filter.params
        );
        const [items] = await pool.query(
          `SELECT pr.name, pr.sku, SUM(pi.quantity) AS units_purchased
           FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
           JOIN products pr ON pr.id = pi.product_id
           WHERE ${filter.sql}
           GROUP BY pr.id, pr.name, pr.sku ORDER BY units_purchased DESC LIMIT 10`,
          filter.params
        );
        const [[incomplete]] = await pool.query(
          `SELECT COUNT(*) AS purchases_missing_item_details FROM purchases p
           WHERE ${filter.sql}
             AND NOT EXISTS (SELECT 1 FROM purchase_items pi WHERE pi.purchase_id = p.id)`,
          filter.params
        );
        return {
          period,
          ...summary,
          top_purchased_products: items,
          purchases_missing_item_details: Number(incomplete.purchases_missing_item_details),
          currency: 'INR',
        };
      },
    },
    {
      name: 'get_supplier_balances',
      description: 'List suppliers with outstanding balances from recorded purchases.',
      access: ROLE_ACCESS.management,
      parameters: { type: 'object', properties: { search: { type: 'string', description: 'Optional supplier-name search.' } }, required: ['search'], additionalProperties: false },
      run: async ({ search = '' }) => {
        if (typeof search !== 'string' || search.length > 100) {
          throw Object.assign(new Error('Invalid supplier search.'), { status: 400 });
        }
        const clauses = ['p.total_amount > p.amount_paid'];
        const params = [];
        if (search) { clauses.push('s.name LIKE ?'); params.push(`%${search}%`); }
        const [rows] = await pool.query(
          `SELECT s.name, COUNT(p.id) AS outstanding_purchases,
             SUM(p.total_amount - p.amount_paid) AS outstanding_amount
           FROM suppliers s JOIN purchases p ON p.supplier_id = s.id
           WHERE ${clauses.join(' AND ')}
           GROUP BY s.id, s.name ORDER BY outstanding_amount DESC LIMIT 20`,
          params
        );
        return { suppliers: rows, currency: 'INR', balance_source: 'purchase total_amount minus recorded amount_paid.' };
      },
    },
    {
      name: 'get_returns_summary',
      description: 'Summarize recorded returns, returned units, resolutions, and refunds for a period.',
      access: ROLE_ACCESS.sales,
      parameters: { type: 'object', properties: { period: { type: 'string', enum: [...PERIODS] } }, required: ['period'], additionalProperties: false },
      run: async ({ period }) => {
        const range = periodRange(period, clock());
        const filter = dateClause('r.created_at', range);
        const [[summary]] = await pool.query(
          `SELECT COUNT(*) AS return_count, COALESCE(SUM(r.refund_amount), 0) AS refunds
           FROM returns r WHERE ${filter.sql}`,
          filter.params
        );
        const [[units]] = await pool.query(
          `SELECT COALESCE(SUM(ri.quantity), 0) AS returned_units
           FROM return_items ri JOIN returns r ON r.id = ri.return_id WHERE ${filter.sql}`,
          filter.params
        );
        const [[incomplete]] = await pool.query(
          `SELECT COUNT(*) AS returns_missing_item_details FROM returns r
           WHERE ${filter.sql} AND NOT EXISTS (SELECT 1 FROM return_items ri WHERE ri.return_id = r.id)`,
          filter.params
        );
        const [resolutions] = await pool.query(
          `SELECT r.resolution, COUNT(DISTINCT r.id) AS return_count
           FROM returns r WHERE ${filter.sql} GROUP BY r.resolution`,
          filter.params
        );
        const [products] = await pool.query(
          `SELECT p.name, p.sku, SUM(ri.quantity) AS returned_units
           FROM return_items ri JOIN returns r ON r.id = ri.return_id
           JOIN products p ON p.id = ri.product_id
           WHERE ${filter.sql} GROUP BY p.id, p.name, p.sku
           ORDER BY returned_units DESC LIMIT 10`,
          filter.params
        );
        return {
          period,
          ...summary,
          returned_units: Number(incomplete.returns_missing_item_details) > 0 ? null : Number(units.returned_units),
          returns_missing_item_details: Number(incomplete.returns_missing_item_details),
          resolutions,
          returned_products: products,
          currency: 'INR',
        };
      },
    },
    {
      name: 'get_payment_summary',
      description: 'Summarize recorded payments received from sales or paid toward purchases.',
      access: ROLE_ACCESS.sales,
      parameters: {
        type: 'object',
        properties: { period: { type: 'string', enum: [...PERIODS] }, payment_type: { type: 'string', enum: ['sales', 'purchases', 'all'] } },
        required: ['period', 'payment_type'],
        additionalProperties: false,
      },
      run: async ({ period, payment_type }, role) => {
        if (!PERIODS.has(period) || !['sales', 'purchases', 'all'].includes(payment_type)) {
          throw Object.assign(new Error('Invalid payment summary request.'), { status: 400 });
        }
        if (payment_type !== 'sales' && !ROLE_ACCESS.management.includes(role)) {
          throw Object.assign(new Error('Only Admins and Managers can view supplier payment information.'), { status: 403 });
        }
        const range = periodRange(period, clock());
        const filter = dateClause('paid_at', range);
        const [rows] = await pool.query(
          `SELECT CASE WHEN sale_id IS NOT NULL THEN 'sales'
                       WHEN purchase_id IS NOT NULL THEN 'purchases' ELSE 'unlinked' END AS payment_type,
             method, COUNT(*) AS payment_count, SUM(amount) AS payment_amount
           FROM payments WHERE ${filter.sql}
             AND (? = 'all' OR (? = 'sales' AND sale_id IS NOT NULL) OR (? = 'purchases' AND purchase_id IS NOT NULL))
           GROUP BY payment_type, method ORDER BY payment_type, payment_amount DESC`,
          [...filter.params, payment_type, payment_type, payment_type]
        );
        return { period, payments: rows, currency: 'INR' };
      },
    },
    {
      name: 'get_directory',
      description: 'Search customer or supplier names only. Does not expose private contact details.',
      access: ROLE_ACCESS.customerSales,
      parameters: {
        type: 'object',
        properties: { entity: { type: 'string', enum: ['customers', 'suppliers'] }, search: { type: 'string' } },
        required: ['entity', 'search'],
        additionalProperties: false,
      },
      run: async ({ entity, search = '' }, role) => {
        if (!['customers', 'suppliers'].includes(entity) || typeof search !== 'string' || search.length > 100) {
          throw Object.assign(new Error('Invalid directory search.'), { status: 400 });
        }
        if (entity === 'suppliers' && !ROLE_ACCESS.management.includes(role)) {
          throw Object.assign(new Error('Only Admins and Managers can view supplier information.'), { status: 403 });
        }
        const [rows] = await pool.query(
          `SELECT name FROM ${entity} WHERE name LIKE ? ORDER BY name LIMIT 20`,
          [`%${search}%`]
        );
        const [[count]] = await pool.query(
          `SELECT COUNT(*) AS total_count FROM ${entity} WHERE name LIKE ?`,
          [`%${search}%`]
        );
        return {
          entity,
          names: rows.map((row) => row.name),
          total_count: Number(count.total_count),
          truncated: Number(count.total_count) > rows.length,
        };
      },
    },
    {
      name: 'get_product_supplier',
      description: 'Find supplier assignments for a product name or SKU; management roles only.',
      access: ROLE_ACCESS.management,
      parameters: {
        type: 'object',
        properties: { search: { type: 'string' } },
        required: ['search'],
        additionalProperties: false,
      },
      run: async ({ search }) => {
        if (typeof search !== 'string' || search.trim().length < 2 || search.length > 100) {
          throw Object.assign(new Error('Please provide at least two characters of a product name or SKU.'), { status: 400 });
        }
        const [rows] = await pool.query(
          `SELECT p.name, p.sku, s.name AS supplier_name
           FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
           WHERE p.name LIKE ? OR p.sku LIKE ?
           ORDER BY p.name LIMIT 20`,
          [`%${search.trim()}%`, `%${search.trim()}%`]
        );
        return { products: rows, truncated: rows.length === 20 };
      },
    },
    {
      name: 'get_dashboard_report',
      description: 'Read the existing management dashboard report: product totals, seven-month sales and purchases, low stock, top-selling products.',
      access: ROLE_ACCESS.management,
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
      run: async () => {
        const range = periodRange('last_7_months', clock());
        const [products] = await pool.query(
          `SELECT COUNT(*) AS total_products, COALESCE(SUM(current_stock), 0) AS total_units,
             COALESCE(SUM(current_stock = 0), 0) AS out_of_stock
           FROM products WHERE status = 'ACTIVE'`
        );
        const [sales] = await pool.query(
          `SELECT substr(created_at, 1, 7) AS month, SUM(final_amount) AS amount
           FROM sales WHERE created_at >= ? AND status <> 'RETURNED' GROUP BY month ORDER BY month`,
          [range.start]
        );
        const [purchases] = await pool.query(
          `SELECT substr(purchase_date, 1, 7) AS month, SUM(total_amount) AS amount
           FROM purchases WHERE purchase_date >= ? GROUP BY month ORDER BY month`,
          [range.start]
        );
        const [lowStock] = await pool.query(
          `SELECT sku, name, current_stock, min_stock_level FROM products
           WHERE status = 'ACTIVE' AND current_stock <= min_stock_level
           ORDER BY current_stock ASC LIMIT 10`
        );
        const [topSelling] = await pool.query(
          `SELECT p.name, SUM(si.quantity - si.returned_quantity) AS units_sold
           FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
           WHERE s.created_at >= ? AND s.status <> 'RETURNED'
           GROUP BY p.id, p.name HAVING units_sold > 0 ORDER BY units_sold DESC LIMIT 5`,
          [range.start]
        );
        return {
          products: products[0],
          sales_by_month: sales,
          purchases_by_month: purchases,
          low_stock: lowStock,
          top_selling: topSelling,
          currency: 'INR',
        };
      },
    },
  ];

  return {
    getTools(role) {
      return definitions.filter((item) => item.access.includes(role)).map(({ name, description, parameters }) => ({
        type: 'function', name, description, parameters, strict: true,
      }));
    },
    async execute(name, args, role) {
      const tool = definitions.find((item) => item.name === name);
      if (!tool) throw Object.assign(new Error('Requested business data function is not available.'), { status: 400 });
      if (!tool.access.includes(role)) {
        throw Object.assign(new Error('Your account role does not have permission to view that business information.'), { status: 403 });
      }
      if (!args || typeof args !== 'object' || Array.isArray(args)) {
        throw Object.assign(new Error('Invalid business data request.'), { status: 400 });
      }
      return tool.run(args, role);
    },
  };
}

module.exports = { createAiBusinessData, periodRange, ROLE_ACCESS };
