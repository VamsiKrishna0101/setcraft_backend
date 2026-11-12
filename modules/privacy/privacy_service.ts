import prisma from "../../config/prisma";
import redis from "../../config/redis";
import { ConsentUpdateInput } from "./privacy_types";
import { queuePhotoDeletion, flushBodyPhotoDeletions } from '../body/body_photo_storage';
import { supportConfig } from '../support/support_config';
import { SupportError } from '../support/support_types';
import {removeDeletedPlannerData} from './planner_data_cleanup';
import { firebaseAuthentication } from '../../config/firebase';

export async function exportUserData(userId: string) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            email: true,
            role: true,
            createdAt: true,
            trialStartedAt: true,
            trialEndsAt: true,
            subscriptions: { select: { status: true, currentPeriodEnd: true, cancelAtPeriodEnd: true,
                storeProductId: true, storeCountryCode: true } },
            onboarding: true,
            privacyConsent: true,
            privacyConsentEvents: true,
            supportTickets: {select:{id:true,number:true,category:true,subject:true,status:true,createdAt:true,updatedAt:true,
                messages:{where:{internal:false},select:{body:true,authorRole:true,createdAt:true,attachments:{select:{id:true,mimeType:true,byteLength:true}}}}}},
            notificationPreference: true,
            notificationDevices: { select: { platform: true, lastSeenAt: true } },
            notificationJobs: { select: { type: true, date: true, activityDate: true, status: true, reason: true, createdAt: true, sentAt: true, openedAt: true } },
            mcpAccessTokens: { select: {id: true, name: true, lastFour: true, scopes: true, createdAt: true, expiresAt: true, lastUsedAt: true, revokedAt: true} },
            mcpAuditEvents: {select: {tokenId: true, action: true, outcome: true, durationMs: true, createdAt: true}, orderBy: {createdAt: 'desc'}, where: {createdAt: {gte: new Date(Date.now() - 30 * 86400000)}}},
            muscleCheckIns: true,
            dailyWellness: true,
            weeklyPersonalPlans: true,
            plannerDemoWeeks: true,
            bodyAssessments: { include: { photos: { select: { id:true,view:true,mimeType:true } } } },
            progressPhotos: {select:{id:true,recordedDate:true,workoutDate:true,createdAt:true}},
            companion: { include: { rewards: true } },
            healthKitSnapshots: true,
            healthKitWorkouts: true,
            mealLogs: {
                include: {
                    nutrition: true,
                },
            },
            waterLogs: true,
            nutritionSettings: true,
            mealRoutines: true,
            mealOccurrences: true,
            customFoods: true,
            workoutSessions: true,
            workoutRoutines: true,
            workoutDays: true,
            userWorkouts: {
                include: {
                    items: {
                        include: {
                            workout: true,
                            setLogs: true,
                        },
                    },
                },
            },
        },
    });

    if (!user) {
        throw new Error("User not found");
    }

    return {
        exportTimestamp: new Date().toISOString(),
        formatVersion: 1,
        user,
    };
}

export async function deleteUserAccount(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
        throw new Error("User not found");
    }

    const identities=await prisma.authIdentity.findMany({where:{userId},select:{firebaseUid:true}});
    await prisma.$transaction(async tx=> {
        const photos=await tx.bodyAssessmentPhoto.findMany({where:{assessment:{userId}}});
        await queuePhotoDeletion(tx,photos);
        const progressPhotos=await tx.progressPhoto.findMany({where:{userId}});
        await queuePhotoDeletion(tx,progressPhotos.flatMap(p=>[
            {bucket:p.bucket,objectKey:p.objectKey},
            {bucket:p.bucket,objectKey:p.thumbnailKey},
        ]));
        await tx.user.delete({where:{id:userId}});
    });
    await flushBodyPhotoDeletions().catch(()=>console.warn('Body photo cleanup will retry.'));
    await removeDeletedPlannerData().catch(()=>console.warn('Planner privacy cleanup will retry.'));

    // Remove the linked Apple/Google sign-in identity from Firebase as well.
    // The app revokes Sign in with Apple tokens before calling this endpoint.
    await deleteFirebaseIdentities(identities.map(i=>i.firebaseUid))
        .catch(()=>console.warn('Firebase identity cleanup was unavailable.'));

    try {
        // SCAN instead of KEYS so large keyspaces never block Redis.
        const keys:string[]=[];
        let cursor='0';
        do {
            const [next,batch]=await redis.scan(cursor,{match:`*${userId}*`,count:500});
            cursor=String(next); keys.push(...batch.map(String));
        } while(cursor!=='0');
        await redis.del(...keys, `otp:${user.email}`, `verified:${user.email}`);
    } catch { console.warn('Deleted account cache cleanup was unavailable.'); }

    return { success: true, message: "Account deleted." };
}

async function deleteFirebaseIdentities(uids:string[]) {
    if(!uids.length) return;
    const auth=firebaseAuthentication();
    if(!auth) return;
    await auth.deleteUsers(uids);
}

/** Which social providers this account uses (for Apple token revocation). */
export async function getSignInMethods(userId: string) {
    const identities=await prisma.authIdentity.findMany({where:{userId},select:{firebaseUid:true}});
    const auth=identities.length ? firebaseAuthentication() : null;
    if(!auth) return {apple:false};
    try {
        const {users}=await auth.getUsers(identities.map(i=>({uid:i.firebaseUid})));
        return {apple:users.some(u=>u.providerData.some(p=>p.providerId==='apple.com'))};
    } catch { return {apple:false}; }
}

export async function getPrivacyConsent(userId: string) {
    return prisma.userPrivacyConsent.upsert({
        where: { userId },
        create: { userId },
        update: {},
    });
}

export async function updatePrivacyConsent(userId: string, input: ConsentUpdateInput) {
    const config=supportConfig();
    if(input.aiPlanningConsent===true && (!config.privacyPolicyUrl || input.aiPlanningPolicyVersion!==config.aiPolicyVersion)) throw new SupportError(409,'The privacy policy must be published and the current AI sharing notice accepted.');
    const {aiPlanningPolicyVersion:_version,...changes}=input;
    return prisma.$transaction(async tx=>{
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId} FOR UPDATE`;
        const aiChanges=input.aiPlanningConsent===undefined ? {} : {
            aiPlanningConsent:input.aiPlanningConsent,
            aiPlanningPolicyVersion:config.aiPolicyVersion,
            ...(input.aiPlanningConsent ? {aiPlanningAcceptedAt:new Date(),aiPlanningWithdrawnAt:null} : {aiPlanningWithdrawnAt:new Date()}),
        };
        const result=await tx.userPrivacyConsent.upsert({where:{userId},create:{userId,...changes,...aiChanges},update:{...changes,...aiChanges}});
        if(input.aiPlanningConsent!==undefined) await tx.privacyConsentEvent.create({data:{userId,scope:'aiPlanning',granted:input.aiPlanningConsent,policyVersion:config.aiPolicyVersion,provider:config.aiProvider}});
        return result;
    });
}
