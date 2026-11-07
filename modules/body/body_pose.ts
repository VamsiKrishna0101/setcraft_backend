import { BodyError } from "./body_types";
import { decodePhotos } from "./body_engine";

export function stopBodyPoseWorker(): void {
  // No-op: Local pose worker and Python dependencies have been removed.
}

export async function measureBodyPhotos(
  _photos: ReturnType<typeof decodePhotos>,
  _heightCm: number,
): Promise<{
  usable: boolean;
  metrics: Record<string, unknown>;
  qualityNotes: string[];
  modelVersion: string;
  elapsedMs: number;
}> {
  throw new BodyError(
    503,
    "Photo measurements are disabled. You can enter your measurements manually.",
  );
}

export async function extractPhotoGeometry(
  _photos: ReturnType<typeof decodePhotos>,
): Promise<unknown> {
  throw new BodyError(
    503,
    "Photo measurements are disabled. You can enter your measurements manually.",
  );
}
