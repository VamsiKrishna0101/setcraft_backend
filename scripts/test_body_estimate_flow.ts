import assert from "node:assert/strict";
import { analyzeBodyPhotos, BodyAnalysisStage } from "../modules/body/body_vision";
import { reviewSchema } from "../modules/body/body_types";
import { decodePhotos } from "../modules/body/body_engine";
import { BodyCoachingError } from "../modules/body/body_coaching";
import { MUSCLE_IDS } from "../modules/heatmap/training_map_engine";

async function main() {
  const originalKey=process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY="synthetic-test-key";
  const photos=decodePhotos((["front","back","left","right"] as const).map((view,i)=>({
    view,mimeType:"image/png",base64:Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(100,i)]).toString("base64")})));
  const profile={height:175,age:25,gender:"MALE",workingToward:"BUILD_MUSCLE"};
  let coachingCalls=0,receivedPhotos=0;
  const stages:BodyAnalysisStage[]=[];
  const dependencies={
    measure:async()=>({usable:true,metrics:{},qualityNotes:["Chest outline is obstructed."],modelVersion:"synthetic-pose",elapsedMs:10}),
    coach:async(metrics:unknown,_profile:unknown,_training?:unknown,sentPhotos:typeof photos=[])=>{
      assert.deepEqual(metrics,{},"Missing measurements must not be fabricated");
      coachingCalls++;receivedPhotos=sentPhotos.length;
      return {summary:"A goal-aligned focus.",observations:[{region:"chest" as const,observation:"Build a consistent routine.",confidence:"low" as const,kind:"suggested_focus",basis:"profile_goal" as const}],
        regionalGuidance:MUSCLE_IDS.map(region=>({region,status:region==="chest"?"focus" as const:"unknown" as const,reason:"Synthetic guidance",basis:"profile_goal" as const})),modelVersion:"synthetic-coach",
        physiqueAssessment:{version:'physique-v2' as const,model:'synthetic-coach',photosUsed:sentPhotos.length,overview:'Synthetic overview',
          regions:MUSCLE_IDS.map(region=>({region,appearanceStatus:sentPhotos.length?'observed' as const:'not_provided' as const,
            visualObservation:sentPhotos.length?'Synthetic outline observation':'No photo supplied.',
            visualEvidenceViews:sentPhotos.length?['front' as const]:[],trainingDirection:'Synthetic direction',basis:'profile_goal',limitations:[]}))}};
    }
  };
  try {
    const input={recordedDate:"2026-10-07",utcOffsetMinutes:330,weightKg:75,consentToPhotoAnalysis:true as const,analysisProvider:"OPENAI" as const,
      photos:photos.map(p=>({view:p.view,mimeType:p.mimeType as "image/png",base64:p.data.toString("base64")}))};
    assert.equal(reviewSchema.parse(input).consentToVisualCoaching,false,"Existing numeric-only consent must not authorize sending photos to AI");
    assert.equal(reviewSchema.parse({...input,consentToVisualCoaching:true}).consentToVisualCoaching,true);
    const numeric=await analyzeBodyPhotos(photos,profile,75,[],{onStage:s=>stages.push(s)},dependencies);
    assert.equal(coachingCalls,1,"Empty measurement results must still reach coaching");assert.equal(receivedPhotos,0);
    assert.equal(numeric.focusStatus,"ready");assert.equal(numeric.result.observations.length,1);
    assert.equal(numeric.regionalGuidance?.length,13);
    assert.equal(numeric.physiqueAssessment?.photosUsed,0);
    assert(numeric.physiqueAssessment?.regions.every(r=>r.appearanceStatus==='not_provided'));
    assert(numeric.processing!.measurementMs>=0 && numeric.processing!.aiMs>=0 && numeric.processing!.totalMs>=numeric.processing!.measurementMs);
    assert.deepEqual(stages,["outlines","focus"]);assert.deepEqual(numeric.measurementMetrics,{});
    const visual=await analyzeBodyPhotos(photos,profile,75,[],{visualCoaching:true},dependencies);
    assert.equal(receivedPhotos,4);assert.equal(visual.focusBasis,"photos_profile_and_training");
    assert.equal(visual.physiqueAssessment?.regions.length,13);assert.equal(visual.physiqueAssessment?.photosUsed,4);
    const fallback=await analyzeBodyPhotos(photos,profile,75,[],{visualCoaching:true},{...dependencies,
      coach:async(...args:Parameters<typeof dependencies.coach>)=>{if(args[3]?.length)throw new Error("Synthetic visual outage");return dependencies.coach(...args);}});
    assert.equal(fallback.focusStatus,"ready");assert.equal(fallback.focusBasis,"profile_measurements_and_training");
    assert.equal(fallback.physiqueAssessment?.photosUsed,0,'Fallback cannot pretend photos were analyzed');
    assert(fallback.result.qualityNotes.some(note=>note.startsWith("Photo context was unavailable.")));
    let limitedCalls=0;
    const limited=await analyzeBodyPhotos(photos,profile,75,[],{visualCoaching:true},{...dependencies,
      coach:async()=>{limitedCalls++;throw new BodyCoachingError("rate_limited",false);}});
    assert.equal(limitedCalls,1,"Rate limits must not trigger an additional context fallback");
    assert.equal(limited.focusUnavailableReason,"rate_limited");assert.equal(limited.focusStatus,"unavailable");
    assert(limited.result.summary.includes("request limit"));
    const unavailable=await analyzeBodyPhotos(photos,profile,75,[],{}, {...dependencies,coach:async()=>{throw new Error("Synthetic provider outage");}});
    assert.equal(unavailable.focusStatus,"unavailable");assert.deepEqual(unavailable.result.observations,[]);
    await assert.rejects(()=>analyzeBodyPhotos(photos,profile,75,[],{}, {...dependencies,measure:async()=>({...await dependencies.measure(),usable:false,qualityNotes:["Retake the back view."]})}),/Retake the back view/);
    delete process.env.OPENAI_API_KEY;
    const offline=await analyzeBodyPhotos(photos,profile,75,[],{},dependencies);
    assert.equal(offline.focusStatus,"unavailable");assert.deepEqual(offline.result.observations,[]);
    console.log("Estimate flow checks passed: empty metrics, progress stages, explicit visual consent, retakes and provider outages. No external AI or database writes.");
  } finally {if(originalKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=originalKey;}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
