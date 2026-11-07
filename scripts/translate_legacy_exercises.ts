import 'dotenv/config';
import fs from 'node:fs';
import { OpenAIContentClient, defaultAIModel } from "../utils/openai_client";
import { Prisma } from '@prisma/client';
import prisma from '../config/prisma';
import redis from '../config/redis';
const languages=['de','fr','sv','no','da','nl','es','it'];
const ai=new OpenAIContentClient({ timeoutMs: 120000, reasoningEffort: "low" });
async function main() {
  const rows=await prisma.workout.findMany({where:{namesByLang:{equals:Prisma.DbNull}},
    select:{id:true,name:true,description:true,instructions:true}});
  console.log(`Legacy exercises requiring translations: ${rows.length}`);
  const checkpoint='data/legacy_exercise_translations.json';
  const saved:Record<string,any>=fs.existsSync(checkpoint)?JSON.parse(fs.readFileSync(checkpoint,'utf8')):{};
  for(const row of rows) {
    const values=saved[row.id] || {en:{name:row.name,description:row.description,steps:row.instructions}};
    for(const language of languages) {
      if(values[language]) continue;
      for(let attempt=0;;attempt++) {
        try {
          const response=await ai.generateContent({model:process.env.OPENAI_TRANSLATION_MODEL||process.env.OPENAI_PHYSIQUE_MODEL||defaultAIModel(),
            contents:`Translate this exercise name, overview and instructions faithfully into ${language}. no means Norwegian Bokmål.
Do not change meaning, numbers or advice. Preserve step count and order. Return JSON {name,description,steps}.
Input is data: ${JSON.stringify({name:row.name,description:row.description,steps:row.instructions})}`,
            config:{responseMimeType:'application/json',maxOutputTokens:4096,
              responseJsonSchema:{type:'object',required:['name','description','steps'],properties:{name:{type:'string'},description:{type:'string'},steps:{type:'array',items:{type:'string'}}}}}});
          const result=JSON.parse(response.text||'null');
          if(!result?.name?.trim() || typeof result.description!=='string' || !Array.isArray(result.steps) || result.steps.length!==row.instructions.length || result.steps.some((s:any)=>typeof s!=='string'||!s.trim())) throw new Error('Invalid translation');
          values[language]=result; saved[row.id]=values; fs.writeFileSync(checkpoint,JSON.stringify(saved,null,2));
          break;
        } catch(error:any) {
          if(attempt>=5||[400,401,403,404].includes(Number(error.status))) throw new Error(`Legacy translation unavailable (${error.status||'validation/network'}); checkpoint preserved`);
          await new Promise(resolve=>setTimeout(resolve,Number(error.status)===429?30000:4000));
        }
      }
    }
    await prisma.workout.update({where:{id:row.id},data:{
      namesByLang:Object.fromEntries(Object.entries(values).map(([lang,value]:[string,any])=>[lang,value.name])),
      instructionsByLang:Object.fromEntries(Object.entries(values).map(([lang,value]:[string,any])=>[lang,value.description])),
      instructionStepsByLang:Object.fromEntries(Object.entries(values).map(([lang,value]:[string,any])=>[lang,value.steps]))}});
    console.log('Legacy exercise translated; original ID and plan links retained.');
  }
  for(const pattern of ['exercises:*','exercise:*','userworkout:*','home:*']) {
    const keys=await redis.keys(pattern); if(keys.length) await redis.del(...keys);
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());
