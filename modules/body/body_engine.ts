import { BodyMetrics, METRICS, MetricId, VisualResult, BodyError, metricsSchema, VIEWS } from "./body_types";
import { createHash } from "node:crypto";

export function decodePhotos(photos:Array<{view:typeof VIEWS[number];mimeType:string;base64:string}>) {
  const result=photos.map(photo=> {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(photo.base64)) throw new BodyError(400,"Invalid photo encoding.");
    const data=Buffer.from(photo.base64,"base64");
    if (data.length>2_000_000 || data.length<75) throw new BodyError(400,"Each photo must be under 2 MB.");
    const png=data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg=data[0]===255 && data[1]===216 && data[2]===255;
    if ((photo.mimeType==="image/png" && !png) || (photo.mimeType==="image/jpeg" && !jpeg)) throw new BodyError(400,"Use a JPEG or PNG photo.");
    return {view:photo.view,mimeType:photo.mimeType,data,sha256:createHash("sha256").update(data).digest("hex")};
  });
  if (new Set(result.map(photo=>photo.sha256)).size!==result.length) throw new BodyError(400,"Use a different photo for each view.");
  return result;
}

export function metricsFromVisual(result:VisualResult, weightKg:number):BodyMetrics {
  if (!result.usable) throw new BodyError(422,result.qualityNotes.join(" ") || "These photos need clearer framing. Please retake them.");
  const metrics:BodyMetrics={weightKg:{value:weightKg,source:"scale"}};
  const seen=new Set<string>();
  for (const estimate of result.estimates) {
    const key=estimate.metric; const spec=METRICS[key];
    // The model must not produce exact-looking numbers or duplicate metrics.
    if (key==="weightKg" || seen.has(key)) throw new BodyError(502,"The photo analysis returned inconsistent estimates. Please retry.");
    seen.add(key);
    if (!Number.isFinite(estimate.low) || !Number.isFinite(estimate.high) || estimate.low<spec.min || estimate.high>spec.max || estimate.high-estimate.low<4) continue;
    const low=Math.floor(estimate.low), high=Math.ceil(estimate.high);
    metrics[key]={value:Math.round((low+high)/2*10)/10,low,high,source:"photo_estimate"};
  }
  return metricsSchema.parse(metrics);
}

export function compareMetrics(current:BodyMetrics, previous:BodyMetrics|null, samePhotoMethod:boolean) {
  return Object.fromEntries(Object.entries(current).map(([key,metric])=> {
    const before=previous?.[key as MetricId];
    if (!metric || !before) return [key,{status:"no_baseline",delta:null}];
    if (metric.source==="profile" || before.source==="profile") return [key,{status:"context_only",delta:null}];
    if (before.source!==metric.source || metric.source==="photo_estimate" && !samePhotoMethod) return [key,{status:"different_method",delta:null}];
    if (metric.source==="photo_estimate" || metric.source==="contour_estimate") {
      if (metric.low===undefined || metric.high===undefined || before.low===undefined || before.high===undefined) return [key,{status:"no_baseline",delta:null}];
      const status=metric.low>before.high ? "estimate_increased" : metric.high<before.low ? "estimate_decreased" : "overlapping_estimates";
      return [key,{status,delta:null}]; // Visual ranges are not calibrated measurement deltas.
    }
    const delta=Math.round((metric.value-before.value)*10)/10;
    return [key,{status:delta>0?"increased":delta<0?"decreased":"unchanged",delta}];
  }));
}

export function regionalChange(metrics:BodyMetrics, comparison:ReturnType<typeof compareMetrics>) {
  return Object.fromEntries(["chest","core","glutes","biceps","quads","calves"].map(region=> {
    const statuses=Object.entries(METRICS).filter(([,spec])=>spec.region===region).map(([key])=>comparison[key]?.status).filter(Boolean);
    const positive=statuses.some(status=>status==="increased"), negative=statuses.some(status=>status==="decreased");
    return [region,positive&&negative?"mixed":positive?"increased":negative?"decreased":statuses.includes("unchanged")?"unchanged":"unavailable"];
  }));
}
