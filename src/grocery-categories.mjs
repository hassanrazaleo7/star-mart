export const GROCERY_TAXONOMY = [
  {
    id: 'grocery-staples',
    name: 'Grocery Staples',
    icon: 'Wheat',
    items: [],
  },
  {
    id: 'cooking-oil-ghee',
    name: 'Cooking Oil & Ghee',
    icon: 'Droplets',
    items: [],
  },
  {
    id: 'spices-sauces',
    name: 'Spices & Sauces',
    icon: 'CookingPot',
    items: [],
  },
  {
    id: 'drinks-tea-coffee',
    name: 'Drinks, Tea & Coffee',
    icon: 'Coffee',
    items: [],
  },
  {
    id: 'milk-dairy',
    name: 'Milk & Dairy',
    icon: 'Milk',
    items: [],
  },
  {
    id: 'bakery-breakfast',
    name: 'Bakery & Breakfast',
    icon: 'Croissant',
    items: [],
  },
  {
    id: 'snacks-confectionery',
    name: 'Snacks & Confectionery',
    icon: 'Cookie',
    items: [],
  },
  {
    id: 'dry-fruits-nuts',
    name: 'Dry Fruits & Nuts',
    icon: 'Nut',
    items: [],
  },
  {
    id: 'fruits-vegetables',
    name: 'Fruits & Vegetables',
    icon: 'Apple',
    items: [],
  },
  {
    id: 'frozen-instant-foods',
    name: 'Frozen & Instant Foods',
    icon: 'Snowflake',
    items: [],
  },
  {
    id: 'baby-care-nutrition',
    name: 'Baby Care & Nutrition',
    icon: 'Baby',
    items: [],
  },
  {
    id: 'personal-care-hygiene',
    name: 'Personal Care & Hygiene',
    icon: 'Sparkles',
    items: [],
  },
  {
    id: 'household-cleaning',
    name: 'Household Cleaning',
    icon: 'SprayCan',
    items: [],
  },
  {
    id: 'laundry-detergents',
    name: 'Laundry & Detergents',
    icon: 'WashingMachine',
    items: [],
  },
  {
    id: 'tissues-paper-products',
    name: 'Tissues & Paper Products',
    icon: 'ScrollText',
    items: [],
  },
  {
    id: 'home-kitchen',
    name: 'Home & Kitchen',
    icon: 'Utensils',
    items: [],
  },
  {
    id: 'perfumes-fragrances',
    name: 'Perfumes & Fragrances',
    icon: 'Wind',
    items: [],
  },
  {
    id: 'seasonal-imported',
    name: 'Seasonal & Imported',
    icon: 'Gift',
    items: [],
  },
  {
    id: 'ice-cream-desserts',
    name: 'Ice Cream & Desserts',
    icon: 'IceCreamBowl',
    items: [],
  },
  {
    id: 'everyday-stationery',
    name: 'Everyday & Stationery',
    icon: 'NotebookPen',
    items: [],
  },
];
export const GROCERY_CATEGORIES = GROCERY_TAXONOMY.map(c => c.name);
export const CATEGORY_ALIASES = {
  'Atta, Flour & Grains': 'Grocery Staples',
  'Rice & Pulses (Daal)': 'Grocery Staples',
  'Sugar, Salt & Sweeteners': 'Grocery Staples',
  'Spices & Masala': 'Spices & Sauces',
  'Noodles, Pasta & Sauces': 'Spices & Sauces',
  'Tea, Coffee & Beverages': 'Drinks, Tea & Coffee',
  'Drinking Water': 'Drinks, Tea & Coffee',
  'Dairy & Chilled Products': 'Milk & Dairy',
  'Bread & Bakery': 'Bakery & Breakfast',
  'Breakfast & Cereals': 'Bakery & Breakfast',
  'Biscuits, Cookies & Wafers': 'Snacks & Confectionery',
  'Chocolates & Confectionery': 'Snacks & Confectionery',
  'Snacks & Namkeen': 'Snacks & Confectionery',
  'Baby & Kids Snacks': 'Snacks & Confectionery',
  'Fresh Fruits & Vegetables': 'Fruits & Vegetables',
  'Frozen Foods': 'Frozen & Instant Foods',
  'Ready-to-Cook / Ready-to-Eat': 'Frozen & Instant Foods',
  'Canned & Packaged Foods': 'Frozen & Instant Foods',
  'Baby Care': 'Baby Care & Nutrition',
  'Personal Care': 'Personal Care & Hygiene',
  'Mosquito & Pest Control': 'Household Cleaning',
  Laundry: 'Laundry & Detergents',
  'Tissue & Paper Products': 'Tissues & Paper Products',
  'Pet Food & Pet Care': 'Pet Care',
  'Seasonal & Special Items': 'Seasonal & Imported',
  'Imported / Premium Products': 'Seasonal & Imported',
  'Ice Cream & Frozen Desserts': 'Ice Cream & Desserts',
  'Cash & Convenience Items': 'Everyday & Stationery',
  'Stationery & School Supplies': 'Everyday & Stationery',
  'Meat & Poultry': 'Fresh Meat & Seafood',
  'Fish & Seafood': 'Fresh Meat & Seafood',
  Fruits: 'Fruits & Vegetables',
  Vegetables: 'Fruits & Vegetables',
  'Dairy & Eggs': 'Milk & Dairy',
  Bakery: 'Bakery & Breakfast',
  'Rice & Grains': 'Grocery Staples',
  'Flour & Baking': 'Grocery Staples',
  'Pulses & Lentils': 'Grocery Staples',
  'Spices & Condiments': 'Spices & Sauces',
  'Tea & Coffee': 'Drinks, Tea & Coffee',
  Beverages: 'Drinks, Tea & Coffee',
  'Snacks & Sweets': 'Snacks & Confectionery',
  'Canned & Packaged': 'Frozen & Instant Foods',
  'Pet Supplies': 'Pet Care',
  Other: 'Everyday & Stationery',
};
export const REMOVED_CATEGORIES = ['Pet Care', 'Health & Wellness', 'Fresh Meat & Seafood'];
export const LEGACY_CATEGORIES = REMOVED_CATEGORIES;
export function normalizeCategory(value) {
  const name = String(value ?? ' ').trim();
  return (
    CATEGORY_ALIASES[name] ||
    GROCERY_CATEGORIES.find(c => c.toLowerCase() === name.toLowerCase()) ||
    name
  );
}
export function categoryExamples() {
  return '';
}

export function isRemovedCategory(value) {
  return (
    REMOVED_CATEGORIES.includes(normalizeCategory(value)) ||
    ['Health & Fitness', 'Health and Fitness', 'Pet Care', 'Fresh Meat and Sea Foods'].includes(
      String(value).trim()
    )
  );
}
