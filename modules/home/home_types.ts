export interface MacroTarget {
    consumed: number;
    target: number;
}

export interface WeekDay {
    day: string;
    dateNum?: number;
    status: "COMPLETED" | "IN_PROGRESS" | "REST_DAY" | "NOT_STARTED" | "SKIPPED" | "UNAVAILABLE";
    isToday?: boolean;
}

export interface HomeReadiness {
    score: number;
    label: string;
    aiTarget: string;
    source: "healthkit" | "health_connect" | "manual" | "sample" | "check_in_estimate" | "mixed_estimate";
    sleepSource?: string;
    date?: string;
    hrvMs?: number;
    hrvMethod?: string | null;
    sleepMinutes?: number;
    sleepEfficiency?: number;
    restingHrBpm?: number;
    steps?: number;
    activeCalories?: number;
}

export interface HomeTodayWorkout {
    userWorkoutId: string;
    weekLabel: string;
    workoutTitle?: string;
    workoutTitleByLang?: Record<string,string>;
    sessionTitle?: string;
    category?: string;
    exerciseCount: number;
    durationMinutes: number;
    status: string;
    aiNote: string | null;
}

export interface HomeNutrition {
    calories: MacroTarget;
    protein: MacroTarget;
    carbs: MacroTarget;
    fat: MacroTarget;
    water: MacroTarget;
}

export interface HomeData {
    wearableUsage?: string;
    healthMetrics?: { date: string; source: string; syncedAt: string;
        steps: number | null; activeCalories: number | null; sleepMinutes: number | null;
        restingHR: number | null; hrv: number | null; hrvMethod: string | null } | null;
    sleepLog?: { date: string; sleepMinutes: number; energy: number | null; rested?: number | null; soreness?: number | null; source: string; updatedAt?: string } | null;
    calendarDate?: string;
    dataVersion?: number;
    user: {
        name: string;
        email?: string;
        streakDays: number;
    };
    readiness: HomeReadiness | null;
    todayWorkout: HomeTodayWorkout | null;
    nutrition: HomeNutrition;
    weeklyStreak: WeekDay[];
}
