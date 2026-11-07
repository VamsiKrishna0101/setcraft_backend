import { Router } from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
export const supportPages=Router();
const source=existsSync(resolve(__dirname,"public")) ? resolve(__dirname,"public") : resolve(__dirname,"../../../modules/support/public");
for (const [route,file] of [["/","index.html"],["/admin","admin.html"],["/admin.js","admin.js"],["/contact.js","contact.js"],["/style.css","style.css"]]) {
  supportPages.get(route,(_req,res)=>{res.set("Cache-Control","no-store"); res.sendFile(resolve(source,file));});
}
