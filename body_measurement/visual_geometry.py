"""Experimental 2D photo geometry, not body composition or clinical assessment.

No photo/landmarks are persisted here. Scores describe detected contour widths.
The fixed v1 mapping is explicitly not a population percentile or health grade.
"""
import math
import numpy as np
import cv2
import mediapipe as mp

VERSION = "visual-contour-index-v2"


def similarity(left, right):
    if min(left, right) <= 0:
        return None
    return round(100 * min(left, right) / max(left, right), 1)


def segment_width(mask, start, end):
    direction = end - start
    length = np.linalg.norm(direction)
    if length < 15:
        return None
    normal = np.array([-direction[1], direction[0]]) / length
    readings = []
    for fraction in (0.35, 0.50, 0.65, 0.75):
        center = start + direction * fraction
        extent = max(5, round(length * .65))
        distances = np.arange(-extent, extent + 1)
        points = np.rint(center + distances[:, None] * normal).astype(int)
        valid = ((points[:, 0] >= 0) & (points[:, 0] < mask.shape[1]) &
                 (points[:, 1] >= 0) & (points[:, 1] < mask.shape[0]))
        samples = np.zeros(len(points), dtype=bool)
        samples[valid] = mask[points[valid, 1], points[valid, 0]]
        middle = extent
        if not samples[middle]:
            continue
        lo = hi = middle
        while lo > 0 and samples[lo - 1]:
            lo -= 1
        while hi < len(samples) - 1 and samples[hi + 1]:
            hi += 1
        # Exclude contours connected to torso, shorts, hands, or another limb.
        value = hi - lo + 1
        if lo > 0 and hi < len(samples) - 1 and 3 <= value <= length * .60:
            readings.append(value)
    if len(readings) < 2 or max(readings) / min(readings) > 1.35:
        return None
    return float(np.median(readings))


def outline_halves(mask, center, y):
    cx, cy = round(center), round(y)
    if not (0 <= cy < mask.shape[0] and 0 <= cx < mask.shape[1]) or not mask[cy, cx]:
        return None
    lo = hi = cx
    while lo > 0 and mask[cy, lo - 1]:
        lo -= 1
    while hi < mask.shape[1] - 1 and mask[cy, hi + 1]:
        hi += 1
    if lo < 2 or hi >= mask.shape[1] - 2:
        return None
    return cx - lo, hi - cx


def extract_visual_geometry(detector, image):
    found = detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=image))
    if len(found.pose_landmarks) != 1 or not found.segmentation_masks:
        return unavailable_geometry("Use a clear photo of one person, facing the camera.")
    return geometry_from_landmarks(image, found.pose_landmarks[0],
                                   found.segmentation_masks[0].numpy_view())


def unavailable_geometry(note):
    return {"version": VERSION, "status": "unavailable", "score": None,
            "components": [], "vTaperRatio": None, "shoulderBalance": None,
            "chestBalance": None, "qualityNotes": [note],
            "metricNotes": {key: note for key in ("symmetry", "v_taper", "chest", "shoulders")}}


