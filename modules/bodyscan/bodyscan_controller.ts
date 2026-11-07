import { Request, Response } from "express";
import { getScanHistory, getScanById, getLatestScan } from "./bodyscan_service";

// Historical records stay readable. New physique records use the reviewed-photo
// API; the old ratio-based extractor must never create more synthetic scans.
export async function handleProcessScan(_req:Request,res:Response) {
  res.status(410).json({error:"Photo scans are no longer available. Use /api/body/entries for entered measurements."});
}
export const handleCaptureScan=handleProcessScan;
export async function handleGetJobStatus(_req:Request,res:Response) {
  res.status(410).json({error:"Legacy scan jobs are no longer created. Use the private body review API."});
}
export async function handleGetHistory(req:Request,res:Response) {
  try {res.json(await getScanHistory(req.user!.userId));}
  catch {res.status(500).json({error:"Could not load historical scans."});}
}
export async function handleGetLatestScan(req:Request,res:Response) {
  try {res.json(await getLatestScan(req.user!.userId));}
  catch {res.status(500).json({error:"Could not load historical scans."});}
}
export async function handleGetScanById(req:Request,res:Response) {
  try {
    const scan=await getScanById(req.user!.userId,String(req.params.id));
    if(!scan) {res.status(404).json({error:"Scan not found."});return;}
    res.json(scan);
  } catch {res.status(500).json({error:"Could not load this historical scan."});}
}
