import prisma from '../../config/prisma';
// This dedicated LangGraph schema uses weeklyPlanRun.id as each thread ID.
// Retry orphan cleanup after account deletion, including late worker writes.
export async function removeDeletedPlannerData() {
  for(const table of ['checkpoint_writes','checkpoint_blobs','checkpoints'] as const) {
    const qualified=`fitai_planner_checkpoints.${table}`;
    const [exists]=await prisma.$queryRaw<Array<{name:string|null}>>`SELECT to_regclass(${qualified})::text AS name`;
    if(!exists?.name)continue;
    // Only constant table names above enter SQL text; never request data.
    await prisma.$executeRawUnsafe(`DELETE FROM "fitai_planner_checkpoints"."${table}" AS c WHERE NOT EXISTS (SELECT 1 FROM "WeeklyPlanRun" AS r WHERE r."id" = c."thread_id")`);
  }
}
