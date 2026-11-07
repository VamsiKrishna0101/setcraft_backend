import { z } from "zod";
export const supportCategories = ["ACCOUNT", "BILLING", "WORKOUTS", "NUTRITION", "PRIVACY", "BUG", "OTHER"] as const;
export const supportStatuses = ["OPEN", "IN_PROGRESS", "WAITING_FOR_USER", "RESOLVED"] as const;
export const MAX_SUPPORT_IMAGE_BYTES = 1024 * 1024;
const screenshot = z.object({mimeType:z.enum(["image/png","image/jpeg"]),base64:z.string().min(4).max(1398104)}).strict();
const diagnostics = z.object({appVersion:z.string().trim().max(60),buildNumber:z.string().trim().max(60),platform:z.enum(["android","ios","other"]),osVersion:z.string().trim().max(120)}).strict();
export const createTicketInput=z.object({requestId:z.uuid(),category:z.enum(supportCategories),subject:z.string().trim().min(4).max(120),body:z.string().trim().min(10).max(4000),screenshot:screenshot.optional(),diagnostics:diagnostics.optional()}).strict();
export const replyInput=z.object({requestId:z.uuid(),body:z.string().trim().min(1).max(4000),screenshot:screenshot.optional()}).strict();
export const adminReplyInput=replyInput.extend({internal:z.boolean().default(false)});
export const adminUpdateInput=z.object({version:z.number().int().positive(),status:z.enum(supportStatuses).optional(),assignedToId:z.uuid().nullable().optional()}).strict().refine(v=>v.status!==undefined||v.assignedToId!==undefined,"Choose a status or an assignee.");
export const listTicketsInput=z.object({cursor:z.uuid().optional(),status:z.enum(supportStatuses).optional(),category:z.enum(supportCategories).optional()}).strict();
export class SupportError extends Error {constructor(public status:number,message:string){super(message);}}
