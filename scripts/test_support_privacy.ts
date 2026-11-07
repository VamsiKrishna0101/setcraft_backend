// In-process regression checks. Every persistence/network boundary is stubbed:
// no database writes, Redis calls, email delivery or paid provider requests.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {inject} from 'light-my-request';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma';
import {rateLimitStore} from '../middleware/rate_limit';
import {createSupportRouter} from '../modules/support/support_routes';
import * as support from '../modules/support/support_service';
import {createTicketInput,replyInput,SupportError} from '../modules/support/support_types';
import {supportConfig,httpsUrl} from '../modules/support/support_config';
import {getPrivacyConsent,updatePrivacyConsent,exportUserData} from '../modules/privacy/privacy_service';
import {assertAiPlanningConsent,aiPlanningOwner} from '../modules/privacy/ai_consent';
import {createStructuredModel} from '../graphworkflow/common/model';
import {plannerSnapshot} from '../graphworkflow/common/measurements';
import {z} from 'zod';
import {Prisma} from '@prisma/client';
import {prismaApiError} from '../utils/api_errors';

const restores:Array<()=>void>=[];
function stub(model:any,key:string,value:any){const old=model[key];model[key]=value;restores.push(()=>{model[key]=old;});}
async function main(){
 const originalEnv={JWT_ACCESS_SECRET:process.env.JWT_ACCESS_SECRET,PRIVACY_POLICY_URL:process.env.PRIVACY_POLICY_URL,OPENAI_API_KEY:process.env.OPENAI_API_KEY};
 const a=randomUUID(),b=randomUUID(),admin=randomUUID();
 const tickets:any[]=[],messages:any[]=[],attachments:any[]=[],events:any[]=[];
 let consent:any=null;
 const ownerRole=(id:string)=>id===admin?'ADMIN':'USER';
 try {
  const schemaFailure=prismaApiError(new Prisma.PrismaClientKnownRequestError('SELECT private_schema.secret FROM private_table',{code:'P2022',clientVersion:'test'}));
  assert.equal(schemaFailure?.status,503);assert.equal(schemaFailure?.body.code,'SERVER_UPDATE_REQUIRED');assert.ok(!JSON.stringify(schemaFailure).includes('private_schema'));
  process.env.JWT_ACCESS_SECRET='local-test-secret-not-a-deployed-credential';
  process.env.PRIVACY_POLICY_URL='https://setcraft.invalid/privacy';
  stub(rateLimitStore,'consume',async()=>({allowed:true,retryAfterSeconds:1}));
  stub(prisma.user,'findUnique',async({where,select}:any)=>{
    if(select?.supportTickets)return {id:a,supportTickets:[]};
    return [a,b,admin].includes(where.id)?{id:where.id,email:`${where.id}@example.invalid`,role:ownerRole(where.id),onboarding:{gender:'OTHER'}}:null;
  });
  stub(prisma.user,'findFirst',async({where}:any)=>where.id===admin?{id:admin}:null);
  stub(prisma,'$queryRaw',async()=>[]);
  stub(prisma,'$transaction',async(fn:any)=>fn(prisma));
  stub(prisma.supportTicket,'findUnique',async({where}:any)=>tickets.find(t=>t.userId===where.userId_clientRequestId.userId&&t.clientRequestId===where.userId_clientRequestId.clientRequestId)||null);
  stub(prisma.supportTicket,'count',async({where}:any)=>tickets.filter(t=>t.userId===where.userId&&t.status!=='RESOLVED').length);
  stub(prisma.supportTicket,'create',async({data}:any)=>{
    const ticket={...data,id:randomUUID(),number:tickets.length+1,status:'OPEN',version:1,createdAt:new Date(),updatedAt:new Date()};
    tickets.push(ticket);const message={...data.messages.create,id:randomUUID(),ticketId:ticket.id,internal:false,createdAt:new Date()};messages.push(message);
    if(message.attachments)attachments.push({...message.attachments.create,id:randomUUID(),messageId:message.id});
    return {id:ticket.id,number:ticket.number};
  });
  stub(prisma.supportTicket,'findFirst',async({where,select}:any)=>{
    const t=tickets.find(t=>t.id===where.id&&(!where.userId||t.userId===where.userId));if(!t)return null;
    if(!select.messages)return {id:t.id,status:t.status};
    return {id:t.id,number:t.number,subject:t.subject,status:t.status,messages:messages.filter(m=>m.ticketId===t.id&&(!select.messages.where.internal||m.internal===false)).filter(m=>select.messages.where.internal===false ? !m.internal:true).map(m=>({id:m.id,body:m.body,authorRole:m.authorRole,internal:m.internal,attachments:attachments.filter(x=>x.messageId===m.id).map(({id,mimeType,byteLength})=>({id,mimeType,byteLength}))}))};
  });
  stub(prisma.supportTicket,'findMany',async()=>[]);
  stub(prisma.supportTicket,'update',async({where,data}:any)=>{const t=tickets.find(t=>t.id===where.id);if(data.status)t.status=data.status;t.version++;return t;});
  stub(prisma.supportTicket,'updateMany',async({where,data}:any)=>{const t=tickets.find(t=>t.id===where.id&&t.version===where.version);if(!t)return {count:0};if(data.status)t.status=data.status;t.assignedToId=data.assignedToId;t.version++;return {count:1};});
  stub(prisma.supportMessage,'findUnique',async({where}:any)=>messages.find(m=>m.requestKey===where.requestKey)||null);
  stub(prisma.supportMessage,'count',async({where}:any)=>messages.filter(m=>m.ticketId===where.ticketId).length);
  stub(prisma.supportMessage,'create',async({data}:any)=>{const m={...data,id:randomUUID(),createdAt:new Date()};messages.push(m);return {id:m.id};});
  stub(prisma.supportAttachment,'count',async()=>attachments.length);
  stub(prisma.supportAttachment,'findFirst',async({where}:any)=>{
    const image=attachments.find(x=>x.id===where.id);if(!image)return null;
    const m=messages.find(m=>m.id===image.messageId),t=tickets.find(t=>t.id===m.ticketId);
    return where.message.ticket && (t.userId!==where.message.ticket.userId||m.internal)?null:image;
  });
  stub(prisma.userPrivacyConsent,'findUnique',async()=>consent);
  stub(prisma.userPrivacyConsent,'upsert',async({create,update}:any)=>{consent=consent?{...consent,...update}:{...create};return consent;});
  stub(prisma.privacyConsentEvent,'create',async({data}:any)=>{events.push(data);return data;});
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0V0AAAAASUVORK5CYII=';
  assert.equal(support.decodeScreenshot({mimeType:'image/png',base64:png})?.byteLength,Buffer.from(png,'base64').length);
  assert.throws(()=>support.decodeScreenshot({mimeType:'image/png',base64:Buffer.from('<svg/>').toString('base64')}),SupportError);
  assert.throws(()=>support.decodeScreenshot({mimeType:'image/png',base64:'not base64'}),SupportError);
  const oversized=Buffer.alloc(24);Buffer.from(png,'base64').copy(oversized,0,0,24);oversized.writeUInt32BE(99999,16);
  assert.throws(()=>support.decodeScreenshot({mimeType:'image/png',base64:oversized.toString('base64')}),SupportError);
  assert.equal(httpsUrl('javascript:alert(1)'),null);assert.equal(httpsUrl('https://user:password@example.invalid'),null);
  assert.ok(!support.redactSupportText('Bearer secret sc_mcp_sensitive eyJhbGci.payload.signature').includes('sensitive'));
  assert.equal(createTicketInput.safeParse({requestId:randomUUID(),category:'BUG',subject:'Hi',body:'short'}).success,false);
  assert.equal(replyInput.safeParse({requestId:randomUUID(),body:'  '}).success,false);
  const input=createTicketInput.parse({requestId:randomUUID(),category:'BUG',subject:'Morning meal missing',body:'My breakfast is missing from Today.',screenshot:{mimeType:'image/png',base64:png}});
  const first=await support.createTicket(a,input);
  assert.deepEqual(await support.createTicket(a,input),first);assert.equal(tickets.length,1,'Create retry is idempotent');
  await assert.rejects(support.createTicket(a,{...input,subject:'Changed request'}),(e:any)=>e.status===409);
  await assert.rejects(support.ticketDetail(b,first.id),(e:any)=>e.status===404);
  await assert.rejects(support.replyToTicket(b,first.id,{requestId:randomUUID(),body:'wrong owner'}),(e:any)=>e.status===404);
  await assert.rejects(support.ticketAttachment(b,attachments[0].id),(e:any)=>e.status===404);
  await support.ticketAttachment(a,attachments[0].id);
  const note={requestId:randomUUID(),body:'Private team note',internal:true};
  await support.replyToTicket(admin,first.id,note,true);
  assert.equal((await support.ticketDetail(a,first.id)).messages.some(m=>m.internal),false,'Internal notes never enter owner JSON');
  assert.equal((await support.ticketDetail(admin,first.id,true)).messages.length,2);
  const reply={requestId:randomUUID(),body:'Please try refreshing.',internal:false};
  await support.replyToTicket(admin,first.id,reply,true);await support.replyToTicket(admin,first.id,reply,true);
  assert.equal(messages.length,3);assert.equal(tickets[0].status,'WAITING_FOR_USER');
  await assert.rejects(support.updateTicket(first.id,{version:1,status:'RESOLVED'}),(e:any)=>e.status===409);
  await assert.rejects(support.updateTicket(first.id,{version:tickets[0].version,assignedToId:b}),(e:any)=>e.status===400);
  await support.updateTicket(first.id,{version:tickets[0].version,status:'RESOLVED',assignedToId:admin});
  await support.replyToTicket(a,first.id,{requestId:randomUUID(),body:'Still need help.'});assert.equal(tickets[0].status,'OPEN');
  const app=express();app.use('/api/support',createSupportRouter());
  const bearer=(id:string)=>jwt.sign({userId:id,role:'ADMIN'},process.env.JWT_ACCESS_SECRET!,{expiresIn:'5m'});
  const get=(url:string,id?:string)=>inject(app,{url,headers:id?{authorization:`Bearer ${bearer(id)}`}:{}});
  assert.equal((await get('/api/support/tickets')).statusCode,401);
  assert.equal((await get('/api/support/admin/tickets',a)).statusCode,403,'A forged role claim cannot override the database');
  assert.equal((await get('/api/support/admin/tickets',admin)).statusCode,200);
  assert.equal((await get(`/api/support/tickets/${first.id}`,b)).statusCode,404);
  assert.equal((await get(`/api/support/attachments/${attachments[0].id}`,b)).statusCode,404);
  assert.equal((await get(`/api/support/attachments/${attachments[0].id}`,a)).headers['cache-control'],'no-store');
  await assert.rejects(assertAiPlanningConsent(a),(e:any)=>e.code==='AI_CONSENT_REQUIRED');
  await assert.rejects(updatePrivacyConsent(a,{aiPlanningConsent:true,aiPlanningPolicyVersion:'old-version'}),(e:any)=>e.status===409);
  await updatePrivacyConsent(a,{aiPlanningConsent:true,aiPlanningPolicyVersion:supportConfig().aiPolicyVersion});await assertAiPlanningConsent(a);
  await updatePrivacyConsent(a,{aiPlanningConsent:false});assert.equal(events.length,2);assert.equal(events[1].granted,false);
  process.env.OPENAI_API_KEY='test-placeholder-never-sent';
  let providerCalls=0;stub(globalThis,'fetch',async()=>{providerCalls++;throw Error('No network allowed');});
  await assert.rejects(aiPlanningOwner.run(a,()=>createStructuredModel(20,1)(z.object({ok:z.boolean()}),'test',{},()=>{})),(e:any)=>e.code==='AI_CONSENT_REQUIRED');
  assert.equal(providerCalls,0,'Revocation prevents the actual provider boundary');
  const sanitized=plannerSnapshot({freshPhotos:[{base64Data:'private'}],health:[{sleepMinutes:300}],wellness:[{source:'HealthKit'},{source:'self_report'}],measurements:[]} as any);
  assert.deepEqual(sanitized.health,[]);assert.equal(sanitized.wellness.length,1);assert.ok(!('freshPhotos' in sanitized));
  const exported=await exportUserData(a);assert.ok(!('gdprCompliant' in exported));assert.equal(exported.formatVersion,1);
  console.log('Support/privacy checks passed: strict auth and admin roles, ownership, private attachments, internal notes, duplicate retries, stale edits, status reopening, validation, consent audit and zero provider calls after revocation. No live services used.');
 } finally {
  restores.reverse().forEach(restore=>restore());
  for(const [key,value] of Object.entries(originalEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  await prisma.$disconnect();
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
