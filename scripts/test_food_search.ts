import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  filterAndRankFoods,
  getStemVariants,
  tokenMatchesText,
  scoreFoodMatch,
} from "../modules/nutrition/food_search";

const root = path.resolve(__dirname, "..");
const genericFoods = JSON.parse(
  fs.readFileSync(path.join(root, "data/generic_foods.json"), "utf8"),
).foods;
const foodTranslations = JSON.parse(
  fs.readFileSync(path.join(root, "data/food_names.json"), "utf8"),
);

function search(q: string, lang = "en") {
  return filterAndRankFoods(genericFoods, q, {
    language: lang,
    foodTranslations,
  }).items;
}

console.log("=== Testing Stemming & Word Variants ===");
assert.deepEqual(getStemVariants("eggs"), ["eggs", "egg"]);
assert.deepEqual(getStemVariants("egg"), ["egg", "eggs"]);
assert.deepEqual(getStemVariants("apples"), ["apples", "apple"]);
assert.deepEqual(getStemVariants("berries"), ["berries", "berry"]);
assert.deepEqual(getStemVariants("tomatoes"), ["tomatoes", "tomato"]);
assert.deepEqual(getStemVariants("potatoes"), ["potatoes", "potato"]);
console.log("Stemming tests passed!");

console.log("=== Testing Word-Boundary Matching ===");
assert.equal(tokenMatchesText("Boiled egg", "egg"), true);
assert.equal(tokenMatchesText("Egg — raw", "egg"), true);
assert.equal(tokenMatchesText("Egg — raw", "eggs"), true);
assert.equal(tokenMatchesText("Eggplant, raw", "egg"), false, "Eggplant should not match egg");
assert.equal(tokenMatchesText("Aubergine — raw", "egg"), false, "Aubergine should not match egg");
assert.equal(tokenMatchesText("Boiled egg", "oil"), false, "Boiled egg should not match oil");
assert.equal(tokenMatchesText("Olive oil", "oil"), true);
assert.equal(tokenMatchesText("Steamed broccoli", "tea"), false, "Steamed should not match tea");
assert.equal(tokenMatchesText("Pear", "pea"), false, "Pear should not match pea");
assert.equal(tokenMatchesText("Split peas — boiled", "pea"), true, "Split peas should match pea");
console.log("Word-boundary matching tests passed!");

console.log("=== Testing Egg Searches ===");
const eggResults = search("egg");
console.log("Search 'egg':", eggResults.slice(0, 6).map((f: any) => f.name));
assert.equal(eggResults[0].name, "Egg — raw", "Egg — raw should be #1 for 'egg'");
assert(eggResults.slice(0, 6).some((f: any) => f.name === "Boiled egg"));
assert(eggResults.slice(0, 6).some((f: any) => f.name === "Scrambled egg"));
assert(eggResults.slice(0, 6).some((f: any) => f.name === "Fried egg"));
assert(eggResults.slice(0, 6).some((f: any) => f.name === "Poached egg"));
assert(eggResults.slice(0, 6).some((f: any) => f.name === "Egg white — raw"));
assert(!eggResults.some((f: any) => f.name.includes("Aubergine")), "Aubergine must NOT be returned for 'egg'");

const eggsResults = search("eggs");
console.log("Search 'eggs':", eggsResults.slice(0, 6).map((f: any) => f.name));
assert.equal(eggsResults[0].name, "Egg — raw", "Egg — raw should be #1 for 'eggs'");
assert(eggsResults.length >= 6);

const wholeEggResults = search("whole egg");
console.log("Search 'whole egg':", wholeEggResults.slice(0, 3).map((f: any) => f.name));
assert.equal(wholeEggResults[0].name, "Egg — raw");

const boiledEggResults = search("boiled egg");
console.log("Search 'boiled egg':", boiledEggResults.slice(0, 3).map((f: any) => f.name));
assert.equal(boiledEggResults[0].name, "Boiled egg");

const hardBoiledEggResults = search("hard boiled egg");
console.log("Search 'hard boiled egg':", hardBoiledEggResults.slice(0, 3).map((f: any) => f.name));
assert.equal(hardBoiledEggResults[0].name, "Boiled egg");

const scrambledEggsResults = search("scrambled eggs");
console.log("Search 'scrambled eggs':", scrambledEggsResults.slice(0, 3).map((f: any) => f.name));
assert.equal(scrambledEggsResults[0].name, "Scrambled egg");

const friedEggResults = search("fried egg");
console.log("Search 'fried egg':", friedEggResults.slice(0, 3).map((f: any) => f.name));
assert.equal(friedEggResults[0].name, "Fried egg");

const sunnySideUpResults = search("sunny side up");
console.log("Search 'sunny side up':", sunnySideUpResults.slice(0, 3).map((f: any) => f.name));
assert.equal(sunnySideUpResults[0].name, "Fried egg");

const eggWhiteResults = search("egg white");
console.log("Search 'egg white':", eggWhiteResults.slice(0, 3).map((f: any) => f.name));
assert.equal(eggWhiteResults[0].name, "Egg white — raw");

const eggWhitesResults = search("egg whites");
console.log("Search 'egg whites':", eggWhitesResults.slice(0, 3).map((f: any) => f.name));
assert.equal(eggWhitesResults[0].name, "Egg white — raw");

console.log("=== Testing Other Common Food Queries ===");
const oatmeal = search("oatmeal");
assert.equal(oatmeal[0].name, "Rolled oats — dry");

const yoghurt = search("yoghurt");
assert(yoghurt[0].name.toLowerCase().includes("yogurt"));

const pb = search("pb");
assert.equal(pb[0].name, "Peanut butter — smooth, unsalted");

const eggplant = search("eggplant");
assert.equal(eggplant[0].name, "Aubergine — raw");

const oil = search("oil");
assert(!oil.some((f: any) => f.name.includes("Boiled egg")), "Oil search must NOT include boiled egg!");

const apples = search("apples");
assert.equal(apples[0].name, "Apple");

const bananas = search("bananas");
assert.equal(bananas[0].name, "Banana");

const potatoes = search("potatoes");
assert(potatoes[0].name.toLowerCase().includes("potato"));

const tomatoes = search("tomatoes");
assert(tomatoes[0].name.toLowerCase().includes("tomato"));

const berries = search("berries");
assert(berries.some((f: any) => f.name === "Blueberries"));
assert(berries.some((f: any) => f.name === "Strawberries"));

const berry = search("berry");
assert(berry.some((f: any) => f.name === "Blueberries"));
assert(berry.some((f: any) => f.name === "Strawberries"));

console.log("All food search tests passed successfully!");
