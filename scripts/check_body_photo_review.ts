import 'dotenv/config';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import prisma from '../config/prisma';
import {VIEWS} from '../modules/body/body_types';
import {decodePhotos,metricsFromVisual} from '../modules/body/body_engine';
import {analyzeBodyPhotos} from '../modules/body/body_vision';
import {stopBodyPoseWorker} from '../modules/body/body_pose';
import {getTrainingMap} from '../modules/heatmap/training_map_service';

// Explicitly invoked diagnostic using the user's authorized local photos.
// Local extraction followed by numeric coaching; visual context requires an explicit opt-in flag.
// Stored profile weight is context for this test, not a new recorded measurement.
// No database writes, raw photos, body measurements, prompts or credentials are logged.
async function main() {
  const email=process.env.BODY_REVIEW_TEST_EMAIL;
  if(!email) throw new Error('Set BODY_REVIEW_TEST_EMAIL to the consenting test account.');
  const user=await prisma.user.findUnique({where:{email},select:{id:true,onboarding:{select:{age:true,height:true,gender:true,workingToward:true,weight:true,experience:true,focusMuscles:true,limitations:true,equipment:true}}}});
  if(!user?.onboarding) throw new Error('Test profile not found.');
  const weight = user.onboarding.weight;
  if (weight == null) throw new Error("Photo measurement diagnostic needs a saved body weight.");
  const photos=decodePhotos(await Promise.all(VIEWS.map(async view=>({view,mimeType:'image/jpeg',base64:(await readFile(`bodyimages/${view}.jpeg`)).toString('base64')}))));
  const offset=Number(process.env.BODY_REVIEW_TEST_UTC_OFFSET_MINUTES??330);
  const date=new Date(Date.now()+offset*60000).toISOString().slice(0,10);
  const training=await getTrainingMap(user.id,date,offset);
  const analysis=await analyzeBodyPhotos(photos,user.onboarding,weight,training.regions.map(r=>({id:r.id,completedSets:r.completedSets,targetSets:r.targetSets,soreness:r.soreness})),
    {visualCoaching:process.env.BODY_REVIEW_TEST_VISUAL_COACHING==='true'});
  const {result,modelVersion}=analysis;
  if(!result.usable) {console.log(JSON.stringify({usable:false,modelVersion,qualityNotes:result.qualityNotes}));return;}
  const metrics=analysis.measurementMetrics ?? metricsFromVisual(result,weight);
  console.log(JSON.stringify({usable:true,modelVersion,coachingModel:analysis.coachingModel,focusStatus:analysis.focusStatus,focusBasis:analysis.focusBasis,regionalGuidanceCount:analysis.regionalGuidance?.length??0,estimatedFields:Object.keys(metrics).filter(key=>key!=='weightKg'),observedRegions:result.observations.map(note=>note.region),photoInsights:analysis.physiqueAssessment?.regions.map(r=>({region:r.region,status:r.appearanceStatus,views:r.visualEvidenceViews})),processing:analysis.processing,qualityNotes:result.qualityNotes}));
  if(analysis.focusStatus!=='ready') throw new Error('Live coaching check did not complete. Baseline extraction succeeded.');
  if(process.env.BODY_REVIEW_TEST_SAVE_REPORT==='true') {
    await mkdir('body_diagnostics',{recursive:true});
    await writeFile('body_diagnostics/physique-report.json',JSON.stringify({timestamp:new Date().toISOString(),
      userProfile:user.onboarding,measurementAnalysis:{engine:modelVersion,availableMeasurements:metrics,
        unavailableMeasurements:['chestCm','waistCm','hipsCm','leftArmCm','rightArmCm','leftThighCm','rightThighCm','leftCalfCm','rightCalfCm','neckCm'].filter(k=>!(k in metrics)),qualityNotes:result.qualityNotes},
      physiqueAssessment:analysis.physiqueAssessment,bodyComposition:{status:'not_validated',method:null},
      trainingDirection:{summary:result.summary,extraEmphasis:result.observations,regions:analysis.regionalGuidance},processing:analysis.processing},null,2));
    console.log('Private structured report written to body_diagnostics/physique-report.json. No database changes.');
  }
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Photo check failed.');process.exitCode=1;}).finally(()=>{stopBodyPoseWorker();return prisma.$disconnect();});
