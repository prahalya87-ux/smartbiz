const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { DEFAULT_CATEGORIES_BY_TYPE, addDefaultCategories, getDefaultCategories } = require('./shopCategories');

describe('shop default categories', () => {
  it('provides relevant, non-empty categories for each supported shop type', () => {
    for (const categories of Object.values(DEFAULT_CATEGORIES_BY_TYPE)) {
      assert.ok(categories.length > 0);
      assert.equal(new Set(categories).size, categories.length);
    }

    assert.ok(getDefaultCategories('Kirana').includes('Beverages'));
    assert.ok(getDefaultCategories('Medical').includes('Prescription Medicines'));
    assert.ok(getDefaultCategories('Clothing').includes("Women's Clothing"));
    assert.ok(getDefaultCategories('Electronics').includes('Mobile Phones & Accessories'));
  });

  it('uses general categories for an unknown shop type', () => {
    assert.deepEqual(getDefaultCategories('Unknown'), DEFAULT_CATEGORIES_BY_TYPE.Other);
  });

  it('creates categories scoped to the new shop', async () => {
    const inserted = [];
    await addDefaultCategories(async (_sql, params) => inserted.push(params), 'shop-123', 'Medical');
    assert.ok(inserted.length > 0);
    assert.ok(inserted.every(([shopId]) => shopId === 'shop-123'));
    assert.ok(inserted.some(([, name]) => name === 'Prescription Medicines'));
  });
});
