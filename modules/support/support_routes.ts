import express, { Router, RequestHandler } from "express";
import { z } from "zod";
import { authenticateStrict, requireRole } from "../../middleware/auth";
import { rateLimit } from "../../middleware/rate_limit";
import * as service from "./support_service";
import { supportConfig } from "./support_config";
import {prismaApiError} from '../../utils/api_errors';
import { createTicketInput, replyInput, adminReplyInput, adminUpdateInput, listTicketsInput, SupportError } from "./support_types";

// Dependency seams let route/authorization tests run without a database or Redis.
export function createSupportRouter(deps: {auth?:RequestHandler; createLimit?:RequestHandler; replyLimit?:RequestHandler; service?:typeof service} = {}) {
  const router=Router(), api=deps.service ?? service;
  router.get("/config",(_req,res)=>res.set('Cache-Control','no-store').json({data:supportConfig()}));
  router.use(deps.auth ?? authenticateStrict);
  router.use(express.json({limit:"2mb"}));
  router.use((_req,res,next)=>{res.set("Cache-Control","no-store"); next();});
  const handle=(action:(req:any,res:any)=>Promise<void>):RequestHandler=>async(req,res,next)=>{
    try { await action(req,res); } catch(error) {
      if(error instanceof SupportError) res.status(error.status).json({error:error.message});
      else if(error instanceof z.ZodError) res.status(400).json({error:"Check the ticket fields and try again."});
      else { const databaseError=prismaApiError(error); console.warn("Support request failed", {code:(error as {code?:string})?.code ?? "UNKNOWN"}); if(databaseError)res.status(databaseError.status).json(databaseError.body); else res.status(500).json({error:"Support is temporarily unavailable. Please try again."}); }
    }
  };
  const id=(value:unknown)=>z.uuid().parse(value);
  router.get("/tickets",handle(async(req,res)=>{res.json({data:await api.listTickets(req.user.userId,listTicketsInput.parse(req.query))});}));
  router.post("/tickets",deps.createLimit ?? rateLimit("supportCreate"),handle(async(req,res)=>{res.status(201).json({data:await api.createTicket(req.user.userId,createTicketInput.parse(req.body))});}));
  router.get("/tickets/:id",handle(async(req,res)=>{res.json({data:await api.ticketDetail(req.user.userId,id(req.params.id))});}));
  router.post("/tickets/:id/messages",deps.replyLimit ?? rateLimit("supportReply"),handle(async(req,res)=>{res.status(201).json({data:await api.replyToTicket(req.user.userId,id(req.params.id),replyInput.parse(req.body))});}));
  router.get("/attachments/:id",handle(async(req,res)=>{
    const image=await api.ticketAttachment(req.user.userId,id(req.params.id),false);
    res.set({"Content-Type":image.mimeType,"Content-Disposition":"inline","X-Content-Type-Options":"nosniff"}).send(Buffer.from(image.data));
  }));
  router.use("/admin",requireRole("ADMIN"));
  router.get("/admin/staff",handle(async(_req,res)=>{res.json({data:await api.supportStaff()});}));
  router.get("/admin/tickets",handle(async(req,res)=>{res.json({data:await api.listTickets(req.user.userId,listTicketsInput.parse(req.query),true)});}));
  router.get("/admin/tickets/:id",handle(async(req,res)=>{res.json({data:await api.ticketDetail(req.user.userId,id(req.params.id),true)});}));
  router.patch("/admin/tickets/:id",handle(async(req,res)=>{res.json({data:await api.updateTicket(id(req.params.id),adminUpdateInput.parse(req.body))});}));
  router.post("/admin/tickets/:id/messages",deps.replyLimit ?? rateLimit("supportReply"),handle(async(req,res)=>{res.status(201).json({data:await api.replyToTicket(req.user.userId,id(req.params.id),adminReplyInput.parse(req.body),true)});}));
  router.get("/admin/attachments/:id",handle(async(req,res)=>{
    const image=await api.ticketAttachment(req.user.userId,id(req.params.id),true);
    res.set({"Content-Type":image.mimeType,"Content-Disposition":"inline","X-Content-Type-Options":"nosniff"}).send(Buffer.from(image.data));
  }));
  return router;
}
export default createSupportRouter();
