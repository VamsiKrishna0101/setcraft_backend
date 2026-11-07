# Private body photos

Run `npm run setup:body-measurements` once on each backend host, followed by
`npm run check:body-measurements`. Setup creates the isolated `.body-venv`, installs
the pinned Python packages and downloads Google's Pose Landmarker Full model.
The Python source in `body_measurement/` must ship with the backend. The environment
and `body_models/` are ignored by Git and must be provisioned again after cloning.
The model and environment are also required when running compiled `dist/server.js`.
An existing Python installation with compatible binary wheels is needed. Set
`BODY_MEASUREMENT_BOOTSTRAP_PYTHON` if Python is not available as `python`.

The local worker uses pose landmarks and person segmentation, then FitAI's outline
geometry estimates chest, waist and hips as broad, unvalidated ranges. It requires
four full-body views with visible feet/head and consistent outlines. Missing or
obstructed dimensions remain absent; arm/leg circumference and body-fat readings
are not inferred by this worker. No network call or database write occurs inside
the worker. Existing OpenAI visual consent remains separate.
Model documentation: https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/python

New body photos use the private R2 bucket `fitai-body-images`. The S3 client uses
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BODY_BUCKET_NAME`.
The credentials must have object read/write/delete permission for this bucket.
Keep Public Development URL and public custom-domain access disabled.
`R2_BODY_PUBLIC_URL` is only used by the synthetic privacy verification script;
it is never returned to mobile or used to deliver member photos.

`savePhotos` defaults to false on `/api/body/reviews`. Photos are processed in
memory and the report is saved without any photo rows or R2 upload. OpenAI
processing remains separately disclosed; this setting only controls FitAI retention.
An optional progress-photo switch enables private photo persistence. Photo journals
require explicit `savePhotos: true` as well. The report records the save choice/time.

PostgreSQL stores photo metadata and private object references, not new image bytes.
`GET /api/body/photos/:id` checks ownership and streams private R2 bytes with
`Cache-Control: private, no-store`; there are no public URLs or signed bearer links.
Existing database photo bytes remain private and readable. They are not silently
migrated, re-uploaded to OpenAI, or deleted by this change.

`DELETE /api/body/entries/:id/photos` removes photo access while retaining the report
and measurements. Assessment/account deletion also removes images. A durable
`BodyPhotoDeletion` outbox retries failed R2 removal every minute while the backend
is running. Uploads register cleanup before writing and remove the marker atomically
when the report attaches them. Interrupted uploads become eligible after 15 minutes.
If R2 is unavailable during deletion, API access is removed immediately and physical
object deletion is retried; database backups and Google's retention are separate.

The photo report groups all 13 regions into six readable cards. Training recommendations
are deferred. Compare shows saved photos, earlier/current observations, and source-aware
measurement differences; it does not claim automatic visual muscle/fat changes.

Validation:

- `node --use-system-ca --import tsx scripts/check_private_body_storage.ts`: one synthetic
  image verifies real R2 upload/read, blocked public access, and deletion.
- `node --use-system-ca --import tsx scripts/test_body_integration.ts`: synthetic temporary
  users and an injected in-memory store cover ownership, opt-in/no-save, cancellation,
  failure compensation, deletion retries, retained reports, legacy photos and account removal.
- Prisma migration `20261010190000_private_body_photos` is additive and keeps existing records.
