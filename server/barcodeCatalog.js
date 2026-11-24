const OPEN_FOOD_FACTS_URL = 'https://world.openfoodfacts.org/api/v2/product/';

function hasValidCheckDigit(barcode) {
  const digits = String(barcode || '');
  if (!/^(?:\d{8}|\d{12,14})$/.test(digits)) return false;
  const body = digits.slice(0, -1);
  const sum = Array.from(body).reverse().reduce((total, digit, index) =>
    total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1));
}

const isSupportedBarcode = (barcode) => hasValidCheckDigit(barcode);

async function lookupBarcode(barcode, fetchImpl = fetch) {
  if (!isSupportedBarcode(barcode)) {
    throw Object.assign(new Error('Enter a valid product barcode.'), { status: 400 });
  }
  const url = new URL(`${OPEN_FOOD_FACTS_URL}${encodeURIComponent(barcode)}.json`);
  url.searchParams.set('fields', 'code,product_name,product_name_en,brands,categories');
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': 'SmartBiz/1.0 (barcode product lookup)' },
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) {
    throw Object.assign(new Error('The barcode catalog is temporarily unavailable.'), { status: 502 });
  }

  const result = await response.json();
  const product = result?.status === 1 ? result.product : null;
  const englishName = typeof product?.product_name_en === 'string' ? product.product_name_en.trim() : '';
  const localName = typeof product?.product_name === 'string' ? product.product_name.trim() : '';
  const name = englishName || localName;
  if (!name) return null;

  return {
    name: name.slice(0, 150),
    brand: (typeof product.brands === 'string' ? product.brands : '').split(',')[0].trim().slice(0, 100),
    categories: (typeof product.categories === 'string' ? product.categories : '')
      .split(',').map((category) => category.trim()).filter(Boolean).slice(0, 8),
  };
}

module.exports = { hasValidCheckDigit, isSupportedBarcode, lookupBarcode };
