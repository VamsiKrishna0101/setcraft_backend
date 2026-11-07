import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import express from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma';
import bodyRoutes from '../modules/body/body_routes';
import oldRoutes from '../modules/bodyscan/bodyscan_routes';
import privacyRoutes from '../modules/privacy/privacy_routes';
import {cancelReviewJob, getReviewJob, startBodyReview, refreshBodyFocus} from '../modules/body/body_service';
import {BodyCoachingError} from '../modules/body/body_coaching';
import {decodePhotos} from '../modules/body/body_engine';
import {BodyError, reviewSchema, VisualResult} from '../modules/body/body_types';
import {MUSCLE_IDS} from '../modules/heatmap/training_map_engine';
import {bodyPhotoStorage, flushBodyPhotoDeletions} from '../modules/body/body_photo_storage';
import {deleteUserAccount} from '../modules/privacy/privacy_service';
import redis from '../config/redis';

// Valid synthetic PNGs; no real member photos are used in database tests.
function png(seed:number) {
  function chunk(type:string,data:Buffer) {
    const content=Buffer.concat([Buffer.from(type),data]); let crc=0xffffffff;
    for(const byte of content) {crc^=byte; for(let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    const size=Buffer.alloc(4),checksum=Buffer.alloc(4);size.writeUInt32BE(data.length);checksum.writeUInt32BE((crc^0xffffffff)>>>0);
    return Buffer.concat([size,content,checksum]);
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(4,0);header.writeUInt32BE(4,4);header[8]=8;header[9]=6;
  const rgba=Buffer.alloc(4*(1+4*4)); for(let i=0;i<rgba.length;i++) rgba[i]=(i*13+seed)%256; for(let row=0;row<4;row++) rgba[row*17]=0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rgba)),chunk('IEND',Buffer.alloc(0))]);
}
async function main() {
  const ids=[randomUUID(),randomUUID()];
  const real=await prisma.user.findUnique({where:{email:'vklvl0101@gmail.com'},select:{id:true}});
  const before=real ? await prisma.bodyAssessment.count({where:{userId:real.id}}) : null;
  const app=express(); app.use(express.json({limit:'12mb'}));app.use('/api/body',bodyRoutes);app.use('/api/bodyscan',oldRoutes);app.use('/api/privacy',privacyRoutes);
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const addr=server.address();assert(addr && typeof addr!=='string');const base=`http://127.0.0.1:${addr.port}`;
  const headers=(user:string)=>({authorization:`Bearer ${jwt.sign({userId:user},process.env.JWT_ACCESS_SECRET!,{expiresIn:'5m'})}`,'content-type':'application/json'});
  const request=(path:string,method='GET',body?:unknown,user=ids[0])=>fetch(base+path,{method,headers:headers(user),...(body?{body:JSON.stringify(body)}:{})});
  const date=new Date(Date.now()+330*60000).toISOString().slice(0,10);
  const photos=(['front','back','left','right'] as const).map((view,i)=>({view,mimeType:'image/png' as const,base64:png(30+i*50).toString('base64')}));
  const oldKey=process.env.OPENAI_API_KEY;
  const originalStorage={...bodyPhotoStorage};
  const objects=new Map<string,Buffer>();
  bodyPhotoStorage.put=async(bucket,key,data)=>{objects.set(`${bucket}/${key}`,Buffer.from(data));};
  bodyPhotoStorage.get=async(bucket,key)=>{const data=objects.get(`${bucket}/${key}`);if(!data) throw new BodyError(404,'Photo not found.');return data;};
  bodyPhotoStorage.remove=async(bucket,key)=>{objects.delete(`${bucket}/${key}`);};
  try {
    for(const id of ids) await prisma.user.create({data:{id,email:`body-test-${id}@example.invalid`,password:'synthetic-unused-password',
      trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 14 * 86400000)}});
    await prisma.onboarding.create({data:{userId:ids[0],workingToward:'BUILD_MUSCLE',name:'Synthetic member',age:26,gender:'FEMALE',height:170,weight:65,
      experience:'BEGINNER',daysPerWeek:'DAYS_3',workoutDuration:'MIN_30',trainingLocation:'HOME',equipment:['DUMBBELLS'],activityLevel:'MODERATE',sleepDuration:'HOURS_7_TO_8',eatingStyle:'VEGETARIAN',limitations:[],focusMuscles:['glutes','quads']}});
    assert.equal((await fetch(base+'/api/body')).status,401);
    assert.equal((await fetch(base+'/api/body',{headers:{authorization:'Bearer invalid'}})).status,401);
    assert.equal((await fetch(base+'/api/privacy/export')).status,401);
    assert.equal((await fetch(base+'/api/privacy/consent',{headers:{authorization:'Bearer invalid'}})).status,401);
    const draft={recordedDate:date,utcOffsetMinutes:330,metrics:{weightKg:{value:65,source:'scale'},waistCm:{value:80,source:'tape'}},photos,savePhotos:true};
    assert.equal((await request('/api/body/entries','POST',{...draft,savePhotos:false})).status,400,'Journaling requires explicit save consent');
    assert.equal((await request('/api/body/entries','POST',{...draft,recordedDate:'2999-01-01'})).status,400);
    assert.equal((await request('/api/body/entries','POST',{...draft,metrics:{waistCm:{value:80,low:75,high:85,source:'photo_estimate'}}})).status,400);
    const created=await request('/api/body/entries','POST',draft);assert.equal(created.status,201,created.status===201?'':await created.clone().text());
    const entry=await created.json() as any;assert.equal(entry.photos.length,4);assert.equal(entry.metrics.waistCm.value,80);assert.equal(entry.metrics.waistCm.source,'tape');
    const stored=await prisma.bodyAssessmentPhoto.findMany({where:{assessmentId:entry.id}});
    assert(stored.every(p=>p.data===null&&p.bucket==='fitai-body-images'&&p.objectKey));
    assert.equal(entry.quality.photoSaveConsent,true);
    assert(!JSON.stringify(entry).includes('objectKey'),'Storage keys never appear in client responses');
    assert(!JSON.stringify(entry).includes('base64'));assert(!JSON.stringify(entry).includes('"data"'));
    const image=await request(entry.photos[0].url);assert.equal(image.status,200);assert.equal(image.headers.get('cache-control'),'private, no-store');assert.equal(image.headers.get('content-type'),'image/png');
    assert(Buffer.from(await image.arrayBuffer()).equals(png(30)));
    const exported=await request('/api/privacy/export');assert.equal(exported.status,200);
    const privateExport=await exported.json() as any;assert.equal(privateExport.user.bodyAssessments.length,1);assert.equal(privateExport.user.bodyAssessments[0].photos.length,4);
    assert(!JSON.stringify(privateExport.user.bodyAssessments[0].photos).includes('"data"'),'The metadata export must not leak binary photo data');
    const otherExport=await request('/api/privacy/export','GET',undefined,ids[1]);assert.equal(otherExport.status,200);assert.equal((await otherExport.json() as any).user.bodyAssessments.length,0);
    assert.equal((await fetch(base+entry.photos[0].url)).status,401);
    for(const path of [`/api/body/entries/${entry.id}`,entry.photos[0].url]) assert.equal((await request(path,'GET',undefined,ids[1])).status,404);
    assert.equal((await request(`/api/body/entries/${entry.id}`,'DELETE',undefined,ids[1])).status,404);
    const changed=await request(`/api/body/entries/${entry.id}`,'PATCH',{metrics:{weightKg:{value:65,source:'scale'},waistCm:{value:79,source:'tape'}},expectedUpdatedAt:entry.updatedAt});assert.equal(changed.status,200);
    const current=await changed.json() as any;assert.equal(current.metrics.waistCm.value,79);
    assert.equal((await request(`/api/body/entries/${entry.id}`,'PATCH',{metrics:entry.metrics,expectedUpdatedAt:entry.updatedAt})).status,409);
    const next=await request('/api/body/entries','POST',{...draft,photos:[],metrics:{weightKg:{value:64,source:'scale'},waistCm:{value:77,source:'tape'}}});assert.equal(next.status,201);
    const nextEntry=await next.json() as any;
    const compared=await request(`/api/body/compare?currentId=${nextEntry.id}&previousId=${entry.id}`);assert.equal(compared.status,200);const comparison=await compared.json() as any;
    assert.equal(comparison.metrics.waistCm.delta,-2);assert.equal(comparison.regions.core,'decreased');
    assert.equal((await request(`/api/body/compare?currentId=${entry.id}&previousId=${nextEntry.id}`)).status,400);
    assert.equal((await request(`/api/body/compare?currentId=${nextEntry.id}&previousId=${entry.id}`,'GET',undefined,ids[1])).status,404);
    assert.equal((await request('/api/bodyscan/capture','POST',{})).status,410);assert.equal((await request('/api/bodyscan/process','POST',{})).status,410);
    const overview=await (await request('/api/body')).json() as any;assert.equal(overview.records.length,2);assert.equal(overview.profile.gender,'FEMALE');
    assert.equal((await (await request('/api/body','GET',undefined,ids[1])).json() as any).records.length,0);

    // Only temporary test accounts are written. Synthetic rows must never look
    // like real tape readings, including in a filtered page of old scans.
    const historyIds = Array.from({ length: 14 }, () => randomUUID());
    const syntheticId = randomUUID();
    await prisma.bodyAssessment.createMany({ data: [
      ...historyIds.map((id, index) => ({ id, userId: ids[0]!, status: 'SAVED', method: 'photo_review',
        recordedDate: '2020-01-' + String(index + 1).padStart(2, '0'),
        metrics: { waistCm: { value: 80, source: 'tape' } }, observations: [], quality: {} })),
      { id: syntheticId, userId: ids[0]!, status: 'SAVED', method: 'entered', recordedDate: date,
        metrics: { waistCm: { value: 999, source: 'tape' } }, observations: [], quality: { synthetic: true } },
    ] });
    const firstHistory = await (await request('/api/body/history?from=2020-01-01&to=2020-01-31')).json() as any;
    const secondHistory = await (await request('/api/body/history?from=2020-01-01&to=2020-01-31&page=2')).json() as any;
    assert.equal(firstHistory.total, 14);
    assert.equal(firstHistory.records.length, 12);
    assert.equal(secondHistory.records.length, 2);
    assert.equal(new Set([...firstHistory.records, ...secondHistory.records].map(row => row.id)).size, 14);
    assert.equal((await (await request('/api/body/history','GET',undefined,ids[1])).json() as any).total, 0);
    assert.equal((await request('/api/body/history?from=2020-02-01&to=2020-01-01')).status, 400);
    assert.equal((await request('/api/body/history?from=bad')).status, 400);
    assert.equal((await request('/api/body/history?page=0')).status, 400);
    assert.equal((await request('/api/body/entries/' + syntheticId)).status, 404);
    const realOverview = await (await request('/api/body')).json() as any;
    assert(!realOverview.records.some((row: any) => row.id === syntheticId));
    await prisma.bodyAssessment.deleteMany({ where: { userId: ids[0], id: { in: [...historyIds, syntheticId] } } });

    // Injectable provider is internal to the service; production HTTP cannot supply it.
    process.env.OPENAI_API_KEY ||= 'synthetic-provider-test';
    const input=reviewSchema.parse({recordedDate:date,utcOffsetMinutes:330,weightKg:64,consentToPhotoAnalysis:true,analysisProvider:"OPENAI" as const,savePhotos:true,photos});
    let resolveReview!:(value:{result:VisualResult;modelVersion:string})=>void;
    const held=new Promise<{result:VisualResult;modelVersion:string}>(resolve=>resolveReview=resolve);
    const blocked=await startBodyReview(ids[0],input,async()=>held);
    await assert.rejects(()=>startBodyReview(ids[0],input,async()=>held),error=>error instanceof BodyError&&error.status===429);
    assert.equal((await request(`/api/body/review-jobs/${blocked.jobId}`,'GET',undefined,ids[1])).status,404);
    await cancelReviewJob(ids[0],blocked.jobId);
    const result:VisualResult={usable:true,qualityNotes:['Synthetic review'],summary:'Synthetic review only',estimates:[{metric:'bodyFatPct',low:18,high:26}],observations:[]};
    resolveReview({result,modelVersion:'fixture-model'});await new Promise(resolve=>setTimeout(resolve,30));assert.equal(await prisma.bodyAssessment.count({where:{userId:ids[0],status:'REVIEW'}}),0);
    const job=await startBodyReview(ids[0],input,async()=>({result,modelVersion:'fixture-model'}));
    const deadline=Date.now()+15000;while(getReviewJob(ids[0],job.jobId).status==='processing'&&Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,50));
    const ready=getReviewJob(ids[0],job.jobId);assert.equal(ready.status,'ready');assert(ready.assessmentId);
    const ai=await (await request(`/api/body/entries/${ready.assessmentId}`)).json() as any;
    assert.equal(ai.status,'SAVED');assert.equal(ai.metrics.bodyFatPct.source,'photo_estimate');assert.equal(ai.metrics.waistCm,undefined);
    assert.equal((await (await request('/api/body')).json() as any).records.length,3,'Completed assessments enter history without a review step');
    await cancelReviewJob(ids[0],job.jobId);
    assert.equal(getReviewJob(ids[0],job.jobId).status,'ready','Closing a delivered result does not cancel it');
    assert.equal((await request(`/api/body/entries/${ai.id}`)).status,200,'Completed results survive cancellation cleanup');
    assert.equal((await request(`/api/body/entries/${ai.id}`,'PATCH',{metrics:{...ai.metrics,bodyFatPct:{...ai.metrics.bodyFatPct,value:23}},expectedUpdatedAt:ai.updatedAt})).status,400);
    const saved=await request(`/api/body/entries/${ai.id}`,'PATCH',{metrics:{...ai.metrics,bodyFatPct:{high:26,source:'photo_estimate',low:18,value:22}},expectedUpdatedAt:ai.updatedAt});assert.equal(saved.status,200);
    const savedAI=await saved.json() as any;assert.equal(savedAI.status,'SAVED');assert.equal(savedAI.metrics.bodyFatPct.source,'photo_estimate','Saving a review must not upgrade its source');
    const entered=await request(`/api/body/entries/${ai.id}`,'PATCH',{metrics:{...savedAI.metrics,bodyFatPct:{value:21,source:'smart_scale'}},expectedUpdatedAt:savedAI.updatedAt});assert.equal(entered.status,200);
    const bad=await startBodyReview(ids[0],input,async()=>({result:{...result,usable:false,qualityNotes:['Retake the back view.']},modelVersion:'fixture-model'}));
    while(getReviewJob(ids[0],bad.jobId).status==='processing'&&Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(getReviewJob(ids[0],bad.jobId).status,'failed');assert.equal(await prisma.bodyAssessment.count({where:{userId:ids[0],status:'REVIEW'}}),0);
    assert.equal((await request('/api/body/entries','POST',{recordedDate:date,utcOffsetMinutes:330,metrics:{weightKg:{value:90,source:'profile'}}})).status,400,'Clients cannot invent an onboarding weight');
    assert.equal((await request('/api/body/entries','POST',{recordedDate:date,utcOffsetMinutes:330,metrics:{waistCm:{value:80,low:75,high:85,source:'contour_estimate'}}})).status,400,'Only the local photo job may create contour estimates');
    const contour={value:80,low:75,high:85,source:'contour_estimate' as const};
    const local=await startBodyReview(ids[0],{...input,weightKg:65,weightSource:'profile'},async()=>({result:{...result,estimates:[],observations:[{region:'core',observation:'Synthetic goal-aligned focus',confidence:'low'}]},modelVersion:'synthetic-contour-v1',measurementMetrics:{waistCm:contour}}));
    const localDeadline=Date.now()+15000;
    while(getReviewJob(ids[0],local.jobId).status==='processing'&&Date.now()<localDeadline) await new Promise(resolve=>setTimeout(resolve,50));
    const localReady=getReviewJob(ids[0],local.jobId);assert.equal(localReady.status,'ready');
    const localEntry=await (await request(`/api/body/entries/${localReady.assessmentId}`)).json() as any;
    assert.equal(localEntry.metrics.weightKg.source,'profile');assert.deepEqual(localEntry.metrics.waistCm,contour);
    assert.equal((await request(`/api/body/entries/${localEntry.id}`,'PATCH',{metrics:{...localEntry.metrics,waistCm:{...contour,value:81}},expectedUpdatedAt:localEntry.updatedAt})).status,400,'Review edits cannot silently alter a contour estimate');
    const reordered=Object.fromEntries(Object.entries(localEntry.metrics).reverse());
    const localSaved=await request(`/api/body/entries/${localEntry.id}`,'PATCH',{metrics:reordered,expectedUpdatedAt:localEntry.updatedAt});assert.equal(localSaved.status,200);
    const localSavedData=await localSaved.json() as any;
    assert.equal(localSavedData.metrics.weightKg.source,'profile','Saving must not relabel profile weight as a new scale reading');
    assert.equal(localSavedData.observations.length,1,'Unchanged values must retain focus when client JSON key order differs');
    await request(`/api/body/entries/${localEntry.id}`,'DELETE');
    const empty=await startBodyReview(ids[0],{...input,consentToVisualCoaching:true},async(_photos,_profile,_weight,_training,options)=>{
      assert.equal(options?.visualCoaching,true);options?.onStage?.('focus');
      return {result:{...result,estimates:[],summary:'Synthetic goal-based focus',observations:[{region:'chest',observation:'Synthetic goal-based focus',confidence:'low'}]},
        modelVersion:'synthetic-pose',measurementMetrics:{},coachingModel:'synthetic-coach',focusStatus:'ready',focusBasis:'photos_profile_and_training',
        regionalGuidance:MUSCLE_IDS.map(region=>({region,status:region==='chest'?'focus' as const:'unknown' as const,
          reason:'Synthetic regional guidance',basis:'profile_goal' as const})),
        physiqueAssessment:{version:'physique-v2',model:'synthetic-coach',photosUsed:4,overview:'Synthetic photo overview',
          regions:MUSCLE_IDS.map(region=>({region,appearanceStatus:'observed',visualObservation:'Synthetic visible outline',
            visualEvidenceViews:['front'],trainingDirection:'Include in routine',basis:'profile_goal',limitations:[]}))},
        processing:{operation:'photo_scan',measurementMs:10,aiMs:20,totalMs:30}};
    });
    const emptyDeadline=Date.now()+15000;
    while(getReviewJob(ids[0],empty.jobId).status==='processing'&&Date.now()<emptyDeadline) await new Promise(resolve=>setTimeout(resolve,50));
    const emptyJob=getReviewJob(ids[0],empty.jobId);assert.equal(emptyJob.status,'ready');assert.equal(emptyJob.stage,'saving');
    const emptyEntry=await (await request(`/api/body/entries/${emptyJob.assessmentId}`)).json() as any;
    assert.equal(emptyEntry.status,'SAVED');assert.deepEqual(Object.keys(emptyEntry.metrics),['weightKg']);
    assert.equal(emptyEntry.quality.measurementStatus,'unavailable');assert.equal(emptyEntry.quality.focusStatus,'ready');
    assert.equal(emptyEntry.quality.bodyRegions.length,13,'All body areas are persisted separately from top priorities');
    assert.equal(emptyEntry.quality.physiqueAssessment.regions.length,13);
    assert.equal(emptyEntry.quality.bodyComposition.status,'not_validated');
    assert.equal(emptyEntry.quality.processing.aiMs,20);
    assert.deepEqual(emptyEntry.quality.measurementAnalysis.availableMeasurements,emptyEntry.metrics);
    assert.equal(emptyEntry.quality.visualCoachingConsent,true);assert.equal(emptyEntry.photos.length,4);assert.equal(emptyEntry.observations.length,1);
    assert((await (await request('/api/body')).json() as any).records.some((r:any)=>r.id===emptyEntry.id),'A focus result with no circumferences still appears in history');

    // Refresh a saved report without new photos or changing measured baseline values.
    const refresh={analysisProvider:'OPENAI' as const,expectedUpdatedAt:emptyEntry.updatedAt,utcOffsetMinutes:330,consentToVisualCoaching:true};
    let coachCalls=0;
    const coach:Parameters<typeof refreshBodyFocus>[3]=async(metrics,profile,_training,images)=>{
      coachCalls++;assert.deepEqual(metrics,emptyEntry.metrics);assert.equal(profile.weight,64);
      assert.equal(images?.length,4);assert(images?.every(p=>p.data.equals(png(30+photos.findIndex(v=>v.view===p.view)*50))));
      return {summary:'Train your whole body; give chest additional attention.',
        observations:[{region:'chest',observation:'Extra goal-aligned emphasis',confidence:'low' as const,kind:'suggested_focus',basis:'profile_goal' as const}],
        regionalGuidance:MUSCLE_IDS.map(region=>({region,status:region==='chest'?'focus' as const:'balanced' as const,reason:'Include this area in your routine.',basis:'profile_goal' as const})),modelVersion:'synthetic-refresh',
        physiqueAssessment:{...emptyEntry.quality.physiqueAssessment,model:'synthetic-refresh'}};
    };
    assert.equal((await fetch(base+`/api/body/entries/${emptyEntry.id}/focus`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(refresh)})).status,401);
    assert.equal((await request(`/api/body/entries/${emptyEntry.id}/focus`,'POST',refresh,ids[1])).status,404);
    await assert.rejects(refreshBodyFocus(ids[1],emptyEntry.id,refresh,coach),e=>e instanceof BodyError&&e.status===404);
    await assert.rejects(refreshBodyFocus(ids[0],emptyEntry.id,{...refresh,expectedUpdatedAt:new Date(0).toISOString()},coach),e=>e instanceof BodyError&&e.status===409);
    assert.equal(coachCalls,0,'Ownership and stale checks precede provider use');
    const refreshed=await refreshBodyFocus(ids[0],emptyEntry.id,refresh,coach);
    assert.equal(coachCalls,1);assert.equal((refreshed.quality as any).bodyRegions.length,13);
    assert.deepEqual(refreshed.metrics,emptyEntry.metrics);assert.deepEqual(refreshed.photos,emptyEntry.photos);
    assert.equal(refreshed.recordedDate,emptyEntry.recordedDate);assert.equal(refreshed.modelVersion,emptyEntry.modelVersion);
    assert.equal((refreshed.quality as any).visualCoachingUsed,true);
    assert.equal((refreshed.quality as any).physiqueAssessment.model,'synthetic-refresh');
    assert.equal((refreshed.quality as any).processing.measurementReused,true);
    assert.equal((refreshed.quality as any).processing.measurementMs,null,'Refresh does not pretend to rerun measurements');
    await assert.rejects(refreshBodyFocus(ids[0],emptyEntry.id,{...refresh,expectedUpdatedAt:refreshed.updatedAt.toISOString()},async()=>{throw new BodyCoachingError('rate_limited',false);}),e=>e instanceof BodyError&&e.status===503);
    const afterFailure=await (await request(`/api/body/entries/${emptyEntry.id}`)).json() as any;
    assert.equal(afterFailure.updatedAt,refreshed.updatedAt.toISOString());assert.equal(afterFailure.summary,refreshed.summary,'A failed refresh preserves the saved report');
    const contextRefresh=await refreshBodyFocus(ids[0],emptyEntry.id,{...refresh,expectedUpdatedAt:afterFailure.updatedAt,consentToVisualCoaching:false},async(metrics,profile,training,images)=>{
      assert.equal(images?.length,0,'No images are sent without consent');
      const synthetic=await coach(metrics,profile,training,decodePhotos(photos));
      assert(synthetic.physiqueAssessment);
      return {...synthetic,modelVersion:'synthetic-context-refresh',physiqueAssessment:{...synthetic.physiqueAssessment,
        photosUsed:0,regions:synthetic.physiqueAssessment.regions.map(r=>({...r,appearanceStatus:'not_provided' as const,visualEvidenceViews:[]}))}};
    });
    assert.equal((contextRefresh.quality as any).physiqueAssessment.photosUsed,0);
    assert.equal((contextRefresh.quality as any).visualCoachingUsed,false);
    const editedReport=await request(`/api/body/entries/${emptyEntry.id}`,'PATCH',{
      metrics:{weightKg:{value:64.5,source:'scale'}},expectedUpdatedAt:contextRefresh.updatedAt.toISOString()});
    assert.equal(editedReport.status,200);
    const editedData=await editedReport.json() as any;
    assert.equal(editedData.quality.focusStatus,'stale');assert.equal(editedData.quality.physiqueAssessment,null);
    assert.deepEqual(editedData.quality.bodyRegions,[],'Changed inputs cannot retain outdated guidance');
    // Analyze-only must persist the report but never send photos to storage or the DB.
    const countBefore=objects.size;
    const analyzeOnly=await startBodyReview(ids[0],{...input,savePhotos:false},async(images)=>{
      assert.equal(images.length,4);return {result,modelVersion:'synthetic-analysis-only'};
    });
    const noSaveDeadline=Date.now()+15000;
    while(getReviewJob(ids[0],analyzeOnly.jobId).status==='processing'&&Date.now()<noSaveDeadline) await new Promise(resolve=>setTimeout(resolve,20));
    const noSaveJob=getReviewJob(ids[0],analyzeOnly.jobId);assert.equal(noSaveJob.status,'ready');
    const noSaveEntry=await (await request(`/api/body/entries/${noSaveJob.assessmentId}`)).json() as any;
    assert.equal(noSaveEntry.photos.length,0);assert.equal(noSaveEntry.quality.photoRetention,'not_saved');
    assert.equal(objects.size,countBefore,'Analyze-only must not upload images');
    assert(noSaveEntry.summary);await request(`/api/body/entries/${noSaveEntry.id}`,'DELETE');

    // Partial upload failure is compensated; it never silently falls back to DB images.
    const put=bodyPhotoStorage.put;let uploads=0;
    bodyPhotoStorage.put=async(...args)=>{if(++uploads===2) throw new Error('Synthetic storage failure');await put(...args);};
    assert.equal((await request('/api/body/entries','POST',draft)).status,503);
    bodyPhotoStorage.put=put;assert.equal(objects.size,countBefore);

    // Remove images separately and retain a durable retry when the provider is unavailable.
    assert.equal((await request(`/api/body/entries/${emptyEntry.id}/photos`,'DELETE',undefined,ids[1])).status,404);
    const remove=bodyPhotoStorage.remove;bodyPhotoStorage.remove=async()=>{throw new Error('Synthetic deletion outage');};
    const removed=await request(`/api/body/entries/${emptyEntry.id}/photos`,'DELETE');assert.equal(removed.status,200);
    const preserved=await removed.json() as any;assert.equal(preserved.photos.length,0);
    assert.deepEqual(preserved.metrics,editedData.metrics);assert.equal(preserved.summary,editedData.summary);
    assert.equal(preserved.quality.photoRetention,'deleted');
    assert.equal((await request(emptyEntry.photos[0].url)).status,404,'Deleted photos immediately lose API access');
    assert(await prisma.bodyPhotoDeletion.count()>0,'Failed deletion is retained for retry');
    bodyPhotoStorage.remove=remove;await flushBodyPhotoDeletions();
    assert.equal(await prisma.bodyPhotoDeletion.count(),0);
    await request(`/api/body/entries/${emptyEntry.id}`,'DELETE');
    assert.equal((await request(`/api/body/entries/${entry.id}`,'DELETE')).status,200);
    assert.equal((await request(entry.photos[0].url)).status,404);assert.equal(await prisma.bodyAssessmentPhoto.count({where:{assessmentId:entry.id}}),0,'Deleting an entry cascades its photos');
    const legacy=await prisma.bodyAssessment.create({data:{userId:ids[0],recordedDate:date,method:'entered',metrics:{weightKg:{value:65,source:'scale'}},observations:[],quality:{},
      photos:{create:[{view:'front',mimeType:'image/png',data:png(30),sha256:decodePhotos([photos[0]!])[0]!.sha256}]}}});
    const legacyPhoto=await prisma.bodyAssessmentPhoto.findFirstOrThrow({where:{assessmentId:legacy.id}});
    const legacyResponse=await request(`/api/body/photos/${legacyPhoto.id}`);assert.equal(legacyResponse.status,200);
    assert(Buffer.from(await legacyResponse.arrayBuffer()).equals(png(30)),'Existing private DB photos remain readable');
    await request(`/api/body/entries/${legacy.id}`,'DELETE');

    const accountEntry=await (await request('/api/body/entries','POST',draft,ids[1])).json() as any;
    const accountPhoto=await prisma.bodyAssessmentPhoto.findFirstOrThrow({where:{assessmentId:accountEntry.id}});
    const keys=redis.keys;redis.keys=async()=>[];
    try {await deleteUserAccount(ids[1]);} finally {redis.keys=keys;}
    assert.equal(await prisma.bodyAssessmentPhoto.count({where:{assessmentId:accountEntry.id}}),0);
    assert(!objects.has(`${accountPhoto.bucket}/${accountPhoto.objectKey}`),'Account deletion removes external images');
    assert.equal(await prisma.bodyPhotoDeletion.count(),0);
    console.log('Live body API checks passed: authentication, ownership, private photo round-trip/deletion, stale edits, comparisons, review/cancellation/quality gates and estimate provenance.');
  } finally {
    if(oldKey===undefined) delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;
    const {deleteBodyEntry}=await import('../modules/body/body_service');
    for(const entry of await prisma.bodyAssessment.findMany({where:{userId:{in:ids}},select:{id:true,userId:true}})) await deleteBodyEntry(entry.userId,entry.id);
    await prisma.user.deleteMany({where:{id:{in:ids}}});
    assert.equal(objects.size,0,'Synthetic images are cleaned up after the tests');
    Object.assign(bodyPhotoStorage,originalStorage);
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    assert.equal(await prisma.user.count({where:{id:{in:ids}}}),0);
    if(real) assert.equal(await prisma.bodyAssessment.count({where:{userId:real.id}}),before,'Real member records were not changed');
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>prisma.$disconnect());
