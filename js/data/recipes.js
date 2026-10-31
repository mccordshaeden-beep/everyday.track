// recipes.js — the built-in recipe ideas everyone can pick from.
// Cheap, simple meals. Calories and protein are rough per-serving estimates.
// Add more by copying an entry; `slug` must be unique.

export const LIBRARY = [
  {
    slug: 'chicken-burrito-bowl', name: 'Chicken burrito bowl', type: 'Dinner', servings: 4, minutes: 30, calories: 560, protein: 40,
    tags: ['High protein', 'Meal prep'],
    ingredients: ['1 lb chicken breast', '2 cups rice', '1 can black beans', '1 cup salsa', '1 cup shredded cheese', '1 tsp chili powder', '1 lime'],
    steps: ['Cook the rice.', 'Season the chicken with chili powder, salt and pepper. Cook in a pan with a little oil, 6–7 min per side, then slice.', 'Warm and drain the black beans.', 'Build bowls: rice, beans, chicken, salsa and cheese. Squeeze lime on top.'],
  },
  {
    slug: 'spaghetti-meat-sauce', name: 'Spaghetti with meat sauce', type: 'Dinner', servings: 4, minutes: 25, calories: 620, protein: 32,
    tags: ['Classic'],
    ingredients: ['1 lb spaghetti', '1 lb ground beef', '1 jar pasta sauce', '1 onion', '2 cloves garlic', 'Parmesan cheese'],
    steps: ['Boil the spaghetti in salted water.', 'Brown the ground beef with the chopped onion. Drain the fat.', 'Add minced garlic for 1 minute, then the pasta sauce. Simmer 10 minutes.', 'Serve the sauce over the spaghetti with parmesan.'],
  },
  {
    slug: 'sheet-pan-sausage', name: 'Sheet pan sausage & veggies', type: 'Dinner', servings: 4, minutes: 35, calories: 480, protein: 18,
    tags: ['One pan'],
    ingredients: ['1 package smoked sausage', '3 potatoes', '1 bell pepper', '1 onion', '1 tsp Italian seasoning', 'Olive oil'],
    steps: ['Heat the oven to 425°F.', 'Cut the potatoes small, and the sausage, pepper and onion into chunks.', 'Toss everything with oil, Italian seasoning, salt and pepper on a sheet pan.', 'Roast 25–30 minutes, stirring halfway.'],
  },
  {
    slug: 'egg-fried-rice', name: 'Egg fried rice', type: 'Dinner', servings: 3, minutes: 15, calories: 420, protein: 16,
    tags: ['Quick', 'Uses leftovers'],
    ingredients: ['3 cups cooked rice', '4 eggs', '1 cup frozen peas and carrots', '3 green onions', '3 tbsp soy sauce', 'Vegetable oil'],
    steps: ['Heat oil in a large pan over high heat.', 'Scramble the eggs, then push them to the side.', 'Add the veggies for 2 minutes, then the rice. Fry until hot.', 'Stir in soy sauce and sliced green onions.'],
  },
  {
    slug: 'black-bean-quesadillas', name: 'Black bean quesadillas', type: 'Lunch', servings: 4, minutes: 15, calories: 520, protein: 24,
    tags: ['Vegetarian', 'Quick'],
    ingredients: ['8 tortillas', '1 can black beans', '2 cups shredded cheese', '1 cup corn', '1 cup salsa'],
    steps: ['Drain and lightly mash the beans. Mix in the corn.', 'Spread beans on half the tortillas, top with cheese and another tortilla.', 'Cook in a dry pan 2–3 minutes per side until crispy.', 'Cut and serve with salsa.'],
  },
  {
    slug: 'chicken-stir-fry', name: 'Chicken & veggie stir fry', type: 'Dinner', servings: 4, minutes: 25, calories: 510, protein: 36,
    tags: ['High protein'],
    ingredients: ['1 lb chicken breast', '1 bag frozen stir fry vegetables', '3 tbsp soy sauce', '1 tbsp honey', '2 cloves garlic', '2 cups rice'],
    steps: ['Cook the rice.', 'Cut the chicken into bite-size pieces and cook in a hot oiled pan until done.', 'Add the frozen veggies and garlic. Cook 5 minutes.', 'Stir in soy sauce and honey. Serve over rice.'],
  },
  {
    slug: 'turkey-chili', name: 'Turkey chili', type: 'Dinner', servings: 5, minutes: 40, calories: 430, protein: 34,
    tags: ['High protein', 'Meal prep'],
    ingredients: ['1 lb ground turkey', '1 can kidney beans', '1 can black beans', '1 can diced tomatoes', '1 onion', '2 tbsp chili powder'],
    steps: ['Brown the turkey with the chopped onion.', 'Add chili powder, then the beans (drained) and tomatoes with their juice.', 'Simmer 20–30 minutes. Season with salt.', 'Top with cheese or sour cream if you have it.'],
  },
  {
    slug: 'breakfast-burritos', name: 'Breakfast burritos', type: 'Breakfast', servings: 6, minutes: 25, calories: 450, protein: 22,
    tags: ['Freezer friendly'],
    ingredients: ['8 eggs', '6 tortillas', '2 cups frozen hash browns', '1 cup shredded cheese', 'Salsa'],
    steps: ['Cook the hash browns in an oiled pan until crispy.', 'Scramble the eggs with salt and pepper.', 'Fill each tortilla with hash browns, eggs, cheese and salsa. Roll up.', 'Eat now, or wrap in foil and freeze. Microwave 2 minutes from frozen.'],
  },
  {
    slug: 'overnight-oats', name: 'Overnight oats', type: 'Breakfast', servings: 1, minutes: 5, calories: 430, protein: 18,
    tags: ['No cook', 'Quick'],
    ingredients: ['1/2 cup oats', '1/2 cup milk', '1/4 cup Greek yogurt', '1 tbsp peanut butter', '1 banana', 'Honey'],
    steps: ['Stir oats, milk, yogurt and peanut butter in a jar.', 'Refrigerate overnight.', 'Top with sliced banana and a drizzle of honey.'],
  },
  {
    slug: 'tuna-pasta-salad', name: 'Tuna pasta salad', type: 'Lunch', servings: 4, minutes: 20, calories: 480, protein: 28,
    tags: ['Meal prep', 'Cold'],
    ingredients: ['8 oz pasta', '2 cans tuna', '1/2 cup mayo', '1 cup frozen peas', '1 celery stalk'],
    steps: ['Cook the pasta, adding the peas for the last 2 minutes. Drain and rinse with cold water.', 'Mix with drained tuna, mayo and chopped celery.', 'Season with salt and pepper. Keeps 3–4 days in the fridge.'],
  },
  {
    slug: 'baked-potato-bar', name: 'Loaded baked potatoes', type: 'Dinner', servings: 4, minutes: 60, calories: 450, protein: 17,
    tags: ['Cheap'],
    ingredients: ['4 potatoes', '1 cup shredded cheese', '1/2 cup sour cream', '2 cups broccoli', '4 slices bacon'],
    steps: ['Poke the potatoes with a fork and bake at 400°F for 50–60 minutes (or microwave 8–10 minutes).', 'Cook the bacon and steam the broccoli.', 'Split the potatoes and load with cheese, broccoli, bacon and sour cream.'],
  },
  {
    slug: 'chicken-alfredo', name: 'Chicken Alfredo', type: 'Dinner', servings: 4, minutes: 25, calories: 720, protein: 42,
    tags: ['Comfort food'],
    ingredients: ['1 lb fettuccine', '1 lb chicken breast', '1 jar Alfredo sauce', '2 cups broccoli'],
    steps: ['Boil the fettuccine. Add the broccoli for the last 3 minutes.', 'Cook the seasoned chicken in a pan, then slice.', 'Warm the Alfredo sauce and toss everything together.'],
  },
  {
    slug: 'ground-beef-tacos', name: 'Ground beef tacos', type: 'Dinner', servings: 4, minutes: 20, calories: 520, protein: 28,
    tags: ['Quick', 'Classic'],
    ingredients: ['1 lb ground beef', '1 packet taco seasoning', '8 taco shells', '1 head lettuce', '1 tomato', '1 cup shredded cheese'],
    steps: ['Brown the beef and drain.', 'Add the taco seasoning and the water the packet calls for. Simmer 5 minutes.', 'Warm the shells and fill with beef, lettuce, diced tomato and cheese.'],
  },
  {
    slug: 'lentil-soup', name: 'Lentil soup', type: 'Lunch', servings: 4, minutes: 45, calories: 280, protein: 16,
    tags: ['Vegetarian', 'Cheap', 'Meal prep'],
    ingredients: ['1 cup dry lentils', '1 onion', '2 carrots', '2 celery stalks', '1 can diced tomatoes', '4 cups broth'],
    steps: ['Cook the chopped onion, carrots and celery in a pot with oil for 5 minutes.', 'Add rinsed lentils, tomatoes and broth.', 'Simmer 30 minutes until the lentils are soft. Season with salt and pepper.'],
  },
  {
    slug: 'ramen-upgrade', name: 'Upgraded ramen', type: 'Lunch', servings: 2, minutes: 10, calories: 470, protein: 17,
    tags: ['Quick', 'Cheap'],
    ingredients: ['2 packs instant ramen', '2 eggs', '1 cup frozen vegetables', '2 green onions', '1 tbsp soy sauce'],
    steps: ['Boil the noodles with the frozen veggies.', 'Crack the eggs into the pot for the last 2–3 minutes (or soft-boil separately).', 'Stir in half the seasoning packets and the soy sauce. Top with green onion.'],
  },
  {
    slug: 'yogurt-parfait', name: 'Greek yogurt parfait', type: 'Breakfast', servings: 1, minutes: 5, calories: 380, protein: 24,
    tags: ['No cook', 'High protein'],
    ingredients: ['1 cup Greek yogurt', '1/2 cup granola', '1/2 cup berries', 'Honey'],
    steps: ['Layer yogurt, berries and granola in a bowl or cup.', 'Drizzle with honey.'],
  },
  {
    slug: 'honey-garlic-chicken', name: 'Honey garlic chicken thighs', type: 'Dinner', servings: 4, minutes: 35, calories: 560, protein: 38,
    tags: ['High protein'],
    ingredients: ['2 lb chicken thighs', '1/3 cup honey', '1/4 cup soy sauce', '4 cloves garlic', '2 cups rice'],
    steps: ['Cook the rice.', 'Brown the chicken thighs in an oiled pan, 5 minutes per side.', 'Mix honey, soy sauce and minced garlic. Pour over the chicken.', 'Cover and simmer 10–15 minutes until cooked through and sticky.'],
  },
  {
    slug: 'english-muffin-pizzas', name: 'English muffin pizzas', type: 'Lunch', servings: 2, minutes: 15, calories: 520, protein: 24,
    tags: ['Quick', 'Fun'],
    ingredients: ['4 English muffins', '1/2 cup pizza sauce', '1 cup mozzarella cheese', 'Pepperoni'],
    steps: ['Heat the oven (or air fryer) to 400°F.', 'Split the muffins, spread with sauce, add cheese and pepperoni.', 'Bake 8–10 minutes until bubbly.'],
  },
  {
    slug: 'pb-banana-toast', name: 'Peanut butter banana toast', type: 'Snack', servings: 1, minutes: 5, calories: 450, protein: 14,
    tags: ['Quick', 'No cook'],
    ingredients: ['2 slices bread', '2 tbsp peanut butter', '1 banana'],
    steps: ['Toast the bread.', 'Spread with peanut butter and top with sliced banana.'],
  },
  {
    slug: 'mac-and-cheese-broccoli', name: 'Mac & cheese with broccoli', type: 'Dinner', servings: 4, minutes: 20, calories: 540, protein: 22,
    tags: ['Comfort food', 'Vegetarian'],
    ingredients: ['12 oz macaroni', '2 cups shredded cheddar cheese', '1 1/2 cups milk', '2 tbsp butter', '2 tbsp flour', '2 cups broccoli'],
    steps: ['Boil the macaroni, adding broccoli for the last 3 minutes. Drain.', 'Melt butter, whisk in flour for 1 minute, then slowly whisk in milk until thick.', 'Stir in the cheese until melted. Season with salt and pepper.', 'Mix in the pasta and broccoli.'],
  },
];
