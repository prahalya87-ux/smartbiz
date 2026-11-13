const OPEN_FOOD_FACTS_URL = 'https://world.openfoodfacts.org/api/v2/product/';

const isSupportedBarcode = (barcode) => /^\d{8,14}$/.test(String(barcode || ''));

async function lookupBarcode(barcode, fetchImpl = fetch) {
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

module.exports = { isSupportedBarcode, lookupBarcode };
