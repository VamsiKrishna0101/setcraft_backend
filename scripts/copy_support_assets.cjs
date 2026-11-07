const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
fs.cpSync(path.join(root,'modules/support/public'),path.join(root,'dist/modules/support/public'),{recursive:true});
