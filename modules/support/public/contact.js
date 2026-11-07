fetch('/api/support/config',{cache:'no-store'}).then(response=>{if(!response.ok)throw Error();return response.json();}).then(({data})=>{
 const contact=document.getElementById('contact');contact.replaceChildren();
 if(data.supportEmail){const link=document.createElement('a');link.href=`mailto:${data.supportEmail}`;link.textContent=data.supportEmail;contact.append(link);}else{contact.textContent='A support email has not been published yet.';}
 for(const [label,url]of [['Privacy policy',data.privacyPolicyUrl],['Terms of use',data.termsUrl]]){if(url){const link=document.createElement('a');link.textContent=label;link.href=url;document.getElementById('legal').append(link,document.createTextNode('  '));}}
}).catch(()=>{document.getElementById('contact').textContent='Support details could not be loaded. Please try again.';});
