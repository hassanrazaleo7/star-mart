import { normalizeCategory } from './grocery-categories.mjs';
// Storefront departments aggregate existing product categories; no inventory is rewritten.
export const SHOP_DEPARTMENTS = [
  {
    id: 'grocery-staples',
    name: 'Grocery Staples',
    icon: 'Wheat',
    featured: true,
    categories: ['Grocery Staples'],
  },
  {
    id: 'cooking-oil-ghee',
    name: 'Cooking Oil & Ghee',
    icon: 'Droplets',
    featured: true,
    categories: ['Cooking Oil & Ghee'],
  },
  {
    id: 'spices-sauces',
    name: 'Spices & Sauces',
    icon: 'CookingPot',
    featured: true,
    categories: ['Spices & Sauces'],
  },
  {
    id: 'drinks-tea-coffee',
    name: 'Drinks, Tea & Coffee',
    icon: 'Coffee',
    featured: true,
    categories: ['Drinks, Tea & Coffee'],
  },
  {
    id: 'milk-dairy',
    name: 'Milk & Dairy',
    icon: 'Milk',
    featured: true,
    categories: ['Milk & Dairy'],
  },
  {
    id: 'bakery-breakfast',
    name: 'Bakery & Breakfast',
    icon: 'Croissant',
    featured: true,
    categories: ['Bakery & Breakfast'],
  },
  {
    id: 'snacks-confectionery',
    name: 'Snacks & Confectionery',
    icon: 'Cookie',
    featured: true,
    categories: ['Snacks & Confectionery'],
  },
  {
    id: 'dry-fruits-nuts',
    name: 'Dry Fruits & Nuts',
    icon: 'Nut',
    featured: true,
    categories: ['Dry Fruits & Nuts'],
  },
  {
    id: 'fruits-vegetables',
    name: 'Fruits & Vegetables',
    icon: 'Apple',
    featured: true,
    categories: ['Fruits & Vegetables'],
  },
  {
    id: 'frozen-instant-foods',
    name: 'Frozen & Instant Foods',
    icon: 'Snowflake',
    featured: true,
    categories: ['Frozen & Instant Foods'],
  },
  {
    id: 'baby-care-nutrition',
    name: 'Baby Care & Nutrition',
    icon: 'Baby',
    featured: true,
    categories: ['Baby Care & Nutrition'],
  },
  {
    id: 'personal-care-hygiene',
    name: 'Personal Care & Hygiene',
    icon: 'Sparkles',
    featured: true,
    categories: ['Personal Care & Hygiene'],
  },
  {
    id: 'household-cleaning',
    name: 'Household Cleaning',
    icon: 'SprayCan',
    featured: true,
    categories: ['Household Cleaning'],
  },
  {
    id: 'laundry-detergents',
    name: 'Laundry & Detergents',
    icon: 'WashingMachine',
    featured: true,
    categories: ['Laundry & Detergents'],
  },
  {
    id: 'tissues-paper-products',
    name: 'Tissues & Paper Products',
    icon: 'ScrollText',
    featured: true,
    categories: ['Tissues & Paper Products'],
  },
  {
    id: 'home-kitchen',
    name: 'Home & Kitchen',
    icon: 'Utensils',
    featured: true,
    categories: ['Home & Kitchen'],
  },
  {
    id: 'perfumes-fragrances',
    name: 'Perfumes & Fragrances',
    icon: 'Wind',
    featured: true,
    categories: ['Perfumes & Fragrances'],
  },
  {
    id: 'seasonal-imported',
    name: 'Seasonal & Imported',
    icon: 'Gift',
    featured: true,
    categories: ['Seasonal & Imported'],
  },
  {
    id: 'ice-cream-desserts',
    name: 'Ice Cream & Desserts',
    icon: 'IceCreamBowl',
    featured: true,
    categories: ['Ice Cream & Desserts'],
  },
  {
    id: 'everyday-stationery',
    name: 'Everyday & Stationery',
    icon: 'NotebookPen',
    featured: true,
    categories: ['Everyday & Stationery'],
  },
];
export const departmentValue = id => 'department:' + id;
export function matchesDepartment(category, selection) {
  if (selection === 'all') return true;
  if (!selection.startsWith('department:'))
    return normalizeCategory(category) === normalizeCategory(selection);
  const group = SHOP_DEPARTMENTS.find(d => departmentValue(d.id) === selection);
  return !!group?.categories.includes(normalizeCategory(category));
}
export function selectionName(selection) {
  return SHOP_DEPARTMENTS.find(d => departmentValue(d.id) === selection)?.name || selection;
}
export function paymentForFulfillment(method, mode) {
  if (method === 'Cash on delivery' || method === 'Cash on pickup')
    return mode === 'Delivery' ? 'Cash on delivery' : 'Cash on pickup';
  if (method === 'POS card on delivery' || method === 'POS card on pickup')
    return mode === 'Delivery' ? 'POS card on delivery' : 'POS card on pickup';
  return method;
}
