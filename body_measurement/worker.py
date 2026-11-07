"""Local pose/outline extraction. Photos stay in memory unless diagnostics are requested."""

import argparse
import base64
import io
import json
import math
import os
from pathlib import Path
import sys
import time
import traceback

import cv2
import mediapipe as mp
import numpy as np
from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = 20_000_000
VIEWS = ("front", "back", "left", "right")
MODEL_VERSION = "mediapipe-pose-full-v1/contour-v1"
MEASUREMENTS = {
    "chestCm": (0.25, 30, 250),
    "waistCm": (0.70, 30, 250),
    "hipsCm": (1.00, 40, 250),
}


def create_detector():
    model = os.environ.get("BODY_POSE_MODEL")
    if not model:
        model = Path(__file__).resolve().parents[1] / "body_models/pose_landmarker_full.task"
    options = mp.tasks.vision.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(model)),
        running_mode=mp.tasks.vision.RunningMode.IMAGE,
        num_poses=2,
        output_segmentation_masks=True,
    )
    return mp.tasks.vision.PoseLandmarker.create_from_options(options)


def load_image(encoded):
    raw = base64.b64decode(encoded, validate=True)
    if not 75 <= len(raw) <= 2_000_000:
        raise ValueError("Use a JPEG or PNG under 2 MB.")
    with Image.open(io.BytesIO(raw)) as original:
        if original.format not in ("JPEG", "PNG"):
            raise ValueError("Use a JPEG or PNG photo.")
        if original.width * original.height > Image.MAX_IMAGE_PIXELS:
            raise ValueError("Resize this photo before trying again.")
        image = ImageOps.exif_transpose(original).convert("RGB")
        if min(image.size) < 200:
            raise ValueError("Use a clearer, larger full-body photo.")
        image.thumbnail((1200, 1200))
        return np.asarray(image).copy()


def torso_width(mask, row, center):
    """Only the segment containing the torso counts; separated arms are excluded."""
    widths = []
    for y in range(max(0, row - 2), min(mask.shape[0], row + 3)):
        pixels = mask[y]
        if not 0 <= center < len(pixels) or not pixels[center]:
            return None
        left = right = center
        while left > 0 and pixels[left - 1]:
            left -= 1
        while right + 1 < len(pixels) and pixels[right + 1]:
            right += 1
        widths.append(right - left + 1)
    return float(np.median(widths)) if widths else None


def extract_view(detector, photo, height_cm, diagnostic=None):
    image = load_image(photo["base64"])
    height, width = image.shape[:2]
    detected = detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=image))
    if len(detected.pose_landmarks) != 1 or not detected.segmentation_masks:
        raise ValueError("Include one person, standing with the whole body visible.")
    landmarks = detected.pose_landmarks[0]
    # A side view can hide the far limb; the near shoulder, hip and ankle must remain visible.
    for pair in ((11, 12), (23, 24), (27, 28)):
        if max(landmarks[i].visibility for i in pair) < 0.5:
            raise ValueError("Keep your shoulders, hips and feet clearly visible.")
    mask = (detected.segmentation_masks[0].numpy_view() > 0.65).astype(np.uint8)
    _, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if len(stats) < 2:
        raise ValueError("The body outline could not be detected.")
    person = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    mask = labels == person
    x, y, body_width, body_height, _ = stats[person]
    if y < height * 0.01 or y + body_height > height * 0.99:
        raise ValueError("Leave space above your head and below your feet.")
    if x < 2 or x + body_width > width - 2 or body_height < height * 0.45:
        raise ValueError("Keep your full outline inside the frame and stand closer.")

    shoulder_x = (landmarks[11].x + landmarks[12].x) / 2
    shoulder_y = (landmarks[11].y + landmarks[12].y) / 2
    hip_x = (landmarks[23].x + landmarks[24].x) / 2
    hip_y = (landmarks[23].y + landmarks[24].y) / 2
    torso_height = hip_y - shoulder_y
    if torso_height <= 0.10 or abs(shoulder_x - hip_x) > 0.08:
        raise ValueError("Stand upright with the camera level.")
    if min(landmarks[15].y, landmarks[16].y) < shoulder_y - 0.05:
        raise ValueError("Lower your arms and keep them away from your torso.")

    scale = height_cm / body_height
    dimensions = {}
    for metric, (fraction, _, _) in MEASUREMENTS.items():
        row = round((shoulder_y + torso_height * fraction) * height)
        center = round((shoulder_x + (hip_x - shoulder_x) * fraction) * width)
        measured = torso_width(mask, row, center)
        if measured is None:
            continue
        # Discard an outline that includes connected arms or crossed hands.
        for wrist in (15, 16):
            point = landmarks[wrist]
            if point.visibility > 0.5 and abs(point.y * height - row) < body_height * 0.07:
                if abs(point.x * width - center) < measured * 0.65:
                    measured = None
                    break
        if measured is not None:
            dimensions[metric] = measured * scale

    if diagnostic:
        overlay = image.copy()
        contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(overlay, contours, -1, (40, 220, 180), 2)
        Image.fromarray(overlay).save(diagnostic / f"{photo['view']}-outline.jpg")
    return dimensions


