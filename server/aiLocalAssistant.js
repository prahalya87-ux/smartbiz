const UNKNOWN_ANSWER = "I couldn't identify that business question. Try asking about sales, inventory, purchases, profit, payments, returns, or SmartBiz features.";

const INTENT_REGISTRY = {
  help: /\b(help|what can i ask|suggestions|examples)\b/,
  dashboardReport: /\b(dashboard report|dashboard summary|business report|report summary|show dashboard)\b/,
  comparison: /\b(compare|comparison|versus|vs)\b/,
  forecast: /\b(predict|forecast|future|next 7 days|next 30 days|next month)\b/,
  outstanding: /\b(outstanding|unpaid|owes|owe us|customer payment|customer balance)\b/,
  supplier: /\b(suppliers?|vendors?)\b/,
  payment: /\b(payment|payments|paid|payment method|payment amount)\b/,
  returns: /\b(return|returns|refunded|refund|replacement)\b/,
  purchases: /\b(purchase|purchases|bought|buying|supplier order)\b/,
  customers: /\b(customer|customers|client|clients)\b/,
  productRevenue: /\b(products?|items?)\b.*\brevenue\b|\brevenue\b.*\b(products?|items?)\b/,
  topProducts: /\b(best selling|top selling|sell the most|selling the most|most sold|most units sold|top products|slow moving|not selling|sell the least|sold the least|selling least|highest number of units|rank all products)\b/,
  inventory: /\b(low stock|running low|out of stock|no stock|reorder|restock|replenish|reorder point|reorder level|below minimum|below their reorder|need replenishment|available stock|stock status|how much stock|stock quantity|units available|current stock|inventory|excess stock|negative stock|high stock)\b/,
  expiry: /\bexpir\w*\b/,
  sales: /\b(sales|revenue|gross profit|net profit|profit|turnover|how much (did|have) (i|we) sell|how much (have) (i|we) sold|average order value|average sale|completed sales|sales history|sales performance|sales increasing|sales decreasing|sales rising|sales falling|sales going up|sales going down|sales trend)\b/,
  followUp: /^(and |what about |how about |same for |only |show only |top |compare (with|against|to) )/,
};

