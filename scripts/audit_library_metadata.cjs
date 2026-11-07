// Learn only unambiguous public source-ID labels from confirmed existing identities.
// Contradictions are held for review, never silently "corrected" or fuzzy-matched.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve('build/exercise-library-v2');
const read=n=>JSON.parse(fs.readFileSync(path.join(root,n),'utf8'));
const plan=read('plan.json');
const norm=s=>String(s).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const alias=value=>{
 const s=norm(value);return ({'bodyweight':'body weight','leverage':'leverage machine','smith':'smith machine','machine':'leverage machine','abs':'abdominals','pectorals':'chest','pectoral':'chest','deltoids':'delts','shoulders':'delts','upper back':'upper back','quads':'quadriceps','spine':'spinal erectors','erector spinae':'spinal erectors','levator scapulae':'upper back','traps':'upper back','serratus anterior':'serratus anterior','calf':'calves'})[s]||s;
};
const ids=value=>{try{const a=typeof value==='string'?JSON.parse(value):value;return Array.isArray(a)?a.map(String):[];}catch{return [];}};
function equipmentCompatible(expected,actual){
 const value=alias(actual);
 // Source IDs describe resistance classes; bodyweight can still require a bench/bar.
 if(expected==='body weight')return ['body weight','resistance machine','leverage machine','suspension trainer','pull up bar','dip bars','roman chair','bench'].includes(value);
 if(expected==='weighted')return !['body weight','band','cardio machine'].includes(value);
 if(expected==='sled machine')return ['sled machine','resistance machine','leverage machine','leg press machine','hack squat machine'].includes(value);
 if(expected==='ez barbell')return ['ez barbell','ez bar','barbell'].includes(value);
 return value===expected;
}
const muscleFamily=value=>{const v=alias(value);return ['abdominals','obliques','core'].includes(v)?'core':v;};
function learn(field,existingField){
 const evidence=new Map();
 for(const group of plan.groups){const unique=[...new Map(group.existing.map(w=>[w.exerciseCode,w])).values()];
  for(const row of group.publicMetadata){const values=ids(row[field]);if(values.length!==1)continue;for(const old of unique){const label=alias(old[existingField]||'');if(!label)continue;const key=values[0];if(!evidence.has(key))evidence.set(key,new Map());const labels=evidence.get(key);if(!labels.has(label))labels.set(label,new Set());labels.get(label).add(old.id);}}
 }
 const result={};for(const [id,labels] of evidence){const ranked=[...labels].map(([label,set])=>({label,support:set.size})).sort((a,b)=>b.support-a.support);const total=ranked.reduce((n,r)=>n+r.support,0);if(ranked[0].support>=5&&ranked[0].support/total>=.95)result[id]={...ranked[0],total};}return result;
}
const equipment=learn('equipment_id','equipment'),muscles=learn('Target_muscles_id','target');
const holds={},counts={prepared:0,missing:0};
const displayNames=new Map();
const downloaded=read('downloaded.json');
const hashes=new Map(downloaded.videos.map(v=>[v.url,v.sha256]));
const identitiesByHash=new Map();for(const group of plan.groups)for(const source of group.sources){const hash=hashes.get(source.url);if(!identitiesByHash.has(hash))identitiesByHash.set(hash,new Set());identitiesByHash.get(hash).add(group.id);}
for(const group of plan.groups){const file=path.join(root,'content',group.id+'.json');if(!fs.existsSync(file)){counts.missing++;continue;}counts.prepared++;const row=JSON.parse(fs.readFileSync(file));const reasons=[];
 const displayKey=norm(row.translations.en.name).replace(/ /g,'')+'|'+alias(row.equipment);
 if(!displayNames.has(displayKey))displayNames.set(displayKey,[]);displayNames.get(displayKey).push({group,row});
 const knownEquipment=[...new Set(group.publicMetadata.flatMap(r=>ids(r.equipment_id)).map(id=>equipment[id]?.label).filter(Boolean))];
 if(knownEquipment.length===1&&!equipmentCompatible(knownEquipment[0],row.equipment))reasons.push('Equipment conflicts with a source ID supported by confirmed existing movements');
 const knownMuscles=[...new Set(group.publicMetadata.flatMap(r=>ids(r.Target_muscles_id)).map(id=>muscles[id]?.label).filter(Boolean))];
 if(knownMuscles.length&&!row.primaryMuscles.some(m=>knownMuscles.map(muscleFamily).includes(muscleFamily(m))))reasons.push('Primary muscle conflicts with a source ID supported by confirmed existing movements');
 if(row.difficulty==='BEGINNER'&&/barbell.*(quarter|partial|neck|zercher|cossack|kneeling)|one arm.*(push up|pull up)|pistol|planche|snatch/i.test(row.name))reasons.push('Specialized loaded or high-skill variation needs a difficulty review');
 if(/^(exact specialized equipment|specialized equipment|unknown)$/i.test(row.equipment))reasons.push('Required equipment was not identified specifically');
 if(row.primaryMuscles.some(m=>/^(cardio|full body|whole body|muscles|body)$/i.test(m)))reasons.push('A non-specific target label needs anatomical review');
 if(group.publicMetadata.some(r=>r.exercise_type==='bodyweight_assisted')&&row.exerciseType!=='assisted_reps')reasons.push('An assisted source movement was classified as standard external resistance');
 if(group.sources.some(s=>(identitiesByHash.get(hashes.get(s.url))?.size||0)>1))reasons.push('Identical video bytes appear under distinct movement identities; duplicate or variation needs review');
 if(reasons.length)holds[group.id]={name:row.name,reasons};
}
// Identical display labels must not silently turn camera views or lost variations
// into separate, indistinguishable workout choices. Retain only an exact canonical
// name when unambiguous; stage the aliases/variations for deliberate review.
const {normalizeName}=require('./exercise_media_match.cjs');
for(const entries of displayNames.values())if(entries.length>1){
 const canonical=entries.filter(({group,row})=>group.key===normalizeName(row.translations.en.name));
 const keep=canonical.length===1?canonical[0].group.id:null;
 for(const {group,row} of entries)if(group.id!==keep){holds[group.id]??={name:row.name,reasons:[]};holds[group.id].reasons.push('Display name duplicates another source movement; camera alias or lost variation needs review');}
}
fs.writeFileSync(path.join(root,'metadata-audit.json'),JSON.stringify({version:plan.version,counts,equipmentDictionary:equipment,muscleDictionary:muscles,holds},null,2));
console.log(JSON.stringify({...counts,sourceEquipmentIds:Object.keys(equipment).length,sourceMuscleIds:Object.keys(muscles).length,contradictionsHeld:Object.keys(holds).length}));
