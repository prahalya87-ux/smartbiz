const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  extractVoiceInventory,
  isValidDate,
  matchCatalogItems,
  normalizeExtraction,
  validateConfirmationItems,
} = require('./voiceInventory');

describe('voice inventory extraction', () => {
  it('accepts single and multiple extracted products without guessing missing values', () => {
    const items = normalizeExtraction({
      items: [
        { product_name: 'Britannia biscuits', brand: 'Britannia', quantity: 20, expiry_date: '2027-12-31', expiry_text: 'December 2027' },
        { product_name: 'Tea', quantity: null, expiry_date: null },
      ],
    });
    assert.equal(items.length, 2);
    assert.equal(items[0].quantity, 20);
    assert.equal(items[0].expiry_date, '2027-12-31');
    assert.equal(items[1].quantity, null);
    assert.ok(items[1].warnings.includes('Quantity is missing or invalid.'));
  });

  it('flags invalid dates and missing names instead of normalizing them silently', () => {
    const [item] = normalizeExtraction({
      items: [{ product_name: '', quantity: 2, expiry_date: '2027-02-29', expiry_text: 'February 29, 2027' }],
    });
    assert.equal(item.expiry_date, null);
    assert.ok(item.warnings.includes('Product name is missing.'));
    assert.ok(item.warnings.includes('The expiry date could not be validated. Please correct it.'));
    assert.equal(isValidDate('2028-02-29'), true);
    assert.equal(isValidDate('2027-02-29'), false);
  });

  it('identifies exact catalog matches, uncertain matches, and repeated product possibilities', () => {
    const products = [
      { id: 1, name: 'Good Day Biscuits', brand: 'Britannia', sku: 'GD-1', current_stock: 4 },
      { id: 2, name: 'Good Day Biscuits Family Pack', brand: 'Britannia', sku: 'GD-2', current_stock: 8 },
    ];
    const items = matchCatalogItems([
      { product_name: 'Good Day Biscuits', brand: 'Britannia', quantity: 20, expiry_date: null, expiry_text: '', warnings: [] },
      { product_name: 'Good Day Biscuits', brand: 'Other brand', quantity: 5, expiry_date: null, expiry_text: '', warnings: [] },
    ], products);
    assert.equal(items[0].product_id, 1);
    assert.equal(items[0].match_confidence, 'high');
    assert.equal(items[1].product_id, null);
    assert.equal(items[1].duplicate, true);
    assert.ok(items[1].warnings.some((warning) => warning.includes('Possible duplicate')));
    assert.ok(items[1].warnings.some((warning) => warning.includes('Brand does not match')));
  });

  it('finds brand-based candidates without silently choosing a product', () => {
    const [item] = matchCatalogItems([
      { product_name: 'Britannia biscuits', brand: '', quantity: 20, expiry_date: null, expiry_text: '', warnings: [] },
    ], [
      { id: 1, name: 'Good Day Biscuits 200g', brand: 'Britannia', sku: 'GD-1', current_stock: 4 },
    ]);
    assert.equal(item.product_id, null);
    assert.equal(item.candidates[0].id, 1);
    assert.equal(item.match_confidence, 'low');
    assert.ok(item.warnings.some((warning) => warning.includes('uncertain')));
  });

  it('matches shuffled product words and selects only a clearly strongest catalog match', () => {
    const [item] = matchCatalogItems([
      { product_name: 'biscuits Britannia', brand: '', quantity: 20, expiry_date: null, expiry_text: '', warnings: [] },
    ], [
      { id: 1, name: 'Good Day Biscuits', brand: 'Britannia', sku: 'GD-1', current_stock: 4 },
      { id: 2, name: 'Marie Biscuits', brand: 'Sunrise', sku: 'MB-1', current_stock: 7 },
    ]);
    assert.equal(item.candidates[0].id, 1);
    assert.equal(item.product_id, 1);
    assert.equal(item.match_confidence, 'high');
  });

  it('keeps ambiguous token matches unselected', () => {
    const [item] = matchCatalogItems([
      { product_name: 'Rice', brand: '', quantity: 20, expiry_date: null, expiry_text: '', warnings: [] },
    ], [
      { id: 1, name: 'Basmati Rice', brand: 'Brand A', sku: 'R-1', current_stock: 4 },
      { id: 2, name: 'Sona Masoori Rice', brand: 'Brand B', sku: 'R-2', current_stock: 7 },
    ]);
    assert.equal(item.product_id, null);
    assert.equal(item.match_confidence, 'low');
    assert.equal(item.candidates.length, 2);
  });

  it('extracts simple single and multiple receipts offline without an AI key', async () => {
    const single = await extractVoiceInventory(
      'Received 20 packets of Britannia biscuits, expiry December 2027',
      'en-US',
      { apiKey: '' }
    );
    assert.equal(single.source, 'offline');
    assert.equal(single.items[0].product_name, 'Britannia biscuits');
    assert.equal(single.items[0].quantity, 20);
    assert.equal(single.items[0].expiry_date, '2027-12-31');

    const multiple = await extractVoiceInventory(
      'Received 20 packets of biscuits and 5 bottles of juice, expiry 2027-12-31',
      'en-US',
      { apiKey: '' }
    );
    assert.deepEqual(multiple.items.map((item) => item.quantity), [20, 5]);
    assert.deepEqual(multiple.items.map((item) => item.product_name), ['biscuits', 'juice']);
  });

  it('extracts quantities stated with weight, medicine, and package units', async () => {
    const result = await extractVoiceInventory(
      'Received 2 kg rice and 10 strips of paracetamol tablets',
      'en-US',
      { apiKey: '' }
    );
    assert.deepEqual(result.items.map((item) => item.quantity), [2, 10]);
    assert.deepEqual(result.items.map((item) => item.product_name), ['rice', 'paracetamol tablets']);
  });

  it('understands product-first and mixed word order in offline voice notes', async () => {
    const single = await extractVoiceInventory('Rice got 20 packets', 'en-US', { apiKey: '' });
    assert.equal(single.items[0].product_name, 'Rice');
    assert.equal(single.items[0].quantity, 20);

    const multiple = await extractVoiceInventory(
      'Rice 20 packets and sugar 5 bottles received',
      'en-US',
      { apiKey: '' }
    );
    assert.deepEqual(multiple.items.map((item) => item.product_name), ['Rice', 'sugar']);
    assert.deepEqual(multiple.items.map((item) => item.quantity), [20, 5]);
  });

  it('extracts plain spoken counts but asks the user to confirm the unit', async () => {
    const result = await extractVoiceInventory(
      'Received 20 rice and 5 sugar',
      'en-US',
      { apiKey: '' }
    );
    assert.deepEqual(result.items.map((item) => item.product_name), ['rice', 'sugar']);
    assert.deepEqual(result.items.map((item) => item.quantity), [20, 5]);
    assert.ok(result.items.every((item) => item.warnings.some((warning) => warning.includes('No stock unit'))));
  });

  it('keeps an expiry date when extracting a count without a unit', async () => {
    const result = await extractVoiceInventory(
      'Received 20 rice, expiry December 2027',
      'en-US',
      { apiKey: '' }
    );
    assert.equal(result.items[0].product_name, 'rice');
    assert.equal(result.items[0].quantity, 20);
    assert.equal(result.items[0].expiry_date, '2027-12-31');
  });

  it('flags unsupported offline phrases instead of guessing', async () => {
    const result = await extractVoiceInventory('Maybe add some rice', 'en-US', { apiKey: '' });
    assert.equal(result.items[0].product_name, '');
    assert.equal(result.items[0].quantity, null);
    assert.ok(result.items[0].warnings.some((warning) => warning.includes('Offline mode')));
  });

  it('uses the configured provider for structured extraction', async () => {
    let requestBody;
    const result = await extractVoiceInventory('received 20 packets', 'en-US', {
      apiUrl: 'https://voice.example.test/v1/chat/completions',
      apiKey: 'test-secret',
      model: 'test-model',
      fetchImpl: async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({
              items: [{ product_name: 'Rice', quantity: 20, expiry_date: null, expiry_text: '' }],
            }) } }],
          }),
        };
      },
    });
    assert.equal(result.source, 'provider');
    assert.equal(result.items[0].product_name, 'Rice');
    assert.equal(requestBody.model, 'test-model');
    assert.equal(requestBody.messages[1].content.includes('received 20 packets'), true);
  });

  it('passes the selected multilingual language to extraction', async () => {
    const offline = await extractVoiceInventory('प्राप्त हुए २० पैकेट बिस्कुट समाप्ति December 2027', 'hi-IN', { apiKey: '' });
    assert.equal(offline.items[0].quantity, 20);
    assert.equal(offline.items[0].product_name, 'बिस्कुट');
    assert.equal(offline.items[0].expiry_date, '2027-12-31');

    let requestBody;
    await extractVoiceInventory('२० पैकेट प्राप्त हुए', 'hi-IN', {
      apiKey: 'test-secret',
      fetchImpl: async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({
              items: [{ product_name: 'बिस्कुट', quantity: 20, expiry_date: null, expiry_text: '' }],
            }) } }],
          }),
        };
      },
    });
    assert.equal(JSON.parse(requestBody.messages[1].content).language, 'hi-IN');
  });

  it('accepts corrected date and quantity values while rejecting invalid or duplicate confirmations', () => {
    const [extracted] = normalizeExtraction({
      items: [{ product_name: 'Rice', quantity: null, expiry_date: '2027-02-29', expiry_text: 'February 29, 2027' }],
    });
    assert.equal(extracted.quantity, null);
    assert.equal(extracted.expiry_date, null);

    assert.deepEqual(validateConfirmationItems([
      { product_id: '12', quantity: '20', expiry_date: '2028-02-29' },
    ]), [{ productId: 12, quantity: 20, expiryDate: '2028-02-29' }]);
    assert.throws(() => validateConfirmationItems([
      { product_id: 12, quantity: 20, expiry_date: '2027-02-29' },
    ]), /invalid expiry date/);
    assert.throws(() => validateConfirmationItems([
      { product_id: 12, quantity: 20 },
      { product_id: 12, quantity: 5 },
    ]), /Possible duplicate products/);
  });
});
