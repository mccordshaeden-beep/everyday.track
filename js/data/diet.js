// diet.js — allergies, diets and "foods I avoid".
//
// Recipes are checked by reading their ingredient lines for words that usually
// mean an allergen (e.g. "parmesan" → dairy, "soy sauce" → soy and wheat).
// It's deliberately cautious (it would rather hide a safe recipe than show an
// unsafe one), but it can't see inside packaged foods, so it's a helper, not a
// guarantee: always check labels.

export const ALLERGENS = [
  ['milk', 'Dairy / milk'], ['egg', 'Eggs'], ['peanut', 'Peanuts'], ['treenut', 'Tree nuts'],
  ['wheat', 'Wheat / gluten'], ['soy', 'Soy'], ['fish', 'Fish'], ['shellfish', 'Shellfish'], ['sesame', 'Sesame'],
];
export const DIETS = [
  ['', 'No special diet'], ['vegetarian', 'Vegetarian'], ['vegan', 'Vegan'], ['pescatarian', 'Pescatarian'],
  ['nopork', 'No pork'], ['nobeef', 'No beef'], ['halal', 'Halal-style (no pork or alcohol)'],
];
const LABEL = Object.fromEntries([...ALLERGENS, ...DIETS]);

// Phrases that contain a trigger word but are fine (removed before checking).
const SAFE = {
  milk: /\b(peanut|almond|cashew|sun ?flower|cocoa|shea) butter\b|\b(coconut|oat|almond|soy|rice|cashew) milk\b|\bbutternut\b|\bcream of tartar\b/g,
  wheat: /\b(pasta|pizza|marinara) sauce\b|\bcorn tortillas?\b|\bcorn ?starch\b|\btaco shells?\b|\bbuckwheat\b/g,
  egg: /\beggplant\b/g,
};
const RX = {
  milk: /\b(milk|cheeses?|cheddar|mozzarella|parmesan|ricotta|feta|butter|cream|yogh?urt|alfredo|ghee|whey|caesar|pesto|ranch|chocolate)\b/,
  egg: /\b(eggs?|mayo|mayonnaise|caesar|egg noodles?|meringue)\b/,
  peanut: /\bpeanuts?\b/,
  treenut: /\b(almonds?|cashews?|walnuts?|pecans?|pistachios?|hazelnuts?|macadamias?|pine nuts?|brazil nuts?|pesto|granola|nutella|marzipan|praline)\b/,
  wheat: /\b(bread|breadcrumbs?|panko|pasta|spaghetti|penne|fettuccine|linguine|macaroni|noodles?|ramen|lasagna|couscous|tortillas?|wraps?|pitas?|bagels?|buns?|muffins?|croutons?|crackers?|flour|wheat|barley|rye|oats|oatmeal|granola|soy sauce|teriyaki|pizza|dumplings?|biscuits?|pancake mix|cereal|seitan|taco seasoning)\b/,
  soy: /\b(soy|soya|tofu|edamame|tempeh|miso|teriyaki)\b/,
  fish: /\b(fish|salmon|tuna|cod|tilapia|halibut|trout|sardines?|anchov(y|ies)|caesar|worcestershire|fish sauce)\b/,
  shellfish: /\b(shrimp|prawns?|crab|lobster|scallops?|clams?|mussels?|oysters?|crawfish|calamari|squid)\b/,
  sesame: /\b(sesame|tahini|hummus)\b/,
};
const MEAT = /\b(chicken|beef|steak|turkey|pork|bacon|ham|sausages?|pepperoni|salami|prosciutto|lamb|veal|venison|meatballs?|hot dogs?|chorizo|bison|duck|gelatin|lard)\b/;
const PORK = /\b(pork|bacon|ham|sausages?|pepperoni|salami|prosciutto|chorizo|hot dogs?|lard|pancetta)\b/;
const BEEF = /\b(beef|steak|veal|brisket|bison)\b/;
const ANIMAL = /\b(honey|gelatin)\b/;
const ALCOHOL = /\b(wine|beer|rum|vodka|whiskey|bourbon|brandy|sake|mirin)\b/;

const lower = r => (Array.isArray(r.ingredients) ? r.ingredients.join('\n') : String(r.ingredients || '')).toLowerCase() + '\n' + String(r.name || '').toLowerCase();
const has = (text, key) => RX[key].test(SAFE[key] ? text.replace(SAFE[key], ' ') : text);

/** Words the user typed under "Other foods I avoid", split on commas / new lines. */
export const avoidWords = prefs => String(prefs?.avoid || '').split(/[,\n]/).map(s => s.trim().toLowerCase()).filter(Boolean);

/** Reasons this recipe doesn't fit the person's settings (empty array = fine). */
export function conflicts(recipe, prefs) {
  if (!prefs) return [];
  const t = lower(recipe);
  const out = [];
  for (const a of prefs.allergies || []) if (RX[a] && has(t, a)) out.push(LABEL[a]);
  const fish = has(t, 'fish') || has(t, 'shellfish');
  switch (prefs.diet) {
    case 'vegan': if (MEAT.test(t) || fish || has(t, 'milk') || has(t, 'egg') || ANIMAL.test(t)) out.push('Not vegan'); break;
    case 'vegetarian': if (MEAT.test(t) || fish) out.push('Not vegetarian'); break;
    case 'pescatarian': if (MEAT.test(t)) out.push('Has meat'); break;
    case 'nopork': if (PORK.test(t)) out.push('Has pork'); break;
    case 'nobeef': if (BEEF.test(t)) out.push('Has beef'); break;
    case 'halal': if (PORK.test(t) || ALCOHOL.test(t)) out.push('Has pork or alcohol'); break;
  }
  for (const w of avoidWords(prefs)) {
    const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    if (re.test(t)) out.push(`Has ${w}`);
  }
  return [...new Set(out)];
}

/** Short summary for the UI, e.g. "Vegetarian · no peanuts, shellfish". */
export function summary(prefs) {
  if (!prefs) return '';
  const parts = [];
  if (prefs.diet) parts.push(LABEL[prefs.diet]);
  const al = (prefs.allergies || []).map(a => LABEL[a]?.split(' /')[0].toLowerCase()).filter(Boolean);
  if (al.length) parts.push('no ' + al.join(', '));
  const av = avoidWords(prefs);
  if (av.length) parts.push(`avoiding ${av.join(', ')}`);
  return parts.join(' · ');
}

export const isSet = prefs => !!(prefs && (prefs.diet || prefs.allergies?.length || avoidWords(prefs).length));
