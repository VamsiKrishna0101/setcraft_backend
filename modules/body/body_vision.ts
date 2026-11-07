import { BodyError, BodyMetrics, VisualResult } from "./body_types";
import { decodePhotos } from "./body_engine";
import { measureBodyPhotos } from "./body_pose";
import { coachBodyMeasurements, BodyCoachingError, PhysiqueAssessment } from "./body_coaching";
import type {CompositionReadings} from './physique_dashboard';

export type BodyAnalysisStage = "outlines" | "focus" | "saving";
export type BodyAnalysisOptions = { visualCoaching?:boolean; onStage?:(stage:BodyAnalysisStage)=>void; compositionReadings?: CompositionReadings };

export async function analyzeBodyPhotos(photos:ReturnType<typeof decodePhotos>,
  profile:{height:number|null;gender:string;age:number;workingToward:string;weight?:number|null;experience?:string;focusMuscles?:string[];limitations?:string[];equipment?:string[];equipmentIds?:string[];language?:string},
  weightKg:number, training?:unknown, options:BodyAnalysisOptions={}, dependencies={measure:measureBodyPhotos,coach:coachBodyMeasurements}):Promise<{result:VisualResult;modelVersion:string;measurementMetrics?:BodyMetrics;coachingModel?:string|null;elapsedMs?:number;focusStatus?:"ready"|"unavailable";focusBasis?:string;focusUnavailableReason?:string;regionalGuidance?:Awaited<ReturnType<typeof coachBodyMeasurements>>["regionalGuidance"];physiqueAssessment?:PhysiqueAssessment;processing?:{operation:"photo_scan";measurementMs:number;aiMs:number;totalMs:number}}> {
  if (profile.height == null) throw new BodyError(422, "Add your height in Body before requesting measurement estimates.");
  const started=performance.now();
  options.onStage?.("outlines");
  const measured=await dependencies.measure(photos,profile.height);
  const measurementMs=Math.round(performance.now()-started);
  if(!measured.usable) throw new BodyError(422,measured.qualityNotes.join(" "));
  let summary="Your photo baseline is saved. Focus suggestions are unavailable right now.";
  let observations:VisualResult["observations"]=[], coachingModel:string|null=null;
  let focusBasis="profile_measurements_and_training";
  let focusUnavailableReason:string|undefined;
  let regionalGuidance:Awaited<ReturnType<typeof coachBodyMeasurements>>["regionalGuidance"]=[];
  let physiqueAssessment:PhysiqueAssessment|undefined;
  const qualityNotes=[...measured.qualityNotes];
  options.onStage?.("focus");
  const coachingStarted=performance.now();
  if(process.env.OPENAI_API_KEY) {
    try {
      let coached;
      if(options.visualCoaching) {
        try {
          coached=await dependencies.coach(measured.metrics,{...profile,weight:weightKg},training,photos);
          focusBasis="photos_profile_and_training";
        } catch(error) {
          if(error instanceof BodyCoachingError&&!error.allowContextFallback) throw error;
          coached=await dependencies.coach(measured.metrics,{...profile,weight:weightKg},training,[]);
          qualityNotes.push("Photo context was unavailable. Suggestions use your goals, training and available measurements.");
        }
      } else coached=await dependencies.coach(measured.metrics,{...profile,weight:weightKg},training,[]);
      summary=coached.summary;observations=coached.observations;coachingModel=coached.modelVersion;regionalGuidance=coached.regionalGuidance;physiqueAssessment=coached.physiqueAssessment;
    } catch(error) {
      focusUnavailableReason=error instanceof BodyCoachingError?error.reason:"provider_unavailable";
      if(focusUnavailableReason==="rate_limited") summary="Your baseline is saved. The assessment service has reached its current request limit. Try again later for focus suggestions.";
      qualityNotes.push("Focus suggestions are unavailable right now. Your photo baseline is saved.");
    }
  } else focusUnavailableReason="not_configured";
  const result:VisualResult={usable:true,qualityNotes,summary,estimates:[],observations};
  return {result,modelVersion:measured.modelVersion,measurementMetrics:measured.metrics as BodyMetrics,coachingModel,elapsedMs:measured.elapsedMs,
    focusStatus:coachingModel?"ready":"unavailable",focusBasis,focusUnavailableReason,regionalGuidance,physiqueAssessment,
    processing:{operation:"photo_scan",measurementMs,aiMs:process.env.OPENAI_API_KEY?Math.round(performance.now()-coachingStarted):0,totalMs:Math.round(performance.now()-started)}};
}
