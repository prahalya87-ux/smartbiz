const { randomUUID } = require('node:crypto');

const TENANT_TABLES = [
  'categories',
  'suppliers',
  'customers',
  'products',
  'purchases',
  'sales',
  'stock_transactions',
  'notifications',
  'audit_logs',
];

const quoteIdentifier = (identifier) => `\`${identifier}\``;
const quoteSqliteIdentifier = (identifier) => `"${identifier.replace(/"/g, '""')}"`;

const SHOP_UNIQUES = [
  { table: 'categories', global: ['name'], scoped: ['shop_id', 'name'], name: 'uq_categories_shop_name' },
  { table: 'suppliers', global: ['email'], scoped: ['shop_id', 'email'], name: 'uq_suppliers_shop_email' },
  { table: 'customers', global: ['email'], scoped: ['shop_id', 'email'], name: 'uq_customers_shop_email' },
  { table: 'products', global: ['sku'], scoped: ['shop_id', 'sku'], name: 'uq_products_shop_sku' },
  { table: 'products', global: ['barcode'], scoped: ['shop_id', 'barcode'], name: 'uq_products_shop_barcode' },
  { table: 'purchases', global: ['invoice_number'], scoped: ['shop_id', 'invoice_number'], name: 'uq_purchases_shop_invoice' },
  { table: 'sales', global: ['invoice_number'], scoped: ['shop_id', 'invoice_number'], name: 'uq_sales_shop_invoice' },
];

const SQLITE_TABLES = {
  categories: `CREATE TABLE categories_tenant_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT, shop_id TEXT REFERENCES shops(id),
    name TEXT NOT NULL, description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`,
  suppliers: `CREATE TABLE suppliers_tenant_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT, shop_id TEXT REFERENCES shops(id),
    name TEXT NOT NULL, company_name TEXT, phone TEXT NOT NULL, email TEXT,
    address TEXT, tax_number TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`,
  customers: `CREATE TABLE customers_tenant_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT, shop_id TEXT REFERENCES shops(id),
    name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT, address TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`,
  products: `CREATE TABLE products_tenant_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT, shop_id TEXT REFERENCES shops(id),
    name TEXT NOT NULL, sku TEXT NOT NULL, barcode TEXT,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    brand TEXT, description TEXT, image_path TEXT,
    purchase_price NUMERIC NOT NULL CHECK (purchase_price >= 0),
    selling_price NUMERIC NOT NULL CHECK (selling_price >= 0),
    tax_percentage NUMERIC NOT NULL DEFAULT 0 CHECK (tax_percentage BETWEEN 0 AND 100),
    current_stock INTEGER NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
    min_stock_level INTEGER NOT NULL DEFAULT 5 CHECK (min_stock_level >= 0),
    reorder_quantity INTEGER NOT NULL DEFAULT 10, expiry_date TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`,
  purchases: `CREATE TABLE purchases_tenant_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT, shop_id TEXT REFERENCES shops(id),
    invoice_number TEXT NOT NULL, supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    created_by INTEGER NOT NULL REFERENCES users(id), purchase_date TEXT NOT NULL,
    subtotal NUMERIC NOT NULL DEFAULT 0, tax_amount NUMERIC NOT NULL DEFAULT 0,
    discount NUMERIC NOT NULL DEFAULT 0, total_amount NUMERIC NOT NULL DEFAULT 0,
    amount_paid NUMERIC NOT NULL DEFAULT 0,
    payment_status TEXT NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN ('PAID','PARTIAL','UNPAID')),
    notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`,
  sales: `CREATE TABLE sales_tenant_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT, shop_id TEXT REFERENCES shops(id),
    invoice_number TEXT NOT NULL, customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    cashier_id INTEGER NOT NULL REFERENCES users(id), subtotal NUMERIC NOT NULL,
    tax_amount NUMERIC NOT NULL DEFAULT 0, discount NUMERIC NOT NULL DEFAULT 0,
    final_amount NUMERIC NOT NULL, amount_paid NUMERIC NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL DEFAULT 'CASH' CHECK (payment_method IN ('CASH','CARD','UPI','OTHER')),
    payment_status TEXT NOT NULL DEFAULT 'PAID' CHECK (payment_status IN ('PAID','PARTIAL','UNPAID')),
    status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED','PARTIALLY_RETURNED','RETURNED')),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`,
};

const SQLITE_INDEXES = [
  ['categories', 'idx_categories_shop', 'shop_id'],
  ['suppliers', 'idx_suppliers_shop', 'shop_id'],
  ['suppliers', 'idx_suppliers_name', 'name'],
  ['customers', 'idx_customers_shop', 'shop_id'],
  ['customers', 'idx_customers_name', 'name'],
  ['customers', 'idx_customers_phone', 'phone'],
  ['products', 'idx_products_shop', 'shop_id'],
  ['products', 'idx_products_name', 'name'],
  ['products', 'idx_products_expiry', 'expiry_date'],
  ['purchases', 'idx_purchases_shop', 'shop_id'],
  ['purchases', 'idx_purchases_date', 'purchase_date'],
  ['sales', 'idx_sales_shop', 'shop_id'],
  ['sales', 'idx_sales_date', 'created_at'],
];

