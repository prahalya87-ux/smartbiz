const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { isSupportedBarcode, lookupBarcode } = require('./barcodeCatalog');

describe('barcode catalog lookup', () => {
  it('accepts standard numeric GTIN lengths', () => {
    for (const barcode of ['12345670', '123456789012', '1234567890128', '12345678901231']) {
      assert.equal(isSupportedBarcode(barcode), true);
    }
    for (const barcode of ['', 'ABC12345', '1234567', '1234567890', '123456789012345', '1234567890123']) {
      assert.equal(isSupportedBarcode(barcode), false);
    }
  });

  it('normalizes product names, brands, and categories from the catalog response', async () => {
    let requestUrl;
    const product = await lookupBarcode('1234567890128', async (url, options) => {
      requestUrl = url;
      assert.match(options.headers['User-Agent'], /SmartBiz/);
      return {
        ok: true,
        json: async () => ({
          status: 1,
          product: {
            product_name: 'Sample food',
            brands: 'First Brand, Second Brand',
            categories: 'Food, Snacks',
          },
        }),
      };
    });

    assert.equal(requestUrl.searchParams.get('fields'), 'code,product_name,product_name_en,brands,categories');
    assert.deepEqual(product, {
      name: 'Sample food',
      brand: 'First Brand',
      categories: ['Food', 'Snacks'],
    });
  });

  it('uses the English name when available and handles missing catalog products', async () => {
    const english = await lookupBarcode('1234567890128', async () => ({
      ok: true,
      json: async () => ({
        status: 1,
        product: { product_name: 'Nom du produit', product_name_en: 'Product name' },
      }),
    }));
    assert.equal(english.name, 'Product name');

    const missing = await lookupBarcode('1234567890128', async () => ({
      ok: true,
      json: async () => ({ status: 0 }),
    }));
    assert.equal(missing, null);
  });

  it('reports an unavailable catalog instead of returning invented data', async () => {
    await assert.rejects(
      lookupBarcode('1234567890128', async () => ({ ok: false })),
      { status: 502, message: 'The barcode catalog is temporarily unavailable.' }
    );
  });

  it('does not send a barcode with an invalid check digit to the catalog', async () => {
    await assert.rejects(
      lookupBarcode('1234567890123', async () => {
        assert.fail('Invalid barcodes must not be looked up.');
      }),
      { status: 400, message: 'Enter a valid product barcode.' }
    );
  });
});