const WEBSITE_KNOWLEDGE = [
  {
    match: /\b(what is|what does|tell me about|about) (smartbiz|this (app|website|system))\b|\bsmartbiz (app|website|system)\b/i,
    answer: 'SmartBiz is an inventory and sales management system for small shops. It helps organize product stock, track low-stock and expiry alerts, and review business records available in the app.',
  },
  {
    match: /\bhow (does|do) smartbiz (?:detect|calculate|determine|handle|set|use)\b.{0,50}\b(low stock|stock alert|reorder level|minimum stock)\b|\bhow are (the )?(low stock|stock alert|reorder level|minimum stock)\b/i,
    answer: 'SmartBiz compares each active product’s current stock with its minimum stock level. You can review low-stock products in Inventory; the assistant can also list matching records from the database.',
  },
  {
    match: /\bhow does smartbiz (?:store|track|handle|detect|manage)\b.{0,50}\b(expir|expired|expiry)\w*\b|\bwhat does smartbiz do about (product )?(expir|expired|expiry)\w*\b/i,
    answer: 'SmartBiz stores product expiry dates and shows expiry alerts for products that are expired or approaching expiry. Ask “Which products are expiring?” to check current product records.',
  },
  {
    match: /\b(what|which) (user )?roles\b|\bwho can (view|manage|access)\b/i,
    answer: 'SmartBiz has Admin, Manager, Cashier, and Staff roles. Access to management reports, purchase and supplier information, gross-profit figures, and customer or sales information depends on your role.',
  },
  {
    match: /\b(how does smartbiz manage|what is the) (product )?(categor|supplier)\w*\b/i,
    answer: 'SmartBiz organizes products into categories and stores supplier records. Admins and Managers can manage categories and suppliers; supplier details and purchasing information are restricted to management roles.',
  },
  {
    match: /\b(what kinds of|which) (smartbiz )?(notification|alert)\w*\b/i,
    answer: 'SmartBiz notifications cover stock and expiry conditions, including low stock, out of stock, expiring products, and expired products.',
  },
  {
    match: /\b(what is|explain) (smartbiz )?(gross profit|net profit)\b/i,
    answer: 'Gross profit is product margin based on recorded sale-item costs, returns, and invoice discounts. It excludes operating expenses and tax on income. Net profit cannot be calculated because operating expenses are not tracked.',
  },
  {
    match: /\b(how does (the |this )?(smartbiz )?(ai|assistant|chatbot) work|does (the |this )?(smartbiz )?(ai|assistant|chatbot) use|external ai|ai api key|offline assistant)\b/i,
    answer: 'This SmartBiz Assistant runs locally in the Express backend using JavaScript rules and approved database queries. It does not call an external AI provider or require an AI API key. It can answer supported questions, but it is not a trained language model and may ask you to rephrase unsupported questions.',
  },
  {
    match: /\b(how do i use|how to use|getting started|navigate|navigation|where can i find)\b/i,
    answer: 'Use the SmartBiz sidebar to open Dashboard, Products, Categories, Suppliers, Inventory, and Notifications. Dashboard, Categories, and Suppliers are limited to Admin and Manager roles; available actions on other pages also depend on your role.',
  },
  {
    match: /\b(add|create|edit|update|remove|delete) (a |the |new )?(product|item)\b/i,
    answer: 'Open Products from the sidebar to review the catalog. Product creation, editing, and deletion require an Admin or Manager account.',
  },
  {
    match: /\b(what is on|what does .* show|who can see|explain) (the )?(smartbiz )?(dashboard|reports?)\b/i,
    answer: 'The Dashboard is available to Admins and Managers and shows inventory totals, stock alerts, sales and purchase history, and top-selling summaries based on records in SmartBiz.',
  },
];

function normalizeQuestion(value) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectPeriod(question) {
  if (/\b(today|todays|this day)\b/.test(question)) return 'today';
  if (/\b(yesterday)\b/.test(question)) return 'yesterday';
  if (/\b(this week|week to date|current week)\b/.test(question)) return 'this_week';
  if (/\b(last week|previous week)\b/.test(question)) return 'last_week';
  if (/\b(this month|month to date|current month)\b/.test(question)) return 'this_month';
  if (/\b(last month|previous month)\b/.test(question)) return 'last_month';
  if (/\b(previous 30 days|prior 30 days)\b/.test(question)) return 'previous_30_days';
  if (/\b(last 90 days|past 90 days|past three months)\b/.test(question)) return 'last_90_days';
  if (/\b(last 7 days|past 7 days|past week)\b/.test(question)) return 'last_7_days';
  if (/\b(last 30 days|past 30 days|past month)\b/.test(question)) return 'last_30_days';
  if (/\b(last 7 months|past 7 months)\b/.test(question)) return 'last_7_months';
  if (/\b(all time|ever|overall|total)\b/.test(question)) return 'all_time';
  return null;
}

function extractProductSearch(question) {
  const match = question.match(/\b(?:sales|sold|selling|revenue|history)\s+(?:for|of|from)\s+(?:the\s+)?(?:product\s+)?(.+?)(?=\s+(?:today|yesterday|this week|last week|this month|last month|last \d+ days|past \d+ days|all time)\b|$)/);
  const search = match?.[1]?.trim();
  return search && !/^(most|least|top products|products|today|yesterday|this week|last week|this month|last month|last \d+ days|past \d+ days|all time)$/.test(search)
    ? search
    : '';
}