async function tableColumns(query, table, useMysql) {
  const [rows] = await query(
    useMysql ? `SHOW COLUMNS FROM ${quoteIdentifier(table)}` : `PRAGMA table_info(${quoteIdentifier(table)})`
  );
  return new Set(rows.map((row) => useMysql ? row.Field : row.name));
}

async function createLegacyShop(query, useMysql) {
  const id = randomUUID();
  const shop = {
    id,
    code: 'SBZ-LEGACY',
    name: 'Existing SmartBiz Shop',
    type: 'Other',
    address: 'Address not provided',
    country: 'Unknown',
    state: 'Unknown',
    city: 'Unknown',
    area: 'Unknown',
    pincode: 'Unknown',
  };
  await query(
    `INSERT INTO shops (id, shop_code, shop_name, shop_type, address, country, state, city, area, pincode)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [shop.id, shop.code, shop.name, shop.type, shop.address, shop.country, shop.state, shop.city, shop.area, shop.pincode]
  );

  const [[owner]] = await query(
    `SELECT id FROM users WHERE role_id = (SELECT id FROM roles WHERE name = 'ADMIN') ORDER BY id LIMIT 1`
  );
  if (owner) await query('UPDATE shops SET owner_id = ? WHERE id = ?', [owner.id, shop.id]);

  await query(
    `INSERT INTO shop_members (user_id, shop_id, role)
     SELECT u.id, ?, r.name FROM users u JOIN roles r ON r.id = u.role_id
     WHERE NOT EXISTS (SELECT 1 FROM shop_members sm WHERE sm.user_id = u.id AND sm.shop_id = ?)`,
    [shop.id, shop.id]
  );

  for (const table of TENANT_TABLES) {
    await query(`UPDATE ${quoteIdentifier(table)} SET shop_id = ? WHERE shop_id IS NULL`, [shop.id]);
  }
}

async function sqliteUniqueIndexes(query, table) {
  const [indexes] = await query(`PRAGMA index_list(${quoteSqliteIdentifier(table)})`);
  const result = [];
  for (const index of indexes) {
    if (!index.unique) continue;
    const [columns] = await query(`PRAGMA index_info(${quoteSqliteIdentifier(index.name)})`);
    result.push(columns.map((column) => column.name));
  }
  return result;
}

async function migrateSqliteShopUniques(query) {
  await query('PRAGMA foreign_keys = OFF');
  let inTransaction = false;
  try {
    await query('BEGIN IMMEDIATE');
    inTransaction = true;
    for (const unique of SHOP_UNIQUES) {
      const indexes = await sqliteUniqueIndexes(query, unique.table);
      const globalConstraintExists = unique.global.some((column) =>
        indexes.some((index) => index.length === 1 && index[0] === column));
      const scopedConstraintExists = indexes.some((index) =>
        index.length === unique.scoped.length
        && unique.scoped.every((column) => index.includes(column)));
      if (globalConstraintExists) {
        await query(SQLITE_TABLES[unique.table]);
        await query(`INSERT INTO ${quoteSqliteIdentifier(`${unique.table}_tenant_new`)}
          SELECT * FROM ${quoteSqliteIdentifier(unique.table)}`);
        await query(`DROP TABLE ${quoteSqliteIdentifier(unique.table)}`);
        await query(`ALTER TABLE ${quoteSqliteIdentifier(`${unique.table}_tenant_new`)}
          RENAME TO ${quoteSqliteIdentifier(unique.table)}`);
      }
      if (globalConstraintExists || !scopedConstraintExists) {
        const indexName = unique.name || `uq_${unique.table}_shop_${unique.global[0]}`;
        await query(
          `CREATE UNIQUE INDEX IF NOT EXISTS ${quoteSqliteIdentifier(indexName)}
           ON ${quoteSqliteIdentifier(unique.table)} (${unique.scoped.map(quoteSqliteIdentifier).join(', ')})`
        );
      }
    }
    for (const [table, index, column] of SQLITE_INDEXES) {
      await query(
        `CREATE INDEX IF NOT EXISTS ${quoteSqliteIdentifier(index)}
         ON ${quoteSqliteIdentifier(table)} (${quoteSqliteIdentifier(column)})`
      );
    }
    await query('COMMIT');
    inTransaction = false;
  } catch (error) {
    if (inTransaction) await query('ROLLBACK');
    throw error;
  } finally {
    await query('PRAGMA foreign_keys = ON');
  }
}

async function migrateMysqlShopUniques(query) {
  for (const unique of SHOP_UNIQUES) {
    const [rows] = await query(`SHOW INDEX FROM ${quoteIdentifier(unique.table)}`);
    const indexes = new Map();
    for (const row of rows) {
      if (!indexes.has(row.Key_name)) indexes.set(row.Key_name, []);
      indexes.get(row.Key_name).push(row);
    }
    const globalIndex = [...indexes.entries()].find(([, entries]) =>
      Number(entries[0].Non_unique) === 0
      && entries.length === 1
      && unique.global.includes(entries[0].Column_name));
    if (globalIndex) await query(`ALTER TABLE ${quoteIdentifier(unique.table)} DROP INDEX ${quoteIdentifier(globalIndex[0])}`);

    const scopedExists = [...indexes.values()].some((entries) =>
      Number(entries[0].Non_unique) === 0
      && entries.length === unique.scoped.length
      && unique.scoped.every((column) => entries.some((entry) => entry.Column_name === column)));
    if (!scopedExists) {
      const indexName = unique.name || `uq_${unique.table}_shop_${unique.global[0]}`;
      await query(
        `ALTER TABLE ${quoteIdentifier(unique.table)} ADD UNIQUE KEY ${quoteIdentifier(indexName)}
         (${unique.scoped.map(quoteIdentifier).join(', ')})`
      );
    }
  }
}

async function ensureTenantSchema(query, useMysql) {
  const userColumns = await tableColumns(query, 'users', useMysql);
  if (!userColumns.has('phone')) {
    await query(`ALTER TABLE users ADD COLUMN phone ${useMysql ? 'VARCHAR(20)' : 'TEXT'}`);
  }

  for (const table of TENANT_TABLES) {
    const columns = await tableColumns(query, table, useMysql);
    if (!columns.has('shop_id')) {
      await query(`ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN shop_id ${useMysql ? 'CHAR(36)' : 'TEXT REFERENCES shops(id)'}`);
    }

    const indexName = `idx_${table}_shop`;
    if (useMysql) {
      const [indexes] = await query(`SHOW INDEX FROM ${quoteIdentifier(table)} WHERE Key_name = ?`, [indexName]);
      if (!indexes.length) await query(`CREATE INDEX ${quoteIdentifier(indexName)} ON ${quoteIdentifier(table)} (shop_id)`);
      const constraintName = `fk_${table}_shop`;
      const [constraints] = await query(
        `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
        [table, constraintName]
      );
      if (!constraints.length) {
        await query(
          `ALTER TABLE ${quoteIdentifier(table)} ADD CONSTRAINT ${quoteIdentifier(constraintName)}
           FOREIGN KEY (shop_id) REFERENCES shops(id)`
        );
      }
    } else {
      await query(`CREATE INDEX IF NOT EXISTS ${quoteIdentifier(indexName)} ON ${quoteIdentifier(table)} (shop_id)`);
    }
  }

  if (useMysql) await migrateMysqlShopUniques(query);
  else await migrateSqliteShopUniques(query);

  const [[{ shopCount }]] = await query('SELECT COUNT(*) AS shopCount FROM shops');
  if (Number(shopCount) === 0) {
    const [[{ userCount }]] = await query('SELECT COUNT(*) AS userCount FROM users');
    if (Number(userCount) > 0) {
      await createLegacyShop(query, useMysql);
    } else {
      const [[{ unassignedRecords }]] = await query(
        `SELECT ${TENANT_TABLES.map((table) => `(SELECT COUNT(*) FROM ${quoteIdentifier(table)} WHERE shop_id IS NULL)`).join(' + ')} AS unassignedRecords`
      );
      if (Number(unassignedRecords) > 0) {
        throw new Error('Existing business records have no shop or owner. Assign them before starting SmartBiz.');
      }
    }
    return;
  }

  const [[{ unassignedUsers }]] = await query(
    `SELECT COUNT(*) AS unassignedUsers FROM users u
     WHERE NOT EXISTS (SELECT 1 FROM shop_members sm WHERE sm.user_id = u.id AND sm.status = 'ACTIVE')`
  );
  if (Number(unassignedUsers) > 0) {
    throw new Error('Some existing users have no active shop membership. Assign them to a shop before starting SmartBiz.');
  }

  const [[{ unassignedRecords }]] = await query(
    `SELECT ${TENANT_TABLES.map((table) => `(SELECT COUNT(*) FROM ${quoteIdentifier(table)} WHERE shop_id IS NULL)`).join(' + ')} AS unassignedRecords`
  );
  if (Number(unassignedRecords) > 0) {
    throw new Error('Some existing business records have no shop assignment. Resolve their shop ownership before starting SmartBiz.');
  }
}

module.exports = { ensureTenantSchema };
