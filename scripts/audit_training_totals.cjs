const { Client } = require('pg');
require('dotenv').config({quiet:true});
(async () => {
  const db = new Client({connectionString:process.env.DATABASE_URL, connectionTimeoutMillis:15000});
  try {
    await db.connect();
    const rows = (await db.query(`SELECT s.date, s.status,
      count(DISTINCT i.id)::int AS exercises,
      count(DISTINCT i.id) FILTER (WHERE i.status = 'COMPLETED')::int AS completed_exercises,
      count(l.id)::int AS saved_sets, coalesce(sum(l.reps * coalesce(l.weight, 0)), 0)::float AS volume_kg
      FROM "WorkoutSession" s
      LEFT JOIN "UserWorkoutItem" i ON i."userWorkoutId" = s."userWorkoutId" AND i."sourceProvider" = 'USER'
      LEFT JOIN "WorkoutSetLog" l ON l."userWorkoutItemId" = i.id AND l."userId" = s."userId"
        AND l.year || '-' || lpad(l.month,2,'0') || '-' || lpad(l.day,2,'0') = s.date
      GROUP BY s.id ORDER BY s."startedAt" DESC LIMIT 8`)).rows;
    console.log(JSON.stringify({recentSessions:rows},null,2));
  } finally { await db.end(); }
})().catch(error => {console.error('Training audit failed:',error.code || error.name);process.exitCode=1;});
