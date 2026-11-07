import { createHash } from "node:crypto";
import { Prisma, Role } from "@prisma/client";
import { z } from "zod";
import prisma from "../../config/prisma";
import { createTicketInput, replyInput, adminReplyInput, adminUpdateInput, listTicketsInput, MAX_SUPPORT_IMAGE_BYTES, SupportError } from "./support_types";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function redactSupportText(value: string) {
  return value.replace(/Bearer\s+\S+/gi, "[credential removed]")
    .replace(/\bsc_mcp_[A-Za-z0-9_-]+/g, "[credential removed]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[credential removed]");
}

// A screenshot stays private in the database. No public object URL or raw bytes
// are returned in ticket JSON; the authenticated attachment route checks ownership.
export function decodeScreenshot(input?: {mimeType: string; base64: string}) {
  if (!input) return undefined;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64)) throw new SupportError(400, "Invalid screenshot encoding.");
  const data = Buffer.from(input.base64, "base64");
  if (!data.length || data.length > MAX_SUPPORT_IMAGE_BYTES) throw new SupportError(400, "Use a screenshot smaller than 1 MB.");
  let width = 0, height = 0;
  if (input.mimeType === "image/png" && data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && data.toString("ascii",12,16) === "IHDR") {
    width = data.readUInt32BE(16); height = data.readUInt32BE(20);
  } else if (input.mimeType === "image/jpeg" && data[0] === 255 && data[1] === 216) {
    let i = 2;
    while (i + 4 <= data.length) {
      if (data[i++] !== 255) break;
      while (data[i] === 255) i++;
      const marker = data[i++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (i + 2 > data.length) break;
      const length = data.readUInt16BE(i);
      if (length < 2 || i + length > data.length) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && length >= 7) {
        height = data.readUInt16BE(i + 3); width = data.readUInt16BE(i + 5); break;
      }
      i += length;
    }
  }
  if (!width || !height || width > 4096 || height > 4096) throw new SupportError(400, "Use a PNG or JPEG screenshot up to 4096 pixels per side.");
  return { mimeType: input.mimeType, byteLength: data.length, data };
}