function comparisonPeriods(question, period) {
  if (/\b(this month|month to date|current month)\b/.test(question) && /\b(last month|previous month)\b/.test(question)) {
    return ['this_month', 'last_month'];
  }
  if (/\b(this week|week to date|current week)\b/.test(question) && /\b(last week|previous week)\b/.test(question)) {
    return ['this_week', 'last_week'];
  }
  if (/\b(last 30 days|past 30 days)\b/.test(question) && /\b(previous 30 days|prior 30 days)\b/.test(question)) {
    return ['last_30_days', 'previous_30_days'];
  }
  if (period === 'this_month' || period === 'last_month') return ['this_month', 'last_month'];
  if (period === 'this_week' || period === 'last_week') return ['this_week', 'last_week'];
  return null;
}

function classifyQuestion(rawQuestion, messages = []) {
  const question = normalizeQuestion(rawQuestion);
  const period = detectPeriod(question);

  if (INTENT_REGISTRY.help.test(question)) {
    return { type: 'help' };
  }
  if (INTENT_REGISTRY.dashboardReport.test(question)) {
    return { type: 'dashboard_report' };
  }

  const priorUserQuestions = messages
    .filter((message) => message.role === 'user')
    .slice(0, -1)
    .reverse();
  const previousQuestion = priorUserQuestions[0] ? normalizeQuestion(priorUserQuestions[0].content) : '';

  const followUp = INTENT_REGISTRY.followUp.test(question);
  if (INTENT_REGISTRY.comparison.test(question)) {
    let periods = comparisonPeriods(question, period);
    if (!periods && followUp) {
      const previousPeriod = detectPeriod(previousQuestion);
      if (previousPeriod === 'last_30_days' && /\b(previous 30 days|prior 30 days)\b/.test(question)) {
        periods = ['last_30_days', 'previous_30_days'];
      } else if (previousPeriod === 'this_month' && /\b(previous month|last month)\b/.test(question)) {
        periods = ['this_month', 'last_month'];
      } else if (previousPeriod === 'this_week' && /\b(previous week|last week)\b/.test(question)) {
        periods = ['this_week', 'last_week'];
      }
    }
    return periods
      ? { type: 'sales_comparison', currentPeriod: periods[0], comparisonPeriod: periods[1] }
      : { type: 'unsupported', reason: 'Please specify two supported periods, such as “compare this month with last month” or “compare this week with last week”.' };
  }
  if (INTENT_REGISTRY.forecast.test(question)) {
    return { type: 'unsupported', reason: 'Sales forecasting is not available in this local assistant yet. I can summarize recorded sales instead.' };
  }
  if (/\b(pending payment|pending payments|payment inconsisten|duplicate purchase|purchase order|incoming stock|stock movement|stock by category|stock by supplier|inventory valuation|excess stock|negative stock|may run out|run out soon|high sales but low stock|high stock but low sales|returned most|most returned|unusual return|supplier provides|supplier wise|supplier-wise|supplier.*most purchases|category generates|category level revenue|category level profit|profit margin|profit trend|net profit|most profitable|products?.*profit|not sold recently|not sold|never sold|customer purchase history|customer order history|recent customer orders|becoming popular|growing popular|declining sales|sales fell|sales dropped|which day had the highest sales|highest sales day|compare two products|compare products)\b/.test(question)) {
    return { type: 'unsupported', reason: 'That question needs a detailed order, movement, category, or financial analysis that is not available in the current approved SmartBiz assistant queries. I will not estimate it from incomplete data.' };
  }

  if (INTENT_REGISTRY.outstanding.test(question)) {
    if (INTENT_REGISTRY.supplier.test(question) || /\bpurchases?\b/.test(question)) return { type: 'supplier_balances' };
    return { type: 'customer_balances' };
  }
  if (INTENT_REGISTRY.supplier.test(question) && /\b(balance|owe|pay|unpaid|outstanding)\b/.test(question)) {
    return { type: 'supplier_balances' };
  }
  if (INTENT_REGISTRY.payment.test(question)) {
    if (INTENT_REGISTRY.supplier.test(question) || INTENT_REGISTRY.purchases.test(question) || /\b(we paid|paid to)\b/.test(question)) {
      return { type: 'payments', period: period || 'this_month', paymentType: 'purchases' };
    }
    return { type: 'payments', period: period || 'this_month', paymentType: 'sales' };
  }
  if (INTENT_REGISTRY.returns.test(question)) {
    return { type: 'returns', period: period || 'this_month' };
  }
  if (INTENT_REGISTRY.purchases.test(question)) {
    return { type: 'purchases', period: period || 'this_month' };
  }
  if (/\b(who supplies|supplier for|supplier of|vendor for|vendor of)\b/.test(question)) {
    const search = question.replace(/^.*?\b(?:who supplies|supplier for|supplier of|vendor for|vendor of)\s+/, '').trim();
    return search ? { type: 'product_supplier', search } : null;
  }
  if (INTENT_REGISTRY.customers.test(question) && /\b(how many|number of|count)\b/.test(question)) {
    return { type: 'directory', entity: 'customers', search: '', countOnly: true };
  }
  if (INTENT_REGISTRY.supplier.test(question)) {
    return { type: 'directory', entity: 'suppliers', search: '' };
  }
  if (INTENT_REGISTRY.customers.test(question)) {
    return { type: 'directory', entity: 'customers', search: '' };
  }
  const productSearch = extractProductSearch(question)
    || (followUp && extractProductSearch(previousQuestion));
  if (productSearch && /\b(sales|sold|selling|revenue|history)\b/.test(question + ' ' + previousQuestion)) {
    return { type: 'product_sales', search: productSearch, period: period || (followUp ? detectPeriod(previousQuestion) : null) || 'all_time' };
  }
  if (INTENT_REGISTRY.productRevenue.test(question)) {
    return {
      type: 'top_products_revenue',
      period: period || 'all_time',
      limit: Math.min(Number(question.match(/\btop\s+(\d{1,2})\b/)?.[1] || question.match(/\btop\s+(five|ten)\b/)?.[1]?.replace('five', '5').replace('ten', '10') || 10), 10),
    };
  }
  if (INTENT_REGISTRY.topProducts.test(question)) {
    return {
      type: 'top_products',
      period: period || 'all_time',
      direction: /\b(slow moving|not selling|sold the least|selling least|least|low sales)\b/.test(question) ? 'ascending' : 'descending',
      limit: Math.min(Number(question.match(/\btop\s+(\d{1,2})\b/)?.[1] || question.match(/\btop\s+(five|ten)\b/)?.[1]?.replace('five', '5').replace('ten', '10') || 5), 10),
    };
  }
  if (INTENT_REGISTRY.inventory.test(question)) {
    return {
      type: 'inventory',
      lowStockOnly: /\b(low stock|running low|reorder|restock|replenish)\b/.test(question),
      outOfStockOnly: /\b(out of stock|no stock)\b/.test(question),
      expiryStatus: 'any',
    };
  }
  if (INTENT_REGISTRY.expiry.test(question)) {
    return { type: 'inventory', lowStockOnly: false, outOfStockOnly: false, expiryStatus: /\b(expired|already expired)\b/.test(question) ? 'expired' : 'expiring' };
  }
  if (INTENT_REGISTRY.sales.test(question)) {
    if (/\b(profit trend|profit margin|net profit|most profitable|profitable categories)\b/.test(question)) {
      return { type: 'unsupported', reason: 'This assistant cannot calculate profit trends, profit margins, net profit, or category-level profitability from the available approved business-data queries.' };
    }
    if (/\b(sales increasing|sales decreasing|sales rising|sales falling|sales going up|sales going down|sales trend)\b/.test(question)) {
      const periods = comparisonPeriods(question, period || 'this_month');
      return { type: 'sales_comparison', currentPeriod: periods[0], comparisonPeriod: periods[1] };
    }
    if (/\b(average order value|average sale)\b/.test(question)) {
      return { type: 'sales', period: period || 'this_month', metric: 'average_order_value' };
    }
    return { type: 'sales', period: period || (/\b(sales history|sales records|all sales)\b/.test(question) ? 'all_time' : 'this_month') };
  }

  const normalizedPrevious = previousQuestion;
  if (followUp && period && INTENT_REGISTRY.sales.test(normalizedPrevious)) {
    const priorProduct = extractProductSearch(normalizedPrevious);
    return priorProduct
      ? { type: 'product_sales', search: priorProduct, period }
      : { type: 'sales', period };
  }
  if (followUp && /\b(low stock|inventory|stock|reorder)\b/.test(normalizedPrevious)) {
    return {
      type: 'inventory',
      lowStockOnly: /\b(low stock|running low|reorder)\b/.test(normalizedPrevious),
      outOfStockOnly: /\b(out of stock|no stock)\b/.test(normalizedPrevious),
      expiryStatus: 'any',
    };
  }
  if (followUp && /\b(best selling|top selling|selling the most|most sold|top products|highest number of units|rank all products)\b/.test(normalizedPrevious)) {
    return {
      type: 'top_products',
      period: detectPeriod(normalizedPrevious) || 'all_time',
      direction: 'descending',
      limit: Math.min(Number(question.match(/\b(\d{1,2})\b/)?.[1] || 5), 10),
    };
  }
  if (followUp && INTENT_REGISTRY.productRevenue.test(normalizedPrevious)) {
    return {
      type: 'top_products_revenue',
      period: detectPeriod(normalizedPrevious) || 'all_time',
      limit: Math.min(Number(question.match(/\b(\d{1,2})\b/)?.[1] || 10), 10),
    };
  }

  return null;
}

