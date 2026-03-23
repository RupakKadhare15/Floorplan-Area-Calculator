"""
Wall Tracer v4 — Universal wall segment isolation.

FIXES in this version:
  - ISSUE 9: Replaced hardcoded threshold(180) with Otsu adaptive threshold
    → Now detects gray walls, light-colored walls, and varied ink densities
"""

import numpy as np
import cv2
import math
import logging

logger = logging.getLogger(__name__)


class WallTracer:

    def __init__(self, clean_gray, px_per_pt):
        self.h, self.w = clean_gray.shape[:2]
        self.px_per_pt = px_per_pt
        self.gray = clean_gray

        # ── FIX ISSUE 9: Otsu threshold instead of hardcoded 180 ──
        # Otsu automatically finds the optimal threshold between foreground/background
        # This handles gray walls, light ink, and varied drawing styles
        otsu_thresh, self.ink = cv2.threshold(
            clean_gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
        )
        logger.info(f"WallTracer: Otsu threshold = {otsu_thresh:.0f}")

        # Distance transform
        self.dist = cv2.distanceTransform(self.ink, cv2.DIST_L2, 5)

        # Precompute params scaled to resolution
        self._min_len = max(8, int(8 * px_per_pt))
        self._wall_dilation = max(3, int(2 * px_per_pt))
        self._dk = np.ones((self._wall_dilation * 2 + 1,) * 2, np.uint8)
        self._junction_dilate = max(5, int(3 * px_per_pt))

        logger.info(f"WallTracer v4: {self.w}x{self.h}, "
                    f"min_len={self._min_len}, junction_break={self._junction_dilate}")

    def select_at(self, cx_px, cy_px, search_r=25):
        cx = max(0, min(int(cx_px), self.w - 1))
        cy = max(0, min(int(cy_px), self.h - 1))

        cd, cx, cy = self._find_ink(cx, cy, search_r)
        if cd < 0.3:
            return self._local_fallback(int(cx_px), int(cy_px)), "LOCAL"

        # STEP 1: Distance band
        lo = max(0.3, cd * 0.3)
        hi = cd * 4.0
        band = ((self.dist >= lo) & (self.dist <= hi) & (self.ink > 0)).astype(np.uint8) * 255

        # STEP 2: Directional open
        kh = np.ones((1, self._min_len), np.uint8)
        kv = np.ones((self._min_len, 1), np.uint8)
        h_struct = cv2.morphologyEx(band, cv2.MORPH_OPEN, kh)
        v_struct = cv2.morphologyEx(band, cv2.MORPH_OPEN, kv)

        # STEP 3: Junction breaking
        overlap = cv2.bitwise_and(h_struct, v_struct)
        jk = self._junction_dilate
        junction_zone = cv2.dilate(overlap, np.ones((jk, jk), np.uint8), iterations=4)
        h_broken = cv2.bitwise_and(h_struct, cv2.bitwise_not(junction_zone))
        v_broken = cv2.bitwise_and(v_struct, cv2.bitwise_not(junction_zone))

        # STEP 4: Component at click
        candidates = []
        for mask, label_name in [(h_broken, "H"), (v_broken, "V")]:
            seg = self._component_at(mask, cx, cy)
            if seg is not None:
                recovered = self._recover_width(seg, cd)
                area = int(np.sum(recovered > 0))
                if area > 20:
                    candidates.append((recovered, label_name, area))

        # COMBINED for curved/diagonal
        if not candidates or cd >= 2.0:
            combined = cv2.bitwise_or(h_struct, v_struct)
            combined_broken = cv2.bitwise_and(combined, cv2.bitwise_not(junction_zone))
            seg = self._component_at(combined_broken, cx, cy)
            if seg is not None:
                recovered = self._recover_width(seg, cd)
                area = int(np.sum(recovered > 0))
                if area > 20:
                    candidates.append((recovered, "COMBINED", area))

        if candidates:
            candidates.sort(key=lambda c: c[2])
            return candidates[0][0], candidates[0][1]

        return self._local_fallback(cx, cy), "LOCAL"

    def _component_at(self, mask, cx, cy):
        if mask is None or np.sum(mask > 0) < 5:
            return None
        fat = cv2.dilate(mask, self._dk, iterations=1)
        n, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
        lbl = self._find_label(labels, fat, cx, cy)
        if lbl <= 0:
            return None
        return (labels == lbl).astype(np.uint8) * 255

    def _recover_width(self, skeleton_seg, click_dist):
        dsize = max(3, int(click_dist * 3))
        if dsize % 2 == 0:
            dsize += 1
        expanded = cv2.dilate(skeleton_seg, np.ones((dsize, dsize), np.uint8), iterations=1)
        ink_padded = cv2.dilate(self.ink, np.ones((5, 5), np.uint8), iterations=2)
        recovered = cv2.bitwise_and(expanded, ink_padded)
        recovered = cv2.dilate(recovered, np.ones((3, 3), np.uint8), iterations=2)
        return recovered

    def _find_ink(self, cx, cy, sr):
        if self.dist[cy, cx] >= 0.5:
            return float(self.dist[cy, cx]), cx, cy
        bd, bx, by = 0.0, cx, cy
        for r in range(1, sr + 1):
            for dy in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    if abs(dy) != r and abs(dx) != r:
                        continue
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < self.h and 0 <= nx < self.w and self.dist[ny, nx] > bd:
                        bd, bx, by = self.dist[ny, nx], nx, ny
            if bd >= 0.5:
                break
        return bd, bx, by

    def _find_label(self, labels, fat, cx, cy, sr=20):
        h, w = labels.shape
        if 0 <= cy < h and 0 <= cx < w:
            if fat[cy, cx] > 0 and labels[cy, cx] > 0:
                return labels[cy, cx]
        for r in range(1, sr + 1):
            for dy in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    if abs(dy) != r and abs(dx) != r:
                        continue
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < h and 0 <= nx < w and fat[ny, nx] > 0 and labels[ny, nx] > 0:
                        return labels[ny, nx]
        return 0

    def _local_fallback(self, cx, cy):
        cx = max(0, min(cx, self.w - 1))
        cy = max(0, min(cy, self.h - 1))
        br = int(max(60, 40 * self.px_per_pt))
        bx0, by0 = max(0, cx - br), max(0, cy - br)
        bx1, by1 = min(self.w, cx + br), min(self.h, cy + br)
        local = np.zeros((self.h, self.w), np.uint8)
        local[by0:by1, bx0:bx1] = self.ink[by0:by1, bx0:bx1]
        n, labels, _, _ = cv2.connectedComponentsWithStats(local)
        if 0 <= cy < labels.shape[0] and 0 <= cx < labels.shape[1] and labels[cy, cx] > 0:
            seg = (labels == labels[cy, cx]).astype(np.uint8) * 255
            return cv2.dilate(seg, np.ones((5, 5), np.uint8), iterations=1)
        for r in range(1, 15):
            for dy in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < labels.shape[0] and 0 <= nx < labels.shape[1] and labels[ny, nx] > 0:
                        seg = (labels == labels[ny, nx]).astype(np.uint8) * 255
                        return cv2.dilate(seg, np.ones((5, 5), np.uint8), iterations=1)
        return local