def matching_dimension(views, names, metric):
    values = [views[name].get(metric) for name in names]
    if any(value is None for value in values):
        return None
    if min(values) <= 0 or max(values) / min(values) > 1.20:
        return None
    return sum(values) / len(values)


def estimate_circumference(width, depth, minimum, maximum):
    # Explicit geometric approximation, not a calibrated tape measurement.
    if not 10 <= depth <= 65 or not 15 <= width <= 85 or not 0.35 <= depth / width <= 1.3:
        return None
    radius_x, radius_y = width / 2, depth / 2
    shape = ((radius_x - radius_y) / (radius_x + radius_y)) ** 2
    perimeter = math.pi * (radius_x + radius_y) * (1 + 3 * shape / (10 + math.sqrt(4 - 3 * shape)))
    if not minimum <= perimeter <= maximum:
        return None
    uncertainty = max(8, perimeter * 0.15)
    return {
        "value": round(perimeter),
        "low": max(minimum, math.floor(perimeter - uncertainty)),
        "high": min(maximum, math.ceil(perimeter + uncertainty)),
        "source": "contour_estimate",
    }


def measure(detector, request, diagnostic=None):
    started = time.perf_counter()
    height = request.get("heightCm")
    if isinstance(height, bool) or not isinstance(height, (int, float)) or not 120 <= height <= 230:
        raise ValueError("A height between 120 and 230 cm is required.")
    photos = request.get("photos", [])
    if len(photos) != 4 or {photo.get("view") for photo in photos} != set(VIEWS):
        raise ValueError("Provide front, back, left and right photos.")
    views, notes = {}, []
    for photo in photos:
        try:
            views[photo["view"]] = extract_view(detector, photo, height, diagnostic)
        except ValueError as error:
            notes.append(f"{photo['view'].capitalize()} view: {error}")
    metrics = {}
    if not notes:
        for metric, (_, minimum, maximum) in MEASUREMENTS.items():
            width = matching_dimension(views, ("front", "back"), metric)
            depth = matching_dimension(views, ("left", "right"), metric)
            estimate = estimate_circumference(width, depth, minimum, maximum) if width and depth else None
            if estimate:
                metrics[metric] = estimate
            else:
                notes.append(f"{metric.removesuffix('Cm').capitalize()} outline is unclear. Enter a tape measurement for this area.")
        notes.append("Photo ranges are unvalidated outline estimates. Camera angle, clothing and posture affect the result.")
    return {"usable": len(views) == 4, "metrics": metrics, "qualityNotes": notes,
            "modelVersion": MODEL_VERSION, "elapsedMs": round((time.perf_counter() - started) * 1000)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--diagnostic", type=Path)
    args = parser.parse_args()
    with create_detector() as detector:
        if args.check:
            print(json.dumps({"ready": True, "modelVersion": MODEL_VERSION}))
            return
        if args.diagnostic:
            args.diagnostic.mkdir(parents=True, exist_ok=True)
        for line in sys.stdin:
            request = {}
            try:
                request = json.loads(line)
                if request.get("mode") == "visual_geometry":
                    from visual_geometry import extract_visual_geometry
                    result = extract_visual_geometry(detector, load_image(request["photo"]))
                else:
                    result = measure(detector, request, args.diagnostic)
                if args.diagnostic:
                    (args.diagnostic / "result.json").write_text(json.dumps(result), encoding="utf-8")
                    print(json.dumps({"usable": result["usable"], "estimatedFields": list(result["metrics"])}), flush=True)
                else:
                    print(json.dumps({"id": request.get("id"), "result": result}), flush=True)
            except Exception as error:
                # Never include image bytes, measurements, request contents or paths in logs.
                identifier = request.get("id") if isinstance(request, dict) else None
                # Exception class/function identify an engine fault without
                # exposing the image, request, exception message, or file path.
                frames = traceback.extract_tb(error.__traceback__)
                print(json.dumps({"id": identifier, "error": "invalid_photo_input",
                    "errorType": type(error).__name__,
                    "stage": frames[-1].name if frames else "worker",
                    "line": frames[-1].lineno if frames else 0}), flush=True)
                if args.diagnostic:
                    raise SystemExit(1)


if __name__ == "__main__":
    main()
