import fs from 'node:fs';
import prisma from '../config/prisma';
import { contentLocale, APP_LANGUAGES } from '../utils/app_locale';
async function main() {
  const source=JSON.parse(fs.readFileSync('data/exercise_catalog.app.json','utf8'));
  const rows=await prisma.workout.findMany({select:{id:true,exerciseCode:true,namesByLang:true,instructionsByLang:true,instructionStepsByLang:true,videoUrl:true,thumbnailUrl:true}});
  const byCode=new Map(rows.map(row=>[row.exerciseCode,row]));
  const absoluteMedia=(value:string|null)=>value && !/^https?:\/\//.test(value)
    ? `${process.env.EXERCISE_VIDEO_BASE_URL?.replace(/\/+$/,'')}/${value.replace(/^\/+/, '')}`
    : value;
  const languages=[...new Set(APP_LANGUAGES.map(contentLocale))];
  for(const original of source) {
    const row=byCode.get(original.id);
    if(!row) throw new Error(`Missing catalogue code ${original.id}`);
    if(row.videoUrl!==original.gif_url||absoluteMedia(row.thumbnailUrl)!==absoluteMedia(original.image)) throw new Error(`Media mismatch ${original.id}`);
    for(const language of languages) {
      if(!(row.namesByLang as any)?.[language] || !(row.instructionStepsByLang as any)?.[language]?.length) throw new Error(`Missing database translation ${original.id}/${language}`);
    }
    for(const field of [row.namesByLang,row.instructionsByLang,row.instructionStepsByLang]) {
      if(Object.keys(field as object).some(language=>!languages.includes(language))) throw new Error(`Unsupported translation stored ${original.id}`);
    }
  }
  console.log(JSON.stringify({importedCatalogue:source.length,allCatalogueAndLegacyRows:rows.length,
    rowsWithLocalizedNames:rows.filter(row=>languages.every(language=>(row.namesByLang as any)?.[language])).length,
    verifiedBaseLanguages:languages,verifiedExactMediaPaths:true,
    plans:await prisma.userWorkout.count(),workoutItems:await prisma.userWorkoutItem.count(),setLogs:await prisma.workoutSetLog.count()}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());
