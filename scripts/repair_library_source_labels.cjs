// Explicit filename declaration typo, not inference about a person's appearance.
const fs=require('node:fs');
const dir='build/exercise-library-v2/';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const publicFile='../media-imports/lyfta-inspection/public-exercise-media.json';
const sources=read(publicFile);const urls=new Set(sources.filter(v=>/\(femele\)/i.test(v.filename)).map(v=>v.url));
for(const v of sources)if(urls.has(v.url))v.gender='female';
fs.writeFileSync(publicFile,JSON.stringify(sources,null,2));
const plan=read(dir+'plan.json');for(const v of plan.sources)if(urls.has(v.url))v.gender='female';
for(const group of plan.groups){for(const v of group.sources)if(urls.has(v.url))v.gender='female';if(group.sources.some(v=>urls.has(v.url)))group.name=group.name.replace(/\s*\(femele\)\s*/gi,' ').trim();}
fs.writeFileSync(dir+'plan.json',JSON.stringify(plan,null,2));
const downloaded=read(dir+'downloaded.json');for(const v of downloaded.videos)if(urls.has(v.url))v.gender='female';fs.writeFileSync(dir+'downloaded.json',JSON.stringify(downloaded,null,2));
const summary=read(dir+'summary.json');summary.male=sources.filter(v=>v.gender==='male').length;summary.female=sources.filter(v=>v.gender==='female').length;summary.explicitSourceLabelTyposCorrected=urls.size;fs.writeFileSync(dir+'summary.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify({explicitSourceLabelTyposCorrected:urls.size,male:summary.male,female:summary.female}));
