import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {MealType, NutritionCategory, Prisma} from '@prisma/client';
import prisma from '../config/prisma';
import redis from '../config/redis';

const root=path.resolve(__dirname,'..');
type SourceRow=Record<string,unknown>;
const file=JSON.parse(fs.readFileSync(path.join(root,'data/food_sources/ciqual-2025.raw.json'),'utf8')) as {checksum:string;foods:SourceRow[]};
assert.equal(file.checksum,'a953e8c473d8cee24a32f89a48fbd54d');
assert.equal(file.foods.length,3484);
const columns={caloriesPerServing:'Energy, Regulation EU No 1169 2011 (kcal 100g)',proteinPerServing:'Protein (g 100g)',
  carbsPerServing:'Carbohydrate (g 100g)',fatPerServing:'Fat (g 100g)',fiberPerServing:'Fibres (g 100g)',
  sugarPerServing:'Sugars (g 100g)',sodiumPerServing:'Sodium (mg 100g)'} as const;
const clean=(v:unknown)=>typeof v==='string'?v.replace(/\s+/g,' ').trim():'';
function number(v:unknown):number|null {
  if(typeof v==='number')return Number.isFinite(v)&&v>=0?v:null;
  const text=clean(v);
  // Missing, trace-only and less-than bounds are NOT measured zeroes.
  if(!/^\d+(?:[.,]\d+)?$/.test(text))return null;
  return Number(text.replace(',','.'));
}
function category(row:SourceRow):NutritionCategory {
  const group=clean(row.alim_grp_nom_eng).toLowerCase(), sub=clean(row.alim_ssgrp_nom_eng).toLowerCase();
  if(group==='starters and dishes')return 'MEAL';
  if(group==='cereal products')return 'CARB_SOURCE';
  if(group==='meat, egg and fish')return 'PROTEIN_SOURCE';
  if(group==='milk and milk products')return 'DAIRY';
  if(group==='fats and oils')return 'FAT_SOURCE';
  if(group==='beverages')return 'BEVERAGE';
  if(group==='fruits, vegetables, legumes and nuts') {
    if(sub==='fruits')return 'FRUIT';
    if(sub==='vegetables')return 'VEGETABLE';
    if(sub==='potatoes and other tubers')return 'CARB_SOURCE';
    if(sub.includes('legume'))return 'PROTEIN_SOURCE';
    if(sub.includes('nut')||sub.includes('seed'))return 'FAT_SOURCE';
  }
  return 'OTHER';
}
function id(code:string) {
  const bytes=createHash('sha256').update(`fitai:ciqual:2025:${code}`).digest().subarray(0,16);
  bytes[6]=(bytes[6]!&15)|80;bytes[8]=(bytes[8]!&63)|128;
  const hex=bytes.toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
const rejected:Array<{code:string;name:string;reason:string}>=[];
const prepared:Prisma.NutritionCreateManyInput[]=[];
const codes=new Set<string>();
for(const row of file.foods) {
  const code=clean(row.alim_code),name=clean(row.alim_nom_eng);
  const reject=(reason:string)=>rejected.push({code,name,reason});
  if(!code||!name) {reject('missing identity');continue;}
  assert(!codes.has(code),'Duplicate source food code');codes.add(code);
  if(clean(row.alim_grp_nom_eng)==='baby food') {reject('outside adult app catalogue');continue;}
  const nutrients=Object.fromEntries(Object.entries(columns).map(([key,column])=>[key,number(row[column])])) as Record<keyof typeof columns,number|null>;
  if(Object.values(nutrients).some(v=>v===null)) {reject('missing, trace-only or bounded nutrient');continue;}
  const n=nutrients as Record<keyof typeof columns,number>;
  if(n.caloriesPerServing>1000 || ['proteinPerServing','carbsPerServing','fatPerServing','fiberPerServing','sugarPerServing'].some(k=>n[k as keyof typeof n]>100)
    || n.proteinPerServing+n.carbsPerServing+n.fatPerServing>105 || n.sodiumPerServing>40000) {reject('unsupported per-100g values');continue;}
  prepared.push({id:id(code),name,category:category(row),servingSize:100,servingUnit:'g',...n,
    mealTypes:Object.values(MealType),isVerified:true,imageUrl:null,barcode:null,brand:null,
    sourceName:'ANSES_CIQUAL',sourceFoodCode:code,sourceVersion:'2025',sourceUrl:'https://doi.org/10.5281/zenodo.17550133',
    sourceDetails:{attribution:'Anses. 2025. Ciqual French food composition table',license:'Open Licence',
      basis:'100 g edible portion',sodiumUnit:'mg',foodGroup:clean(row.alim_grp_nom_eng),foodSubgroup:clean(row.alim_ssgrp_nom_eng),
      rawNutrients:Object.fromEntries(Object.entries(columns).map(([key,column])=>[key,String(row[column])])),
      // Keep actual identity/preparation descriptions. Source averages are not brand labels.
      referenceComposition:true,imageStatus:'not_provided'}});
}
async function main() {
  const apply=process.argv.includes('--apply');
  const summary={sourceRows:file.foods.length,eligible:prepared.length,skipped:rejected.length,
    categories:prepared.reduce<Record<string,number>>((a,r)=>(a[r.category]=(a[r.category]??0)+1,a),{}),
    examples:prepared.filter(r=>['9103','36032','9313'].includes(r.sourceFoodCode!)).map(r=>({name:r.name,calories:r.caloriesPerServing,protein:r.proteinPerServing}))};
  fs.writeFileSync(path.join(root,'data/food_sources/ciqual-2025.import-plan.json'),JSON.stringify({summary,rejected},null,2));
  console.log(JSON.stringify(summary,null,2));
  if(!apply) {console.log('Dry run only. Use --apply to add the validated rows.');return;}
  const result=await prisma.$transaction(async tx=> {
    // An additive import: never update, replace or delete existing user/catalogue rows.
    const before=await tx.nutrition.findMany({orderBy:{id:'asc'}});
    const logsBefore=await tx.userMealLog.findMany({orderBy:{id:'asc'}});
    const inserted=await tx.nutrition.createMany({data:prepared,skipDuplicates:true});
    const after=await tx.nutrition.findMany({where:{id:{in:before.map(r=>r.id)}},orderBy:{id:'asc'}});
    assert.deepEqual(after,before,'Existing food entries changed');
    assert.deepEqual(await tx.userMealLog.findMany({orderBy:{id:'asc'}}),logsBefore,'Existing logs changed');
    const sourceRows=await tx.nutrition.findMany({where:{sourceName:'ANSES_CIQUAL',sourceVersion:'2025'}});
    for(const expected of prepared) {
      const actual=sourceRows.find(r=>r.sourceFoodCode===expected.sourceFoodCode);assert(actual,'Imported food missing');
      for(const key of Object.keys(columns) as Array<keyof typeof columns>)assert.equal(actual[key],expected[key],`${actual.name}: ${key}`);
      assert.equal(actual.servingSize,100);assert.equal(actual.servingUnit,'g');assert.equal(actual.imageUrl,null);
    }
    return {inserted:inserted.count,alreadyPresent:prepared.length-inserted.count,sourceFoods:sourceRows.length,
      preservedExistingFoods:before.length,preservedExistingLogs:logsBefore.length};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:60000});
  // Invalidate only shared catalogue caches. User log caches are unchanged.
  let cacheCleared=true;
  try {const keys=await redis.keys('nutrition_items:*');if(keys.length)await redis.del(...keys);}
  catch {cacheCleared=false;}
  fs.writeFileSync(path.join(root,'data/food_sources/ciqual-2025.import-result.json'),JSON.stringify({importedAt:new Date().toISOString(),...result,cacheCleared},null,2));
  console.log(JSON.stringify({...result,cacheCleared},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>prisma.$disconnect());
