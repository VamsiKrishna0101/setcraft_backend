import assert from "node:assert/strict";
import { reviewSchema } from "../modules/body/body_types";
import { decodePhotos } from "../modules/body/body_engine";
import { analyzePhysiquePhotos, physiqueReviewSchema, validatePhotoReviewEvidence } from "../modules/body/physique_review";
import {buildPhysiqueDashboard, geometrySchema, unavailableGeometry} from '../modules/body/physique_dashboard';

async function main() {
  const photo = {view: "front" as const, mimeType: "image/png" as const,
    base64: Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(100)]).toString("base64")};
  const input = {recordedDate: "2026-10-20", utcOffsetMinutes: 330,
    consentToPhotoAnalysis:true,analysisProvider:"OPENAI" as const, consentToVisualCoaching: true, photos: [photo]};
  const parsed = reviewSchema.parse(input);
  assert.equal(parsed.weightKg, undefined);
  assert.equal(parsed.savePhotos, false);
  assert.equal(reviewSchema.safeParse({...input, photos: [{...photo, view: "back"}]}).success, false);
  assert.equal(reviewSchema.safeParse({...input, photos: [photo, photo]}).success, false);
  assert.equal(reviewSchema.safeParse({...input, consentToPhotoAnalysis: false}).success, false);
  assert.equal(reviewSchema.safeParse({...input, weightKg: 999}).success, false);
  const evidence = {appearanceStatus: "observed", visualEvidenceViews: ["front"], limitations: ["Pose can affect appearance."]};
  const review = physiqueReviewSchema.parse({usable: true, qualityNotes: [], overview: "Front outline is visible.",
    highlights: ["symmetry", "v_taper", "chest"].map(id => ({id, observation: "Visible outline, limited by pose.", ...evidence}))});
  validatePhotoReviewEvidence(review, ["front"]);
  assert.throws(() => validatePhotoReviewEvidence({...review, highlights: review.highlights.map(h => ({...h, visualEvidenceViews: ["back"]}))}, ["front"]));
  assert.throws(() => validatePhotoReviewEvidence({...review, highlights: review.highlights.map(h => ({...h, visualEvidenceViews: []}))}, ["front"]));
  assert.throws(() => validatePhotoReviewEvidence({...review, highlights: review.highlights.map(() => review.highlights[0]!)}, ["front"]));
  assert.equal(physiqueReviewSchema.safeParse({...review, symmetryScore: 95}).success, false);
  const photos = decodePhotos([photo]);
  for (const gender of ["MALE", "FEMALE"]) {
    const stages: string[] = [];
    const result = await analyzePhysiquePhotos(photos, {height: 175, age: 25, gender, workingToward: "BUILD_MUSCLE"},
      undefined, undefined, {visualCoaching: true, onStage: s => stages.push(s)}, async sent => {
        assert.equal(sent.length, 1); return {review, model: "synthetic-review"};
      }, async () => unavailableGeometry());
    assert.deepEqual(stages, ["outlines", "focus"]);
    assert.deepEqual(result.measurementMetrics, {}, "Photo review cannot invent measurements");
    assert.deepEqual(result.regionalGuidance, [], "Photo review cannot generate training priorities");
    assert.equal(result.physiqueAssessment?.photosUsed, 1);
    assert.equal(result.physiqueAssessment?.highlights?.length, 3);
    assert.deepEqual(result.physiqueAssessment?.regions, [], 'The compact review does not generate a long muscle list');
    assert.ok(result.processing!.measurementMs >= 0);
  }
  const profile = {height: 175, age: 25, gender: "MALE", workingToward: "BUILD_MUSCLE"};
  await assert.rejects(() => analyzePhysiquePhotos(photos, profile, undefined, undefined, {visualCoaching: false}), /Consent/);
  await assert.rejects(() => analyzePhysiquePhotos(photos, profile, undefined, undefined, {visualCoaching: true},
    async () => ({review: {...review, usable: false, qualityNotes: ["Retake a clearer front photo."]}, model: "synthetic"}), async () => unavailableGeometry()), /Retake/);
  const offline = await analyzePhysiquePhotos(photos, profile, undefined, undefined, {visualCoaching: true}, async () => {throw new Error("Synthetic provider outage");}, async () => unavailableGeometry());
  assert.equal(offline.focusStatus, "unavailable");
  assert.equal(offline.physiqueAssessment?.dashboard?.score, null);
  assert.deepEqual(offline.measurementMetrics, {});
  assert.deepEqual(offline.result.observations, []);
  const geometry = geometrySchema.parse({...unavailableGeometry(), status: 'experimental', score: 95,
    components: [{id: 'upper_arms', score: 95, leftWidthPx: 95, rightWidthPx: 100},
      {id: 'calves', score: 95, leftWidthPx: 19, rightWidthPx: 20}],
    vTaperRatio: 1.24, chestBalance: 96, shoulderBalance: 98});
  assert.equal(geometrySchema.safeParse({...geometry, score: 100}).success, false);
  assert.equal(geometrySchema.safeParse({...geometry, components: [geometry.components[0]]}).success, false);
  const readings = {recordedDate: '2026-10-20', source: 'smart_scale' as const, bodyFatPct: 22, muscleMassKg: 31};
  const dashboard = buildPhysiqueDashboard(geometry, readings, {score: 45, observation: 'Synthetic rubric result.'});
  assert.equal(dashboard.metrics.find(m => m.id === 'body_fat')?.value, 22);
  assert.equal(dashboard.metrics.find(m => m.id === 'muscle_mass')?.source, 'member_reading');
  assert.equal(buildPhysiqueDashboard(geometry).metrics.find(m => m.id === 'body_fat')?.value, null);
  assert.equal(reviewSchema.safeParse({...input, compositionReadings: {...readings, recordedDate: '2026-10-21'}}).success, false);
  assert.equal(reviewSchema.safeParse({...input, compositionReadings: {...readings, source: 'ai_guess'}}).success, false);
  const geometryOnly = await analyzePhysiquePhotos(photos, profile, undefined, undefined,
    {visualCoaching: true, compositionReadings: readings}, async () => {throw new Error('Synthetic outage');}, async () => geometry);
  assert.equal(geometryOnly.physiqueAssessment?.dashboard?.score, 95);
  assert.equal(geometryOnly.physiqueAssessment?.dashboard?.metrics.find(m => m.id === 'definition')?.value, null);
  const definition = {...review, definition: {score: 40, observation: 'Synthetic detail.', visualEvidenceViews: ['front' as const]}};
  const v2 = geometrySchema.parse({...geometry, version: 'visual-contour-index-v2'});
  const repaired = await analyzePhysiquePhotos(photos, profile, undefined, undefined,
    {visualCoaching: true}, async () => ({review: definition, model: 'synthetic'}), async () => v2);
  assert.equal(repaired.physiqueAssessment?.dashboard?.geometry.version, 'visual-contour-index-v2');
  assert.equal(repaired.physiqueAssessment?.dashboard?.metrics.filter(m => m.value !== null).length, 4,
    'Geometry and definition coexist without inventing composition readings');
  const failedGeometry = await analyzePhysiquePhotos(photos, profile, undefined, undefined,
    {visualCoaching: true}, async () => ({review: definition, model: 'synthetic'}),
    async () => {throw new Error('Synthetic geometry runtime error');});
  assert.equal(failedGeometry.physiqueAssessment?.dashboard?.metrics.find(m => m.id === 'definition')?.value, 40);
  assert.match(failedGeometry.physiqueAssessment!.dashboard!.geometry.qualityNotes[0]!, /could not finish/);
  validatePhotoReviewEvidence(definition, ['front']);
  assert.throws(() => validatePhotoReviewEvidence(definition, ['back']));
  console.log("Physique review checks passed: one front photo, optional weight/storage, consent, evidence, male/female, retakes and provider failure. No network or database writes.");
}
main().catch(error => {console.error(error); process.exitCode = 1;});