const formatMoney = (value) => `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function formatResult(intent, result) {
  if (intent.type === 'inventory') {
    if (!result.products.length) return intent.expiryStatus !== 'any'
      ? `There are no ${intent.expiryStatus === 'expired' ? 'expired' : 'products expiring within 30 days'} active products in the records.`
      : intent.outOfStockOnly ? 'There are no active products with zero stock.'
        : intent.lowStockOnly ? 'There are no active products at or below their minimum stock level.' : 'No active products were found.';
    const intro = intent.expiryStatus !== 'any'
      ? `Products ${intent.expiryStatus === 'expired' ? 'already expired' : 'expiring within 30 days'}:`
      : intent.outOfStockOnly ? 'Products with zero stock:'
        : intent.lowStockOnly ? 'Products at or below their minimum stock level:' : 'Current product stock:';
    const rows = result.products.map((product) =>
      `• ${product.name} (${product.sku}): ${product.current_stock} available; minimum ${product.min_stock_level}${intent.lowStockOnly ? `; reorder quantity ${product.reorder_quantity}` : ''}${product.expiry_date ? `; expiry ${product.expiry_date}` : ''}`
    );
    const reorderNote = intent.lowStockOnly
      ? '\nThis list uses the configured minimum-stock threshold only; it does not account for incoming purchase orders or forecast demand.'
      : '';
    return `${intro}\n${rows.join('\n')}${result.truncated ? '\nShowing the first 50 products.' : ''}${reorderNote}`;
  }
  if (intent.type === 'sales') {
    const periodLabel = intent.period.replaceAll('_', ' ');
    if (intent.metric === 'average_order_value') {
      return result.average_order_value_including_tax === null
        ? `There are no completed or partially returned sales in ${periodLabel}, so average order value cannot be calculated.`
        : `Average order value (${periodLabel}): ${formatMoney(result.average_order_value_including_tax)} per sale, based on ${result.sale_count} completed or partially returned sale(s). This uses recorded billed totals including tax.`;
    }
    const lines = [
      `Sales summary (${periodLabel}): ${result.sale_count} completed or partially returned sale(s).`,
      `Billed sales including tax: ${formatMoney(result.billed_sales_value_including_tax)}.`,
      `Recorded payments received: ${formatMoney(result.amount_paid)}.`,
    ];
    if (result.net_merchandise_revenue_excluding_tax === null) {
      lines.push(`Net merchandise revenue and gross profit are unavailable: ${result.data_limitation}`);
    } else {
      lines.push(`Net merchandise revenue excluding tax: ${formatMoney(result.net_merchandise_revenue_excluding_tax)}.`);
    }
    if (result.gross_profit !== undefined) {
      lines.push(result.gross_profit === null
        ? 'Gross profit cannot be fully calculated because some sales are missing item details.'
        : `Gross profit: ${formatMoney(result.gross_profit)}. This is product margin, not net profit; it excludes operating expenses and income tax.`);
    }
    return lines.join('\n');
  }
  if (intent.type === 'top_products' || intent.type === 'top_products_revenue') {
    if (!result.products.length) return 'There are no matching product sales in the selected period.';
    return `Products ranked by ${intent.type === 'top_products_revenue' ? 'net revenue' : `${intent.direction === 'ascending' ? 'lowest' : 'highest'} units sold`} (${intent.period.replaceAll('_', ' ')}):\n${
      result.products.map((product, index) => `${index + 1}. ${product.name}: ${product.units_sold} unit(s), ${formatMoney(product.net_revenue_excluding_tax)} net revenue`).join('\n')
    }${result.sales_missing_item_details ? `\n${result.sales_missing_item_details} sale(s) have no item details, so this ranking may be incomplete.` : ''}`;
  }
  if (intent.type === 'sales_comparison') {
    const currentLabel = intent.currentPeriod.replaceAll('_', ' ');
    const comparisonLabel = intent.comparisonPeriod.replaceAll('_', ' ');
    const changeText = result.change_percent === null
      ? 'percentage change is unavailable because the comparison period has no recorded sales value'
      : `${Math.abs(result.change_percent).toFixed(1)}% ${result.change_percent > 0 ? 'increase' : result.change_percent < 0 ? 'decrease' : 'no change'}`;
    return `Sales comparison using billed values including tax: ${currentLabel} had ${result.current.sale_count} sale(s) totaling ${formatMoney(result.current.billed_sales_value_including_tax)}; ${comparisonLabel} had ${result.comparison.sale_count} sale(s) totaling ${formatMoney(result.comparison.billed_sales_value_including_tax)}. Difference: ${formatMoney(result.change_amount)} (${changeText}).`;
  }
  if (intent.type === 'product_sales') {
    if (!result.products.length) return `I couldn't find a product matching “${intent.search}”. Please check the product name or SKU and try again.`;
    if (result.products.length > 1) {
      return `I found multiple matching products: ${result.products.slice(0, 10).map((product) => `${product.name} (${product.sku})`).join(', ')}. Which one do you mean?`;
    }
    const product = result.products[0];
    return product.units_sold
      ? `${product.name} sales (${intent.period.replaceAll('_', ' ')}): ${product.units_sold} unit(s) sold and ${formatMoney(product.net_revenue_excluding_tax)} net revenue excluding tax and proportional invoice discounts.`
      : `I found ${product.name}, but there are no recorded sales for it in ${intent.period.replaceAll('_', ' ')}.`;
  }
  if (intent.type === 'customer_balances') {
    if (!result.customers.length && !result.unlinked_outstanding_sales) return 'There are no recorded outstanding customer balances.';
    const lines = result.customers.map((customer) => `• ${customer.name}: ${formatMoney(customer.outstanding_amount)} across ${customer.outstanding_sales} sale(s)`);
    if (result.unlinked_outstanding_sales) lines.push(`${result.unlinked_outstanding_sales} outstanding sale(s) worth ${formatMoney(result.unlinked_outstanding_amount)} have no linked customer record.`);
    return `Outstanding customer balances:\n${lines.join('\n')}`;
  }
  if (intent.type === 'supplier_balances') {
    return result.suppliers.length
      ? `Outstanding supplier balances:\n${result.suppliers.map((supplier) => `• ${supplier.name}: ${formatMoney(supplier.outstanding_amount)} across ${supplier.outstanding_purchases} purchase(s)`).join('\n')}`
      : 'There are no recorded outstanding supplier balances.';
  }
  if (intent.type === 'purchases') {
    return `Purchase summary (${intent.period.replaceAll('_', ' ')}): ${result.purchase_count} purchase(s), total value ${formatMoney(result.total_purchase_value)}, recorded paid amount ${formatMoney(result.amount_paid)}, and outstanding amount ${formatMoney(result.outstanding_amount)}.${
      result.purchases_missing_item_details ? ` ${result.purchases_missing_item_details} purchase(s) have no item details, so product-level purchase totals may be incomplete.` : ''
    }`;
  }
  if (intent.type === 'returns') {
    return `Returns (${intent.period.replaceAll('_', ' ')}): ${result.return_count} recorded return(s), ${result.returned_units ?? 'unknown'} returned unit(s), and ${formatMoney(result.refunds)} in refunds.${
      result.returns_missing_item_details ? ` ${result.returns_missing_item_details} return(s) have no item details.` : ''
    }`;
  }
  if (intent.type === 'payments') {
    return result.payments.length
      ? `Recorded ${intent.paymentType} payments (${intent.period.replaceAll('_', ' ')}):\n${result.payments.map((payment) => `• ${payment.method}: ${formatMoney(payment.payment_amount)} across ${payment.payment_count} payment(s)`).join('\n')}`
      : `There are no recorded ${intent.paymentType} payments for ${intent.period.replaceAll('_', ' ')}.`;
  }
  if (intent.type === 'directory') {
    if (intent.countOnly) {
      return `${result.total_count} customer(s) are recorded in SmartBiz.`;
    }
    return result.names.length
      ? `${intent.entity === 'customers' ? 'Customers' : 'Suppliers'} on record:\n${result.names.map((name) => `• ${name}`).join('\n')}${result.truncated ? '\nShowing the first 20 names.' : ''}`
      : `There are no ${intent.entity} on record.`;
  }
  if (intent.type === 'product_supplier') {
    if (!result.products.length) return `I couldn't find a product matching “${intent.search}”. Please check the product name or SKU and try again.`;
    if (result.products.length > 1) {
      return `I found multiple matching products: ${result.products.map((product) => `${product.name} (${product.sku})`).join(', ')}. Which one do you mean?`;
    }
    const product = result.products[0];
    return product.supplier_name
      ? `${product.name} is supplied by ${product.supplier_name}.`
      : `${product.name} has no supplier assigned in the database.`;
  }
  if (intent.type === 'dashboard_report') {
    const lines = [
      `Dashboard report: ${result.products.total_products} active product(s), ${result.products.total_units} unit(s) in stock, and ${result.products.out_of_stock} out of stock.`,
      `Billed sales by month (including tax): ${result.sales_by_month.length
        ? result.sales_by_month.map(({ month, amount }) => `${month} ${formatMoney(amount)}`).join('; ')
        : 'no recorded sales in the report period'}.`,
      `Purchases by month: ${result.purchases_by_month.length
        ? result.purchases_by_month.map(({ month, amount }) => `${month} ${formatMoney(amount)}`).join('; ')
        : 'no recorded purchases in the report period'}.`,
      `Top-selling products by units: ${result.top_selling.length
        ? result.top_selling.map(({ name, units_sold }) => `${name} (${units_sold})`).join(', ')
        : 'no recorded product sales in the report period'}.`,
    ];
    if (result.low_stock.length) {
      lines.push(`Low-stock products: ${result.low_stock.map(({ name, current_stock, min_stock_level }) => `${name} (${current_stock} available; minimum ${min_stock_level})`).join(', ')}.`);
    } else {
      lines.push('There are no products at or below their minimum stock level.');
    }
    return lines.join('\n');
  }
  return UNKNOWN_ANSWER;
}

