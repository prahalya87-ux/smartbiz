const GROCERY_CATEGORIES = [
  'Groceries',
  'Staples & Grains',
  'Fruits & Vegetables',
  'Dairy & Eggs',
  'Beverages',
  'Snacks & Confectionery',
  'Packaged Foods',
  'Personal Care',
  'Household Cleaning',
  'Home & Kitchen',
  'Baby Care',
  'Stationery',
  'Pet Supplies',
];

const DEFAULT_CATEGORIES_BY_TYPE = {
  Grocery: GROCERY_CATEGORIES,
  Kirana: GROCERY_CATEGORIES,
  Supermarket: GROCERY_CATEGORIES,
  Medical: [
    'Prescription Medicines',
    'Over-the-Counter Medicines',
    'First Aid',
    'Vitamins & Supplements',
    'Medical Devices',
    'Surgical Supplies',
    'Personal Care',
    'Baby Care',
    'Health & Wellness',
  ],
  Clothing: [
    "Men's Clothing",
    "Women's Clothing",
    "Kids' Clothing",
    'Footwear',
    'Accessories',
    'Innerwear',
    'Fabrics',
    'Seasonal Wear',
  ],
  Electronics: [
    'Mobile Phones & Accessories',
    'Computers & Accessories',
    'Home Appliances',
    'Audio & Video',
    'Cables & Chargers',
    'Batteries',
    'Peripherals',
    'Smart Home',
  ],
  Other: [
    'General Merchandise',
    'Beverages',
    'Snacks',
    'Groceries',
    'Household',
    'Personal Care',
  ],
};

const getDefaultCategories = (shopType) => DEFAULT_CATEGORIES_BY_TYPE[shopType] || DEFAULT_CATEGORIES_BY_TYPE.Other;

async function addDefaultCategories(query, shopId, shopType) {
  for (const name of getDefaultCategories(shopType)) {
    await query(
      'INSERT OR IGNORE INTO categories (shop_id, name, description) VALUES (?,?,?)',
      [shopId, name, '']
    );
  }
}

module.exports = { DEFAULT_CATEGORIES_BY_TYPE, addDefaultCategories, getDefaultCategories };
