import prisma from '../config/prisma';
// Operator-run only. Existing accounts must be selected explicitly.
async function main(){
 const email=process.argv.find(v=>v.startsWith('--email='))?.slice(8).trim();
 if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Use --email=existing-admin@example.com [--apply].');
 const user=await prisma.user.findUnique({where:{email},select:{id:true,email:true,role:true}});
 if(!user)throw new Error('Create a Setcraft email/password account first. No account was changed.');
 if(!process.argv.includes('--apply')){console.log(`Selected ${user.email}; current role ${user.role}. Add --apply to grant ADMIN access.`);return;}
 await prisma.user.update({where:{id:user.id},data:{role:'ADMIN'}});
 console.log(`Admin access enabled for ${user.email}. Sign in at /support/admin.`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());
