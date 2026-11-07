"""Reproducible, offline curation from official unbranded reference records.

Never estimates nutrients, treats missing values as zero, or relabels brands.
The source snapshots and their checksums are retained in data/food_sources.
"""
from pathlib import Path
import copy
import csv
import hashlib
import json
import re
import zipfile
import zlib

ROOT = Path(__file__).resolve().parents[1]
BASE = json.loads((ROOT / "data/everyday_foods.json").read_text(encoding="utf-8"))
CIQUAL = json.loads((ROOT / "data/food_sources/ciqual-2025.raw.json").read_text(encoding="utf-8"))
assert CIQUAL["checksum"] == "a953e8c473d8cee24a32f89a48fbd54d"
SR_PATH = ROOT / "data/food_sources/usda-sr-2018.json"
SR_ZIP = ROOT / "data/food_sources/usda-sr-2018.zip"
assert hashlib.sha256(SR_ZIP.read_bytes()).hexdigest() == BASE["sources"][0]["sha256"]
with zipfile.ZipFile(SR_ZIP) as archive:
    original = next(info for info in archive.infolist() if info.filename.endswith(".json"))
    assert zlib.crc32(SR_PATH.read_bytes()) == original.CRC, "USDA extraction differs from source ZIP"
SR = json.loads(SR_PATH.read_text(encoding="utf-8"))["SRLegacyFoods"]
CIQUAL_ROWS = {str(row["alim_code"]): row for row in CIQUAL["foods"]}
SR_ROWS = {str(row["fdcId"]): row for row in SR}
COLS = {
    "caloriesPerServing": "Energy, Regulation EU No 1169 2011 (kcal 100g)",
    "proteinPerServing": "Protein (g 100g)", "carbsPerServing": "Carbohydrate (g 100g)",
    "fatPerServing": "Fat (g 100g)", "fiberPerServing": "Fibres (g 100g)",
    "sugarPerServing": "Sugars (g 100g)", "sodiumPerServing": "Sodium (mg 100g)",
}
USDA_COLS = dict(zip(COLS, [1008, 1003, 1005, 1004, 1079, 2000, 1093]))

def number(value):
    text = str(value).strip()
    assert re.fullmatch(r"\d+(?:[.,]\d+)?", text), f"Missing/bounded nutrient: {value!r}"
    return float(text.replace(",", "."))

def identity(source, code):
    seed = f"fitai:ciqual:2025:{code}" if source == "ANSES_CIQUAL" else f"setcraft:generic-foods:v1:{source}:{code}"
    bits = bytearray(hashlib.sha256(seed.encode()).digest()[:16])
    bits[6] = (bits[6] & 15) | 80
    bits[8] = (bits[8] & 63) | 128
    text = bits.hex()
    return f"{text[:8]}-{text[8:12]}-{text[12:16]}-{text[16:20]}-{text[20:]}"

def image_query(name):
    name = name.split(" — ")[0]
    return re.sub(r"\b(?:whole-milk|low-fat|fat-free|plain|unsweetened|salted|unsalted|large|farm(?:ed)?)\b|\d+(?:\.\d+)?%?", " ", name, flags=re.I).strip()

foods = copy.deepcopy(BASE["foods"])
for food in foods:
    food["brand"] = None
    food["barcode"] = None
    food["sourceDetails"]["catalog"] = "generic-300-v1"
    food["sourceDetails"]["imageSearch"] = image_query(food["name"])
    food["sourceDetails"]["referenceComposition"] = True

specs = list(csv.DictReader((ROOT / "data/generic_food_additions.tsv").open(encoding="utf-8"), delimiter="\t"))
assert len(specs) == 119, len(specs)
for spec in specs:
    source, code = spec["source"], spec["code"]
    details = {"catalog": "generic-300-v1", "referenceComposition": True,
               "basis": "100 g edible portion", "imageSearch": spec["imageSearch"]}
    if source == "ANSES_CIQUAL":
        row = CIQUAL_ROWS[code]
        nutrient_values = {key: number(row[column]) for key, column in COLS.items()}
        source_version = "2025"
        url = "https://doi.org/10.5281/zenodo.17550133"
        details.update(attribution="Anses. 2025. Ciqual French food composition table", license="Open Licence",
                       sourceDescription=re.sub(r"\s+", " ", row["alim_nom_eng"]),
                       carbohydrateMethod="Ciqual published carbohydrate (separate from fibre)",
                       rawNutrients={key: row[column] for key, column in COLS.items()})
    else:
        row = SR_ROWS[code]
        assert "brandOwner" not in row and "brandName" not in row
        nutrients = {n["nutrient"]["id"]: n.get("amount") for n in row["foodNutrients"]}
        nutrient_values = {key: number(nutrients.get(nutrient)) for key, nutrient in USDA_COLS.items()}
        source_version = "2018"
        url = f"https://fdc.nal.usda.gov/food-details/{code}/nutrients"
        details.update(attribution="USDA FoodData Central", license="Public domain", dataType="SR Legacy",
                       sourceDescription=row["description"],
                       carbohydrateMethod="USDA carbohydrate by difference; includes dietary fibre",
                       rawNutrients=[{"id": n, "amount": nutrients[n]} for n in USDA_COLS.values()])
    food = {"id": identity(source, code), "name": spec["name"], "category": spec["category"],
            "brand": None, "barcode": None, "servingSize": 100, "servingUnit": "g", **nutrient_values,
            "sourceName": source, "sourceFoodCode": code, "sourceVersion": source_version,
            "sourceUrl": url, "sourceDetails": details}
    if food["name"] == "Whey protein":
        details["referenceNote"] = "Generic whey-based protein powder. Actual products and scoop weights vary; use a package label for product-specific logging."
        details["portions"] = [{"unit": "portion", "label": "portion (30 g)", "gramsPerUnit": 30}]
        details["defaultPortionUnit"] = "portion"
    foods.append(food)

assert len(foods) == 300
assert len({food["name"].lower() for food in foods}) == 300
assert len({food["id"] for food in foods}) == 300
assert len({(food["sourceName"], food["sourceFoodCode"], food["sourceVersion"]) for food in foods}) == 300
for food in foods:
    assert not food["brand"] and not food["barcode"]
    assert all(0 <= food[column] <= (40000 if column == "sodiumPerServing" else 1000 if column == "caloriesPerServing" else 100) for column in COLS), food["name"]

catalog = {"version": "generic-300-v1", "foods": foods, "sources": BASE["sources"]}
target = ROOT / "data/generic_foods.json"
target.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"Prepared {len(foods)} generic foods in {target}")