def geometry_from_landmarks(image, points, probabilities):
    """Assess independent projected measurements; never erase a supported one
    because a different region is covered, posed, or outside the frame.

    Model-predicted z is deliberately not a universal camera-yaw veto for a
    2D outline index. Observable span/pose/contour checks gate each metric.
    """
    h, w = image.shape[:2]
    # MediaPipe emits H×W×1 on some builds, H×W on others. Advanced
    # contour indexing requires a 2D mask; the former previously crashed.
    probabilities = np.asarray(probabilities)
    if probabilities.ndim == 3 and probabilities.shape[2] == 1:
        probabilities = probabilities[:, :, 0]
    if probabilities.shape != (h, w):
        return unavailable_geometry("The photo outline could not be aligned. Retry this photo.")
    def visible(indices, confidence=.75):
        return all(min(points[i].visibility, points[i].presence) >= confidence and
                   math.isfinite(points[i].x) and math.isfinite(points[i].y) and
                   .02 < points[i].x < .98 and .02 < points[i].y < .98 for i in indices)
    if not visible((11, 12)):
        return unavailable_geometry("Keep both shoulders visible in a clear front photo.")
    p = lambda i: np.array([points[i].x * w, points[i].y * h])
    shoulders, hips = (p(11) + p(12)) / 2, (p(23) + p(24)) / 2
    span = np.linalg.norm(p(11) - p(12))
    torso = hips[1] - shoulders[1]
    if span < w * .12:
        return unavailable_geometry("Face the camera with both shoulders inside the frame.")
    shoulder_slope = abs(p(11)[1] - p(12)[1]) / span
    notes = ["Experimental projected-photo index, not a health grade or muscle measurement.",
             "Clothing, stance and camera position affect visible contours."]
    metric_notes = {}
    shoulder_balance = round(float(100 * (1 - shoulder_slope)), 1) if shoulder_slope <= .25 else None
    if shoulder_balance is None:
        metric_notes["shoulders"] = "Keep the camera level and both shoulders relaxed."
    sharp = cv2.Laplacian(cv2.cvtColor(image, cv2.COLOR_RGB2GRAY), cv2.CV_64F).var() >= 25
    # A torso outline needs visible hips, but a shoulder-level observation does
    # not. A partial capture can therefore still return its supported metric.
    frontal = (visible((23, 24), .65) and torso >= h * .12 and
               span / max(torso, 1) >= .60 and
               np.linalg.norm(p(23) - p(24)) / span >= .35 and
               abs(shoulders[0] - hips[0]) <= span * .30 and shoulder_slope <= .12)
    outline_reason = ("Use a sharper photo with even lighting." if not sharp else
                      "Face the camera squarely with shoulders and hips visible; keep arms slightly away from the torso.")
    mask = probabilities > .75
    components = []
    for name, a, b, c, d in (("upper_arms", 11, 13, 12, 14),
                              ("thighs", 23, 25, 24, 26),
                              ("calves", 25, 27, 26, 28)):
        if not frontal or not sharp or not visible((a, b, c, d), .80):
            continue
        left_len, right_len = np.linalg.norm(p(a)-p(b)), np.linalg.norm(p(c)-p(d))
        if min(left_len, right_len) / max(left_len, right_len) < .85:
            continue
        left, right = segment_width(mask, p(a), p(b)), segment_width(mask, p(c), p(d))
        if left is not None and right is not None:
            components.append({"id": name, "score": similarity(left, right),
                "leftWidthPx": round(left, 2), "rightWidthPx": round(right, 2)})
    # At least two independent paired regions; don't inflate one good pair into
    # a full-body score. All included regions use equal, fixed weights in v1.
    score = round(sum(c["score"] for c in components) / len(components), 1) if len(components) >= 2 else None
    if score is None:
        metric_notes["symmetry"] = ("At least two clear left/right limb pairs are needed. Match arm positions and leave space between arms, torso and legs."
                                    if frontal and sharp else outline_reason)
    def half_at(fraction):
        if not frontal or not sharp:
            return None
        rows = [outline_halves(mask,
            shoulders[0] + (hips[0] - shoulders[0]) * fraction,
            shoulders[1] + torso * fraction + delta) for delta in (-2, -1, 0, 1, 2)]
        valid = [r for r in rows if r and min(r) > 3]
        return tuple(float(v) for v in np.median(valid, axis=0)) if len(valid) >= 3 else None
    waist = half_at(.70)
    # Joint-span / visible waist width is a photo ratio, not circumference.
    ratio = None
    if waist and min(waist) > 3 and .65 < span / sum(waist) < 2.5:
        ratio = round(float(span / sum(waist)), 2)
    chest_balance = None
    # Scan a fixed upper-torso band. A single row at the armpit is often
    # joined to an arm even when a clean chest contour exists just below it.
    # Never choose a row by its score, or count a connected arm as chest.
    for fraction in (.28, .34, .40):
        chest = half_at(fraction)
        if not chest or sum(chest) >= span * 1.30:
            continue
        row = shoulders[1] + torso * fraction
        center = shoulders[0] + (hips[0] - shoulders[0]) * fraction
        connected_arm = False
        for shoulder, elbow in ((11, 13), (12, 14)):
            if not visible((shoulder, elbow)):
                connected_arm = True
                break
            a, b = p(shoulder), p(elbow)
            if abs(b[1] - a[1]) < 1:
                continue
            along = (row - a[1]) / (b[1] - a[1])
            if 0 < along < 1:
                arm_x = a[0] + (b[0] - a[0]) * along
                if center - chest[0] <= arm_x <= center + chest[1]:
                    connected_arm = True
                    break
        if not connected_arm:
            chest_balance = similarity(*chest)
            break
    if ratio is None:
        metric_notes["v_taper"] = "The waist outline must be visible and separate from the arms." if frontal and sharp else outline_reason
    if chest_balance is None:
        metric_notes["chest"] = "The upper-torso outline is obscured or connected to an arm. Retake with arms slightly apart." if frontal and sharp else outline_reason
    notes.extend(dict.fromkeys(metric_notes.values()))
    any_value = bool(components) or score is not None or ratio is not None or shoulder_balance is not None or chest_balance is not None
    return {"version": VERSION, "status": "experimental" if score is not None else "partial" if any_value else "unavailable",
        "score": score, "components": components, "vTaperRatio": ratio,
        "shoulderBalance": shoulder_balance, "chestBalance": chest_balance,
        "qualityNotes": notes[:8], "metricNotes": metric_notes}