const summarySelect = { id: true, number: true, subject: true, category: true, status: true, version: true, createdAt: true, updatedAt: true } satisfies Prisma.SupportTicketSelect;
const messageSelect = { id: true, authorRole: true, body: true, internal: true, createdAt: true, attachments: {select: {id:true, mimeType:true, byteLength:true}} } satisfies Prisma.SupportMessageSelect;
const adminSelect = { assignedToId:true, diagnostics:true, user: {select: {id:true,email:true}}, assignedTo: {select: {id:true,email:true}} } satisfies Prisma.SupportTicketSelect;
type Tx = Prisma.TransactionClient;
async function ownedTicket(tx: Tx, userId: string, id: string, admin: boolean) {
  const ticket = await tx.supportTicket.findFirst({where: {id, ...(admin ? {} : {userId})}, select: {id:true, status:true}});
  if (!ticket) throw new SupportError(404, "Ticket not found.");
  return ticket;
}
export async function listTickets(userId: string, query: z.infer<typeof listTicketsInput>, admin = false) {
  const rows = await prisma.supportTicket.findMany({
    where: {...(admin ? {} : {userId}), status:query.status, category:query.category},
    select: {...summarySelect, ...(admin ? adminSelect : {})},
    orderBy: [{updatedAt:"desc"},{id:"desc"}], take:31,
    ...(query.cursor ? {cursor:{id:query.cursor}, skip:1} : {}),
  });
  return {tickets:rows.slice(0,30), nextCursor: rows.length > 30 ? rows[29].id : null};
}
export async function ticketDetail(userId: string, id: string, admin = false) {
  const ticket = await prisma.supportTicket.findFirst({
    where: {id, ...(admin ? {} : {userId})},
    select: {...summarySelect, ...(admin ? adminSelect : {}), messages: {where:admin ? {} : {internal:false}, orderBy:[{createdAt:"asc"},{id:"asc"}], select:messageSelect}},
  });
  if (!ticket) throw new SupportError(404, "Ticket not found.");
  return ticket;
}
export async function createTicket(userId: string, input: z.infer<typeof createTicketInput>) {
  const requestHash = hash(input);
  const image = decodeScreenshot(input.screenshot);
  return prisma.$transaction(async tx => {
    // Serialize per account, including retries, without relying on process memory.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const previous = await tx.supportTicket.findUnique({where:{userId_clientRequestId:{userId,clientRequestId:input.requestId}}});
    if (previous) {
      if (previous.requestHash !== requestHash) throw new SupportError(409,"This request ID was already used for another ticket.");
      return {id:previous.id,number:previous.number};
    }
    if (await tx.supportTicket.count({where:{userId,status:{not:"RESOLVED"}}}) >= 20) throw new SupportError(409,"You have 20 open tickets. Reply to an existing ticket instead.");
    return tx.supportTicket.create({data:{
      userId, category:input.category, subject:redactSupportText(input.subject),
      clientRequestId:input.requestId,requestHash,diagnostics:input.diagnostics,
      messages:{create:{authorId:userId, authorRole:"USER", body:redactSupportText(input.body), requestKey:hash([userId,input.requestId]),requestHash,
        ...(image ? {attachments:{create:image}} : {})}},
    },select:{id:true,number:true}});
  });
}
export async function replyToTicket(userId:string,id:string,input:z.infer<typeof replyInput> | z.infer<typeof adminReplyInput>,admin=false) {
  const requestKey=hash([userId,id,input.requestId]), requestHash=hash(input), image=decodeScreenshot(input.screenshot);
  return prisma.$transaction(async tx=>{
    // Check ownership before locking so inaccessible IDs have the same 404 response.
    await ownedTicket(tx,userId,id,admin);
    await tx.$queryRaw`SELECT "id" FROM "SupportTicket" WHERE "id" = ${id} FOR UPDATE`;
    const previous=await tx.supportMessage.findUnique({where:{requestKey}});
    if (previous) {
      if (previous.requestHash!==requestHash) throw new SupportError(409,"This request ID was already used for another reply.");
      return {id:previous.id};
    }
    if (await tx.supportMessage.count({where:{ticketId:id}})>=200) throw new SupportError(409,"This conversation has reached its limit. Please open a new ticket.");
    if (image && await tx.supportAttachment.count({where:{message:{ticketId:id}}})>=5) throw new SupportError(409,"A ticket can contain up to five screenshots.");
    const internal=admin && "internal" in input && input.internal;
    const message=await tx.supportMessage.create({data:{ticketId:id,authorId:userId,authorRole:admin ? "ADMIN":"USER",body:redactSupportText(input.body),internal,requestKey,requestHash,...(image ? {attachments:{create:image}} : {})},select:{id:true}});
    await tx.supportTicket.update({where:{id},data:{version:{increment:1},...(!internal ? {status:admin ? "WAITING_FOR_USER":"OPEN"} : {})}});
    return message;
  });
}
export async function updateTicket(id:string,input:z.infer<typeof adminUpdateInput>) {
  return prisma.$transaction(async tx=>{
    if (input.assignedToId && !await tx.user.findFirst({where:{id:input.assignedToId,role:"ADMIN"},select:{id:true}})) throw new SupportError(400,"Assign tickets to an existing admin account.");
    const result=await tx.supportTicket.updateMany({where:{id,version:input.version},data:{status:input.status,assignedToId:input.assignedToId,version:{increment:1}}});
    if (!result.count) throw new SupportError(409,"This ticket changed. Refresh it before updating.");
    return {success:true};
  });
}
export async function ticketAttachment(userId:string,id:string,admin=false) {
  const attachment=await prisma.supportAttachment.findFirst({where:{id,message:{...(!admin ? {internal:false,ticket:{userId}} : {})}},select:{data:true,mimeType:true}});
  if (!attachment) throw new SupportError(404,"Screenshot not found.");
  return attachment;
}
export async function supportStaff() {
  return prisma.user.findMany({where:{role:Role.ADMIN},select:{id:true,email:true},orderBy:{email:"asc"},take:100});
}
