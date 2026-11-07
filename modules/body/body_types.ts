import { z } from "zod";
import { calendarWindow, MUSCLE_IDS } from "../heatmap/training_map_engine";
import {compositionReadingsSchema} from './physique_dashboard';

export const METRICS = {
  weightKg: { label:"Weight", unit:"kg", min:20, max:500, region:null },
  bodyFatPct: { label:"Body fat", unit:"%", min:2, max:75, region:null },
  chestCm: { label:"Chest", unit:"cm", min:30, max:250, region:"chest" },
  waistCm: { label:"Waist", unit:"cm", min:30, max:250, region:"core" },
  hipsCm: { label:"Hips", unit:"cm", min:40, max:250, region:"glutes" },
  leftArmCm: { label:"Left arm", unit:"cm", min:10, max:90, region:"biceps" },
  rightArmCm: { label:"Right arm", unit:"cm", min:10, max:90, region:"biceps" },
  leftThighCm: { label:"Left thigh", unit:"cm", min:20, max:140, region:"quads" },
  rightThighCm: { label:"Right thigh", unit:"cm", min:20, max:140, region:"quads" },
  leftCalfCm: { label:"Left calf", unit:"cm", min:10, max:80, region:"calves" },
  rightCalfCm: { label:"Right calf", unit:"cm", min:10, max:80, region:"calves" },
  neckCm: { label:"Neck", unit:"cm", min:20, max:80, region:null },
} as const;
export type MetricId = keyof typeof METRICS;
export const METRIC_IDS = Object.keys(METRICS) as [MetricId, ...MetricId[]];
export const VIEWS = ["front","back","left","right"] as const;
export const SOURCES = ["tape","scale","profile","smart_scale","dexa","calipers","manual_estimate","photo_estimate","contour_estimate"] as const;
const metricSchema = z.object({ value:z.number().finite(), source:z.enum(SOURCES),
  low:z.number().finite().optional(), high:z.number().finite().optional() }).strict();
export const metricsSchema = z.partialRecord(z.enum(METRIC_IDS),metricSchema).superRefine((metrics, ctx) => {
  for (const [key, metric] of Object.entries(metrics)) {
    if (!metric) continue;
    const spec=METRICS[key as MetricId];
    if (metric.value<spec.min || metric.value>spec.max) ctx.addIssue({code:"custom",path:[key,"value"],message:`${spec.label} is outside the supported range`});
    const estimated=metric.source==="photo_estimate" || metric.source==="contour_estimate";
    if (estimated && (metric.low===undefined || metric.high===undefined || metric.low>metric.value || metric.high<metric.value || metric.low>=metric.high))
      ctx.addIssue({code:"custom",path:[key],message:"Photo estimates require an ordered range containing the value"});
    if ((metric.low!==undefined && metric.low<spec.min) || (metric.high!==undefined && metric.high>spec.max))
      ctx.addIssue({code:"custom",path:[key],message:"Estimate range is outside supported bounds"});
    if (!estimated && (metric.low!==undefined || metric.high!==undefined)) ctx.addIssue({code:"custom",path:[key],message:"Only photo estimates use visual ranges"});
    const validSources = key==="weightKg" ? ["scale","profile"] : key==="bodyFatPct" ? ["smart_scale","dexa","calipers","manual_estimate","photo_estimate"] : ["tape","photo_estimate","contour_estimate"];
    if (!validSources.includes(metric.source)) ctx.addIssue({code:"custom",path:[key,"source"],message:"Measurement source does not match this metric"});
  }
});
export type BodyMetrics = z.infer<typeof metricsSchema>;
export const photoSchema = z.object({ view:z.enum(VIEWS), mimeType:z.enum(["image/jpeg","image/png"]),
  base64:z.string().min(100).max(2800000) }).strict();
export const dateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(date=> { try {calendarWindow(date,0);return date>="2000-01-01";} catch{return false;} },"Invalid recorded date");
export const entrySchema=z.object({ recordedDate:dateSchema, utcOffsetMinutes:z.number().int().min(-840).max(840),
  metrics:metricsSchema, photos:z.array(photoSchema).max(4).default([]), savePhotos:z.boolean().default(false), requestCoaching:z.boolean().default(false), analysisProvider:z.literal("OPENAI").optional() }).strict()
  .refine(v=>!v.requestCoaching||v.analysisProvider==="OPENAI","Consent to OpenAI processing is required. Update your app and review the consent.")
  .refine(v=>!v.photos.length||v.savePhotos,"Choose to save photos before uploading a photo journal")
  .refine(v=>Object.keys(v.metrics).length>0,"Add at least one measurement")
  .refine(v=>new Set(v.photos.map(p=>p.view)).size===v.photos.length,"Each photo view must be unique");
export const reviewSchema=z.object({ recordedDate:dateSchema, utcOffsetMinutes:z.number().int().min(-840).max(840),
  weightKg:z.number().finite().min(20).max(500).optional(), weightSource:z.enum(["scale","profile"]).default("scale"), consentToPhotoAnalysis:z.literal(true), analysisProvider:z.literal("OPENAI"),
  consentToVisualCoaching:z.boolean().default(false),
  savePhotos:z.boolean().default(false),
  compositionReadings:compositionReadingsSchema.optional(),
  photos:z.array(photoSchema).min(1).max(4) }).strict()
  .refine(v=>!v.compositionReadings || v.compositionReadings.recordedDate<=v.recordedDate,"Reading date cannot be after the scan date")
  .refine(v=>new Set(v.photos.map(p=>p.view)).size===v.photos.length,"Each photo view must be unique")
  .refine(v=>v.photos.some(p=>p.view==="front"),"Add a front photo to start your review");
export const saveReviewSchema=z.object({ metrics:metricsSchema, expectedUpdatedAt:z.string().datetime() }).strict().refine(v=>Object.keys(v.metrics).length>0,"Add at least one measurement");
export const refreshBodyFocusSchema=z.object({analysisProvider:z.literal("OPENAI"),expectedUpdatedAt:z.string().datetime(),
  utcOffsetMinutes:z.number().int().min(-840).max(840),consentToVisualCoaching:z.boolean().default(false)}).strict();
export const visualResultSchema=z.object({ usable:z.boolean(), qualityNotes:z.array(z.string().max(180)).max(8),
  summary:z.string().max(600),
  estimates:z.array(z.object({ metric:z.enum(METRIC_IDS.filter(key=>key!=="weightKg") as [MetricId,...MetricId[]]),
    low:z.number(),high:z.number() })).max(11),
  observations:z.array(z.object({ region:z.enum(MUSCLE_IDS), observation:z.string().max(240),
    confidence:z.enum(["low","moderate"]) })).max(13),
}).strict();
export type VisualResult=z.infer<typeof visualResultSchema>;
export class BodyError extends Error { constructor(public status:number,message:string){super(message);} }
export function validateEntryDate(date:string,offset:number) {
  calendarWindow(date,offset);
  const today=new Date(Date.now()+offset*60000).toISOString().slice(0,10);
  if (date>today) throw new BodyError(400,"Choose today or an earlier date.");
}
