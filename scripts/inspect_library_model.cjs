require('dotenv').config({quiet:true});
require('tsx/cjs');
const {OpenAIContentClient,defaultAIModel}=require('../utils/openai_client.ts');
async function main(){
 const model=process.argv.slice(2).find(arg=>!arg.startsWith('--'))||process.env.OPENAI_TRANSLATION_MODEL||defaultAIModel();
 try {
  const response=await new OpenAIContentClient({timeoutMs:60000,reasoningEffort:'low'}).generateContent({
   model,contents:'Reply with the single word OK.',config:{maxOutputTokens:1024}});
  console.log(JSON.stringify({model:response.modelVersion,available:response.text.trim()==='OK'}));
 }catch(error){console.log(JSON.stringify({model,available:false,status:error.status,code:error.code||'transport_error'}));process.exitCode=1;}
}
main().catch(()=>{console.error('Model inspection could not finish.');process.exitCode=1;});
