"""Synthetic geometry checks; not a validation of real-world measurement accuracy."""
import unittest
from types import SimpleNamespace
import numpy as np
import cv2
from visual_geometry import similarity, segment_width, extract_visual_geometry, geometry_from_landmarks


class GeometryTests(unittest.TestCase):
    def test_ratio_and_exchange_invariance(self):
        self.assertEqual(similarity(95, 100), 95)
        self.assertEqual(similarity(100, 95), 95)
        self.assertIsNone(similarity(0, 10))

    def test_sampling_contour_not_torso(self):
        mask = np.zeros((300, 200), dtype=bool)
        mask[20:270, 80:100] = True
        self.assertEqual(segment_width(mask, np.array([90, 30]), np.array([90, 250])), 20)
        mask[:, :] = True
        self.assertIsNone(segment_width(mask, np.array([90, 30]), np.array([90, 250])))

    def test_missing_person_cannot_produce_score(self):
        class Detector:
            def detect(self, image):
                return SimpleNamespace(pose_landmarks=[], segmentation_masks=[])
        result = extract_visual_geometry(Detector(), np.zeros((400, 300, 3), dtype=np.uint8))
        self.assertIsNone(result['score'])
        self.assertIsNone(result['chestBalance'])
        self.assertEqual(result['status'], 'unavailable')

    def fixture(self):
        image = np.random.default_rng(17).integers(30, 220, (400, 300, 3), dtype=np.uint8)
        points = [SimpleNamespace(x=.5, y=.5, z=0, visibility=1, presence=1) for _ in range(33)]
        for i, x, y in ((11, .30, .20), (12, .70, .20), (13, .23, .40), (14, .77, .40),
                        (23, .38, .55), (24, .62, .55), (25, .38, .78), (26, .62, .78),
                        (27, .38, .94), (28, .62, .94)):
            points[i].x, points[i].y = x, y
        mask = np.zeros((400, 300), dtype=np.float32)
        mask[80:220, 90:211] = 1
        for start, end, width in (((90, 80), (69, 160), 16), ((210, 80), (231, 160), 16),
                                  ((114, 220), (114, 312), 20), ((186, 220), (186, 312), 20),
                                  ((114, 312), (114, 376), 12), ((186, 312), (186, 376), 12)):
            cv2.line(mask, start, end, 1, width)
        return image, points, mask

    def test_singleton_channel_matches_2d_mask_and_returns_all_geometry(self):
        image, points, mask = self.fixture()
        plain = geometry_from_landmarks(image, points, mask)
        channel = geometry_from_landmarks(image, points, mask[:, :, None])
        self.assertEqual(channel, plain)
        for key in ('score', 'vTaperRatio', 'chestBalance', 'shoulderBalance'):
            self.assertIsNotNone(channel[key], key)
        self.assertEqual(channel['version'], 'visual-contour-index-v2')

    def test_missing_hips_do_not_erase_supported_shoulders(self):
        image, points, mask = self.fixture()
        points[23].visibility = 0
        result = geometry_from_landmarks(image, points, mask)
        self.assertEqual(result['shoulderBalance'], 100)
        self.assertIsNone(result['score'])
        self.assertIsNone(result['vTaperRatio'])
        self.assertIn('v_taper', result['metricNotes'])
        self.assertEqual(result['status'], 'partial')

    def test_model_depth_does_not_erase_observable_projected_geometry(self):
        image, points, mask = self.fixture()
        points[11].z, points[12].z = -.20, .20
        result = geometry_from_landmarks(image, points, mask)
        self.assertIsNotNone(result['shoulderBalance'])
        self.assertIsNotNone(result['vTaperRatio'])

    def test_blur_preserves_landmark_level_but_not_fine_contour_claims(self):
        image, points, mask = self.fixture()
        result = geometry_from_landmarks(np.zeros_like(image), points, mask)
        self.assertEqual(result['shoulderBalance'], 100)
        self.assertIsNone(result['score'])
        self.assertIsNone(result['chestBalance'])


if __name__ == '__main__':
    unittest.main()
