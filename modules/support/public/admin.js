"use strict";
const $=id=>document.getElementById(id);
let token=null,selected=null,cursor=null,staff=[],generation=0,replyId=null;
const objectUrls=[];
const labels={OPEN:"Open",IN_PROGRESS:"In progress",WAITING_FOR_USER:"Waiting for user",RESOLVED:"Resolved"};
const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
function notice(error){$("notice").textContent=error instanceof Error?error.message:String(error||"");}
function clearImages(){objectUrls.splice(0).forEach(url=>URL.revokeObjectURL(url));}
function signOut(){generation++;token=null;selected=null;staff=[];replyId=null;clearImages();$("inbox").hidden=true;$("logout").hidden=true;$("login").hidden=false;$("tickets").replaceChildren();$("detail").replaceChildren();}
async function api(path,options={}){
 const session=token, response=await fetch(path,{...options,cache:"no-store",headers:{"Content-Type":"application/json",...(session?{Authorization:`Bearer ${session}`}:{})}});
 const data=await response.json();
 if(session!==token)throw Error("Your session changed.");
 if(!response.ok){if(response.status===401||response.status===403)signOut();throw Error(typeof data.error==="string"?data.error:"This request could not be completed.");}
 return data.data??data;
}
async function loadTickets(append=false){
 const session=generation, query=new URLSearchParams();if($("filter").value)query.set("status",$("filter").value);if(append&&cursor)query.set("cursor",cursor);
 const data=await api(`/api/support/admin/tickets?${query}`);if(session!==generation)return;
 if(!append)$("tickets").replaceChildren();cursor=data.nextCursor;$("more").hidden=!cursor;
 for(const ticket of data.tickets){const button=el("button",undefined,"ticket");button.append(el("span",`#${ticket.number} · ${labels[ticket.status]}`,"meta"),el("strong",ticket.subject),el("span",ticket.user.email,"meta"));button.onclick=()=>openTicket(ticket.id).catch(notice);$("tickets").append(button);}
 $("empty").hidden=$("tickets").childElementCount>0;
}
async function openTicket(id){
 const session=++generation, ticket=await api(`/api/support/admin/tickets/${id}`);if(session!==generation)return;
 selected=ticket;replyId=crypto.randomUUID();let replyFingerprint=null;clearImages();const root=$("detail");root.replaceChildren();
 root.append(el("div",`#${ticket.number} · ${ticket.category}`,"eyebrow"),el("h2",ticket.subject),el("p",ticket.user.email));
 const tools=el("div",undefined,"tools"), status=el("select"),assigned=el("select"),save=el("button","Update","secondary");
 status.setAttribute("aria-label","Ticket status");assigned.setAttribute("aria-label","Assigned admin");
 for(const [value,label]of Object.entries(labels)){const option=el("option",label);option.value=value;status.append(option);}status.value=ticket.status;
 const unassigned=el("option","Unassigned");unassigned.value="";assigned.append(unassigned);
 for(const person of staff){const option=el("option",person.email);option.value=person.id;assigned.append(option);}assigned.value=ticket.assignedToId||"";
 save.onclick=async()=>{save.disabled=true;try{await api(`/api/support/admin/tickets/${id}`,{method:"PATCH",body:JSON.stringify({version:ticket.version,status:status.value,assignedToId:assigned.value||null})});await openTicket(id);await loadTickets();notice("");}catch(error){notice(error);}finally{save.disabled=false;}};
 tools.append(status,assigned,save);root.append(tools);
 for(const message of ticket.messages){
  const block=el("div",undefined,`message ${message.internal?"internal":message.authorRole==="ADMIN"?"staff":""}`);
  block.append(el("div",`${message.internal?"Internal note":message.authorRole==="ADMIN"?"Setcraft support":"Customer"} · ${new Date(message.createdAt).toLocaleString()}`,"meta"),el("p",message.body,"body"));root.append(block);
  for(const attachment of message.attachments){const button=el("button","View screenshot","secondary");block.append(button);button.onclick=async()=>{
   button.disabled=true;try{const response=await fetch(`/api/support/admin/attachments/${attachment.id}`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"});if(!response.ok)throw Error("Screenshot unavailable.");const blob=await response.blob();if(session!==generation)return;const url=URL.createObjectURL(blob);objectUrls.push(url);const image=el("img");image.src=url;image.alt="Customer screenshot";block.append(image);button.remove();}catch(error){notice(error);button.disabled=false;}
  };}
 }
 if(ticket.diagnostics){const details=el("details"),summary=el("summary","App diagnostics");details.append(summary,el("pre",JSON.stringify(ticket.diagnostics,null,2)));root.append(details);}
 const form=el("form"),label=el("label","Reply"),body=el("textarea"),check=el("label",undefined,"check"),internal=el("input"),send=el("button","Send reply");
 body.maxLength=4000;body.required=true;body.setAttribute("aria-label","Reply message");internal.type="checkbox";check.append(internal,el("span","Internal note · hidden from customer"));
 form.append(label,body,check,send);root.append(form);
 form.onsubmit=async event=>{event.preventDefault();if(!body.value.trim())return;const fingerprint=JSON.stringify([body.value.trim(),internal.checked]);if(replyFingerprint!==fingerprint){replyId=crypto.randomUUID();replyFingerprint=fingerprint;}send.disabled=true;try{await api(`/api/support/admin/tickets/${id}/messages`,{method:"POST",body:JSON.stringify({requestId:replyId,body:body.value.trim(),internal:internal.checked})});await openTicket(id);await loadTickets();notice("");}catch(error){notice(error);}finally{send.disabled=false;}};
}
$("login").onsubmit=async event=>{event.preventDefault();const button=$("login").querySelector("button");button.disabled=true;notice("");try{
 const auth=await api("/api/auth/login",{method:"POST",body:JSON.stringify({email:$("email").value.trim(),password:$("password").value})});
 token=auth.tokens.accessToken;$("password").value="";
 staff=await api("/api/support/admin/staff");$("login").hidden=true;$("inbox").hidden=false;$("logout").hidden=false;await loadTickets();
}catch(error){signOut();notice(error);}finally{button.disabled=false;}};
$("logout").onclick=signOut;$("filter").onchange=()=>{generation++;loadTickets().catch(notice);};$("refresh").onclick=()=>{loadTickets().catch(notice);if(selected)openTicket(selected.id).catch(notice);};$("more").onclick=()=>loadTickets(true).catch(notice);
