import {z} from 'zod';

const rating = z.number().finite().min(0).max(100).nullable();
export const geometrySchema = z.object({version: z.enum(['visual-contour-index-v1', 'visual-contour-index-v2']),
  status: z.enum(['experimental', 'partial', 'unavailable']), score: rating,
  components: z.array(z.object({id: z.enum(['upper_arms', 'thighs', 'calves']), score: z.number().min(0).max(100),
    leftWidthPx: z.number().positive(), rightWidthPx: z.number().positive()})).max(3),
  vTaperRatio: z.number().finite().min(.65).max(2.5).nullable(),
  shoulderBalance: rating, chestBalance: rating,
  qualityNotes: z.array(z.string().max(240)).max(8),
  metricNotes: z.object({symmetry: z.string().max(240).optional(), v_taper: z.string().max(240).optional(),
    chest: z.string().max(240).optional(), shoulders: z.string().max(240).optional()}).optional(),
}).superRefine((v, ctx) => {
    if (new Set(v.components.map(c => c.id)).size !== v.components.length)
      ctx.addIssue({code: 'custom', message: 'Duplicate geometry regions'});
    for (const c of v.components) {
      const expected = 100 * Math.min(c.leftWidthPx, c.rightWidthPx) / Math.max(c.leftWidthPx, c.rightWidthPx);
      if (Math.abs(expected - c.score) > .15) ctx.addIssue({code: 'custom', message: 'Invalid component index'});
    }
    if (v.score !== null && (v.components.length < 2 || v.status !== 'experimental' ||
        Math.abs(v.score - v.components.reduce((n, c) => n + c.score, 0) / v.components.length) > .15))
      ctx.addIssue({code: 'custom', message: 'Invalid composite index'});
    if (v.status === 'unavailable' && (v.score !== null || v.components.length ||
        v.vTaperRatio !== null || v.shoulderBalance !== null || v.chestBalance !== null))
      ctx.addIssue({code: 'custom', message: 'Unavailable geometry cannot have values'});
  });

export const compositionReadingsSchema = z.object({
  recordedDate: z.iso.date(),
  source: z.enum(['smart_scale', 'dexa']),
  bodyFatPct: z.number().finite().min(2).max(75).optional(),
  muscleMassKg: z.number().finite().min(5).max(150).optional(),
}).strict().refine(v => v.bodyFatPct !== undefined || v.muscleMassKg !== undefined, 'Add a reading');
export type CompositionReadings = z.infer<typeof compositionReadingsSchema>;
export type DashboardMetric = {id: string; value: number | null; unit: string;
  source: 'photo_geometry' | 'ai_visual_rating' | 'member_reading' | 'unavailable';
  detail: string; recordedDate?: string};
export type PhysiqueDashboard = {version: 'photo-dashboard-v1'; score: number | null;
  geometry: z.infer<typeof geometrySchema>; readings?: CompositionReadings;
  metrics: DashboardMetric[]};

export const unavailableGeometry = (note = 'Visual geometry is unavailable. Retake a clear, square-on front photo or try again.'): z.infer<typeof geometrySchema> => ({
  version: 'visual-contour-index-v1', status: 'unavailable', score: null,
  components: [], vTaperRatio: null, shoulderBalance: null, chestBalance: null,
  qualityNotes: [note], metricNotes: {symmetry: note, v_taper: note, chest: note, shoulders: note},
});

export function buildPhysiqueDashboard(geometry: z.infer<typeof geometrySchema>,
  readings?: CompositionReadings, definition?: {score: number; observation: string} | null): PhysiqueDashboard {
  return {version: 'photo-dashboard-v1', score: geometry.score, geometry, ...(readings ? {readings} : {}), metrics: [
    {id: 'body_fat', value: readings?.bodyFatPct ?? null, unit: '%',
      source: readings?.bodyFatPct == null ? 'unavailable' : 'member_reading', recordedDate: readings?.recordedDate,
      detail: readings?.bodyFatPct == null ? 'Add a body-fat reading from your smart scale or DEXA report. This photo engine does not estimate body fat.' : `Member-entered ${readings.source === 'dexa' ? 'DEXA' : 'smart scale'} reading. Not calculated from this photo.`},
    {id: 'muscle_mass', value: readings?.muscleMassKg ?? null, unit: 'kg',
      source: readings?.muscleMassKg == null ? 'unavailable' : 'member_reading', recordedDate: readings?.recordedDate,
      detail: readings?.muscleMassKg == null ? 'Add skeletal muscle mass from a supported scale or report. Lean mass is not skeletal muscle mass.' : `Member-entered skeletal muscle reading (${readings.source === 'dexa' ? 'DEXA report' : 'smart scale'}). Lean mass must not be entered as muscle mass.`},
    {id: 'v_taper', value: geometry.vTaperRatio, unit: '×', source: geometry.vTaperRatio == null ? 'unavailable' : 'photo_geometry',
      detail: geometry.metricNotes?.v_taper ?? 'Detected shoulder joint span divided by visible waist width in the front photo. A 2D proportion, not a circumference measurement or an ideal-body target.'},
    {id: 'definition', value: definition?.score ?? null, unit: '/100', source: definition ? 'ai_visual_rating' : 'unavailable',
      detail: definition ? `${definition.observation} Subjective AI rating of visible definition; lighting, pose and clothing affect it. Not a muscle-mass or body-fat measurement.` : 'Visible muscle definition could not be rated reliably from the supplied photos.'},
    {id: 'chest', value: geometry.chestBalance, unit: '/100', source: geometry.chestBalance == null ? 'unavailable' : 'photo_geometry',
      detail: geometry.metricNotes?.chest ?? 'Left/right upper-torso outline similarity around the detected torso axis. Clothing and pose affect this experimental index. It does not measure pectoral size or strength.'},
    {id: 'shoulders', value: geometry.shoulderBalance, unit: '/100', source: geometry.shoulderBalance == null ? 'unavailable' : 'photo_geometry',
      detail: geometry.metricNotes?.shoulders ?? 'Photo shoulder-level index: 100 × (1 − vertical shoulder difference / shoulder span). Camera tilt and stance affect it. Not a muscle-size measurement.'},
  ]};
}
