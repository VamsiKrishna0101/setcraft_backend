import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'data/fitness_ui.en.json');
const english = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
const keys = [
  'Log sleep', 'Your night, logged', 'No device needed. Add your sleep duration and how you feel.',
  'Preview is read-only. Switch to real data to save an entry.', 'Wake-up date', 'Hours', 'Minutes',
  'How do you feel?', 'Optional', 'Low energy', 'Okay', 'Energized', 'Save sleep', 'Sleep logged',
  'Self-reported', 'No device needed', 'Self-reported sleep. Recovery, HRV and heart rate need separate readings.',
  'Enter hours from 0 to 24 and minutes from 0 to 59.',
  'Could not save. Your entry is still here. Try again.', 'Could not save. Try again.',
  'Add meal', 'Log meal', 'Your meals', 'Daily intake', 'Profile target', 'Protein', 'Carbs', 'Fat',
  'Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Nothing logged yet', 'Could not load nutrition.',
  'Targets are estimated from your profile. Logged portions update your totals.',
  'Food library', 'Custom meal', 'Portion', 'Nutrition per portion', 'Food name', 'Portion size',
  'Calories', 'Servings eaten', 'Choose another food', 'Search foods',
  'Use your package label or recipe. No nutrition values are filled in automatically.',
  'No foods found. Add a custom meal.', 'Search to narrow the food list.',
  'Could not load foods. Retry or add a custom meal.', 'Enter a valid number of servings.',
  'Add a food name, portion size and all four nutrition values. Enter 0 where appropriate.',
  'Remove this meal from today?', 'Remove meal', 'Cancel',
  'Sample whole-body direction: balance pushing, pulling and lower-body movements.',
  'Preview report with example measurements. No photos were analysed.', 'No photos were analysed.',
  'Balance pressing with controlled chest movements.', 'Include lateral and overhead movements.',
  'Include controlled curls alongside pulling movements.', 'Include extensions alongside pressing movements.',
  'Build grip strength alongside your main lifts.', 'Include rows for balanced upper-body training.',
  'Include vertical pulling movements.', 'Build controlled hip-hinge technique.',
  'Include bracing and anti-rotation movements.', 'Include hip extension and squat patterns.',
  'Include squat or leg-press patterns.', 'Include leg curls and hip-hinge patterns.',
  'Include controlled calf raises.', 'Oats, yogurt & fruit', 'Rice & grilled chicken',
  'Salmon & roasted vegetables',
];
for (const key of keys) english[key] = key;
fs.writeFileSync(file, JSON.stringify(english, null, 2) + '\n');
console.log(`Prepared ${keys.length} sleep, nutrition and preview labels.`);
