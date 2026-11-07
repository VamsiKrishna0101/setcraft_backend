import prisma from "../../config/prisma";
import { OnboardingInput, OnboardingResponse, UpdateOnboardingInput } from "./onboarding_types";
import redis from "../../config/redis";
import { equipmentCategories } from './equipment_catalog';

async function invalidateProfileCaches(userId: string) {
    try { await Promise.all([redis.del(`user:${userId}`), redis.del(`home:${userId}`)]); }
    catch { console.warn("Profile saved; cache invalidation unavailable."); }
}

export async function createOnboarding(userId: string, input: OnboardingInput): Promise<OnboardingResponse> {
    const {
        workingToward,
        language,
        name,
        age,
        gender,
        height,
        weight,
        targetWeight,
        experience,
        daysPerWeek,
        workoutDuration,
        trainingLocation,
        equipment,
        activityLevel,
        sleepDuration,
        eatingStyle,
        customEatingStyle,
        weeklyFoodBudget,
        limitations,
    } = input;

    if (!userId) {
        throw new Error("User ID is required");
    }

    const hasUserOnboarded = await prisma.onboarding.findUnique({
        where: {
            userId,
        },
    });

    if (hasUserOnboarded) {
        throw new Error("User has already onboarded");
    }

    const onboardedUser = await prisma.onboarding.create({
        data: {
            userId,
            workingToward,
            language,
            name,
            age,
            gender,
            height,
            weight,
            targetWeight: targetWeight ?? null,
            experience,
            daysPerWeek,
            workoutDuration,
            trainingLocation,
            equipment: input.equipmentIds ? equipmentCategories(input.equipmentIds) : equipment,
            equipmentIds: input.equipmentIds ?? [],
            activityLevel,
            sleepDuration,
            eatingStyle,
            customEatingStyle:
                eatingStyle === "OTHER" ? customEatingStyle?.trim() || null : null,
            weeklyFoodBudget: weeklyFoodBudget ?? null,
            limitations,
            countryCode: input.countryCode,
            preferredTime: input.preferredTime,
            trainingDays: input.trainingDays,
            trainingSplit: input.trainingSplit,
            customTrainingSplit: input.customTrainingSplit,
            focusMuscles: input.focusMuscles,
            customLimitations: input.customLimitations,
            foodAllergies: input.foodAllergies,
            dislikedFoods: input.dislikedFoods,
            foodBudgetAmount: input.foodBudgetAmount,
            foodBudgetCurrency: input.foodBudgetCurrency,
        },
    });

    await invalidateProfileCaches(userId);

    return onboardedUser;
}


export async function getOnboardinguser(userId: string) {
    // Preferences must reflect the current schema and the member's latest edits.
    const user = await prisma.onboarding.findUnique({
        where: {
            userId: userId,
        },
    });

    return user;
}

export async function updateOnboardinguser(userId: string, input: UpdateOnboardingInput) {
    const user = await prisma.onboarding.update({
        where: {
            userId: userId,
        },
        data: {
            ...input,
            ...(input.equipmentIds ? { equipment: equipmentCategories(input.equipmentIds) } :
                input.equipment ? { equipmentIds: [] } : {}),
        },
    });

    await invalidateProfileCaches(userId);

    return user;
}
