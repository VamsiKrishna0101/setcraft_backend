import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../../config/prisma';
import { fitnessSearchAliases, fitnessTerm, localizedExercise } from '../../utils/fitness_locale';
import { exerciseMediaGender } from '../../utils/exercise_media';
import { cachedExercisePage } from '../../utils/exercise_catalog_cache';

export const exercisePageQuery = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(24),
  search: z.string().trim().max(100).default(''),
  bodyPart: z.string().trim().max(80).optional(),
  equipment: z.string().trim().max(80).optional(),
  mediaGender: z.enum(['male', 'female']).optional(),
  difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).optional(),
});
export type ExercisePageQuery = z.infer<typeof exercisePageQuery>;

// Keep this expression identical to the search index in the migration.
const document = Prisma.sql`lower("name" || ' ' || COALESCE("namesByLang"::text, '') || ' ' || "bodyPart" || ' ' || COALESCE("target", '') || ' ' || "equipment" || ' ' || COALESCE("muscleGroup", ''))`;
// Filter before COUNT/LIMIT, including the default profile selection. Missing
// demonstrations must never leave empty cards or inaccurate page counts.
function availableDemo(gender: 'male' | 'female') {
  const origin = gender === 'male'
    ? 'pub-2111ee02db9e4d4396611479b3804ef3'
    : 'pub-7d883b21f04e4fdab24b23d2b46ec995';
  const pattern = `^https://${origin}[.]r2[.]dev/[^?#[:space:]]+[.]mp4$`;
  return Prisma.sql`("mediaVariants" -> ${gender} ->> 'url') ~ ${pattern}`;
}
export function exercisePageWhere(query: ExercisePageQuery, locale = 'en') {
  const clauses: Prisma.Sql[] = [Prisma.sql`"catalogStatus" NOT IN ('STAGED', 'ARCHIVED')`,
    availableDemo(query.mediaGender ?? exerciseMediaGender())];
  if (query.bodyPart) clauses.push(Prisma.sql`lower("bodyPart") = ${query.bodyPart.toLowerCase()}`);
  if (query.equipment) clauses.push(Prisma.sql`lower("equipment") = ${query.equipment.toLowerCase()}`);
  if (query.difficulty) clauses.push(Prisma.sql`"difficulty"::text = ${query.difficulty}`);
  if (query.search) {
    // Literal substring matching: user % and _ characters are not SQL wildcards.
    const searches = [...new Set([query.search.toLowerCase(), ...fitnessSearchAliases(query.search, locale)])];
    const matches = searches.map(search => {
      const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
      return Prisma.sql`${document} LIKE ${pattern}`;
    });
    clauses.push(Prisma.sql`(${Prisma.join(matches, ' OR ')})`);
  }
  return Prisma.join(clauses, ' AND ');
}

export async function getExercisePage(
  query: ExercisePageQuery,
  locale: string,
  select: Record<string, boolean>,
  format: (exercise: any, mediaGender?: 'male' | 'female') => any,
) {
  // Only public exercise data enters this shared cache; no account workout data.
  return cachedExercisePage([locale, query.mediaGender ?? 'profile-' + exerciseMediaGender(),
    {...query, search:query.search.toLowerCase()}, Object.keys(select).filter(key => select[key]).sort()],
    () => loadExercisePage(query, locale, select, format));
}

async function loadExercisePage(
  query: ExercisePageQuery, locale: string, select: Record<string,boolean>,
  format: (exercise:any, mediaGender?: 'male' | 'female') => any,
) {
  const where = exercisePageWhere(query, locale);
  const facets = exercisePageWhere(exercisePageQuery.parse({mediaGender: query.mediaGender}));
  // One statement gives count, page and facets the same snapshot without five
  // sequential database round trips on every keystroke-driven search.
  const columns = Object.entries(select).filter(([, included]) => included).map(([name]) => {
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(name)) throw new Error('Invalid catalog column');
    return Prisma.raw('w."' + name + '"');
  });
  const [result] = await prisma.$queryRaw<{ total: number; rows: any[]; bodies: string[]; equipment: string[] }[]>(Prisma.sql`
    WITH matching AS MATERIALIZED (
      SELECT "id", "name" FROM "Workout" WHERE ${where}
    ), page AS (
      SELECT ${Prisma.join(columns)} FROM "Workout" w
      JOIN (SELECT "id" FROM matching ORDER BY "name", "id"
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}) p ON p."id" = w."id"
    )
    SELECT (SELECT count(*)::int FROM matching) AS total,
      COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY "name", "id") FROM page), '[]'::jsonb) AS rows,
      ARRAY(SELECT DISTINCT "bodyPart" FROM "Workout" WHERE ${facets} ORDER BY "bodyPart") AS bodies,
      ARRAY(SELECT DISTINCT "equipment" FROM "Workout" WHERE ${facets} ORDER BY "equipment") AS equipment
  `);
  const {total, rows, bodies, equipment} = result;
  const options = (values: string[]) => values.filter(Boolean).map(value => ({ value, label: fitnessTerm(value, locale) }));
  return {
    data: rows.map(row => localizedExercise(format(row, query.mediaGender), locale)),
    pagination: { page: query.page, pageSize: query.pageSize, total,
      totalPages: Math.ceil(total / query.pageSize), hasNext: query.page * query.pageSize < total },
    filters: { bodyParts: options(bodies), equipment: options(equipment) },
  };
}