async function answerLocalQuestion({ messages, role, businessData }) {
  const lastMessage = messages[messages.length - 1];
  const rawQuestion = lastMessage.content;
  const normalized = normalizeQuestion(rawQuestion);

  for (const entry of WEBSITE_KNOWLEDGE) {
    if (entry.match.test(normalized)) return entry.answer;
  }

  if (/\b(help|what can i ask|suggestions|examples)\b/.test(normalized)) {
    return 'You can ask about current, low, or out-of-stock products; expiry dates; sales totals, average order value, and supported period comparisons; product unit or revenue rankings; purchases, customer balances, payments, returns, or SmartBiz features. Available questions depend on your account role.';
  }

  const intent = classifyQuestion(rawQuestion, messages);
  if (!intent) return UNKNOWN_ANSWER;
  if (intent.type === 'unsupported') return intent.reason;
  if (intent.type === 'sales' && /\b(gross profit|net profit)\b/.test(normalized)
    && !ROLE_ACCESS.management.includes(role)) {
    throw Object.assign(new Error('Your account role does not have permission to view profit information.'), { status: 403 });
  }
  if (intent.type === 'dashboard_report' && !ROLE_ACCESS.management.includes(role)) {
    throw Object.assign(new Error('Your account role does not have permission to view the management dashboard report.'), { status: 403 });
  }

  const call = async (name, args) => businessData.execute(name, args, role);
  let result;
  switch (intent.type) {
    case 'inventory':
      result = await call('get_inventory', {
        low_stock_only: intent.lowStockOnly,
        out_of_stock_only: intent.outOfStockOnly || false,
        search: '',
        expiry_status: intent.expiryStatus,
      });
      break;
    case 'sales':
      result = await call('get_sales_summary', { period: intent.period });
      break;
    case 'top_products_revenue':
      result = await call('get_top_products_by_revenue', { period: intent.period, limit: intent.limit || 10 });
      break;
    case 'sales_comparison':
      result = await call('get_sales_comparison', {
        current_period: intent.currentPeriod,
        comparison_period: intent.comparisonPeriod,
      });
      break;
    case 'product_sales':
      result = await call('get_product_sales_summary', { search: intent.search, period: intent.period });
      break;
    case 'top_products': {
      result = await call('get_top_products_by_units', {
        period: intent.period,
        direction: intent.direction,
        limit: intent.limit,
      });
      break;
    }
    case 'customer_balances':
      result = await call('get_customer_balances', { search: '' });
      break;
    case 'supplier_balances':
      result = await call('get_supplier_balances', { search: '' });
      break;
    case 'purchases':
      result = await call('get_purchase_summary', { period: intent.period });
      break;
    case 'returns':
      result = await call('get_returns_summary', { period: intent.period });
      break;
    case 'payments':
      result = await call('get_payment_summary', { period: intent.period, payment_type: intent.paymentType });
      break;
    case 'directory':
      result = await call('get_directory', { entity: intent.entity, search: '' });
      break;
    case 'product_supplier':
      result = await call('get_product_supplier', { search: intent.search });
      break;
    case 'dashboard_report':
      result = await call('get_dashboard_report', {});
      break;
    default:
      return UNKNOWN_ANSWER;
  }
  return formatResult(intent, result);
}

module.exports = { answerLocalQuestion, classifyQuestion, normalizeQuestion, UNKNOWN_ANSWER, INTENT_REGISTRY, detectPeriod };
const { ROLE_ACCESS } = require('./aiBusinessData');
