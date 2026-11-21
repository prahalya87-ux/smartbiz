const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { describe, it } = require('node:test');
const { ensureTenantSchema } = require('./tenantSchema');

function createSqliteQuery(db) {
  return async (sql, params = []) => {
    const statement = db.prepare(sql);
    if (/^\s*(SELECT|PRAGMA)\b/i.test(sql)) return [statement.all(...params), undefined];
    const result = statement.run(...params);
    return [{ insertId: Number(result.lastInsertRowid), affectedRows: Number(result.changes) }, undefined];
  };
}

function createDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sqlite.sql'), 'utf8'));
  return { db, query: createSqliteQuery(db) };
}

describe('shop schema migration', () => {
  it('creates a legacy shop and memberships for existing users and scopes legacy records', async () => {
    const { db, query } = createDatabase();
    db.prepare(
      `INSERT INTO users (name, email, password_hash, role_id) VALUES (?, ?, ?, ?)`
    ).run('Legacy Owner', 'owner@example.test', 'hash', 1);
    db.prepare('INSERT INTO categories (name) VALUES (?)').run('Groceries');

    await ensureTenantSchema(query, false);

    const shop = db.prepare('SELECT id, shop_code, owner_id FROM shops').get();
    assert.match(shop.id, /^[0-9a-f-]{36}$/i);
    assert.equal(shop.shop_code, 'SBZ-LEGACY');
    assert.equal(shop.owner_id, 1);
    const [membership] = db.prepare('SELECT user_id, shop_id, role FROM shop_members').all();
    assert.equal(membership.user_id, 1);
    assert.equal(membership.shop_id, shop.id);
    assert.equal(membership.role, 'ADMIN');
    assert.equal(db.prepare('SELECT shop_id FROM categories WHERE name = ?').get('Groceries').shop_id, shop.id);

    await ensureTenantSchema(query, false);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM shops').get().count, 1);
    db.close();
  });

  it('does not create a shared legacy shop for a fresh empty database', async () => {
    const { db, query } = createDatabase();
    await ensureTenantSchema(query, false);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM shops').get().count, 0);
    db.close();
  });

  it('refuses to start when business data has no owner and no shop exists', async () => {
    const { db, query } = createDatabase();
    db.prepare('INSERT INTO categories (name) VALUES (?)').run('Unassigned');
    await assert.rejects(ensureTenantSchema(query, false), /no shop or owner/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM shops').get().count, 0);
    db.close();
  });

  it('replaces global category uniqueness with shop-local uniqueness without losing rows', async () => {
    const { db, query } = createDatabase();
    db.exec(`PRAGMA foreign_keys = OFF;
      DROP TABLE categories;
      CREATE TABLE categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shop_id TEXT REFERENCES shops(id),
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      DROP TABLE products;
      CREATE TABLE products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shop_id TEXT REFERENCES shops(id),
        name TEXT NOT NULL,
        sku TEXT NOT NULL UNIQUE,
        barcode TEXT UNIQUE,
        category_id INTEGER NOT NULL REFERENCES categories(id),
        supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
        brand TEXT,
        description TEXT,
        image_path TEXT,
        purchase_price NUMERIC NOT NULL CHECK (purchase_price >= 0),
        selling_price NUMERIC NOT NULL CHECK (selling_price >= 0),
        tax_percentage NUMERIC NOT NULL DEFAULT 0 CHECK (tax_percentage BETWEEN 0 AND 100),
        current_stock INTEGER NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
        min_stock_level INTEGER NOT NULL DEFAULT 5 CHECK (min_stock_level >= 0),
        reorder_quantity INTEGER NOT NULL DEFAULT 10,
        expiry_date TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      PRAGMA foreign_keys = ON;`);
    db.prepare(
      `INSERT INTO shops (id, shop_code, shop_name, shop_type, address, country, state, city, area, pincode)
       VALUES (?, ?, ?, 'Other', '', '', '', '', '', '')`
    ).run('shop-one', 'SBZ-ONE', 'Shop One');
    db.prepare(
      `INSERT INTO shops (id, shop_code, shop_name, shop_type, address, country, state, city, area, pincode)
       VALUES (?, ?, ?, 'Other', '', '', '', '', '', '')`
    ).run('shop-two', 'SBZ-TWO', 'Shop Two');
    db.prepare('INSERT INTO categories (shop_id, name) VALUES (?, ?)').run('shop-one', 'Groceries');

    await ensureTenantSchema(query, false);

    assert.equal(
      db.prepare('SELECT shop_id FROM categories WHERE name = ?').get('Groceries').shop_id,
      'shop-one'
    );
    db.prepare('INSERT INTO categories (shop_id, name) VALUES (?, ?)').run('shop-two', 'Groceries');
    assert.throws(
      () => db.prepare('INSERT INTO categories (shop_id, name) VALUES (?, ?)').run('shop-one', 'Groceries'),
      /UNIQUE constraint failed/
    );
    const categoryOne = db.prepare('SELECT id FROM categories WHERE shop_id = ?').get('shop-one');
    const categoryTwo = db.prepare('SELECT id FROM categories WHERE shop_id = ?').get('shop-two');
    const insertProduct = db.prepare(
      `INSERT INTO products (shop_id, name, sku, barcode, category_id, purchase_price, selling_price)
       VALUES (?, ?, ?, ?, ?, 1, 2)`
    );
    insertProduct.run('shop-one', 'Product One', 'SHARED-SKU', 'SHARED-CODE', categoryOne.id);
    insertProduct.run('shop-two', 'Product Two', 'SHARED-SKU', 'SHARED-CODE', categoryTwo.id);
    assert.throws(
      () => insertProduct.run('shop-one', 'Duplicate SKU', 'SHARED-SKU', 'OTHER-CODE', categoryOne.id),
      /UNIQUE constraint failed/
    );
    assert.throws(
      () => insertProduct.run('shop-one', 'Duplicate barcode', 'OTHER-SKU', 'SHARED-CODE', categoryOne.id),
      /UNIQUE constraint failed/
    );
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    db.close();
  });
});
