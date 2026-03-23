"""
PDF Cleaner — removes non-wall elements from the rendered image
before wall tracing begins.

Removes:
  1. Text (room labels, dimensions values, annotations)
  2. Thin dimension/annotation lines (linewidth < threshold)
  3. Dashed lines (section cuts, hidden lines, center lines)
  4. Grid lines (lines spanning > 70% of page)
  5. Small symbols (circles < threshold, isolated marks)

The result is a "clean" grayscale image where only structural
elements (walls, doors, windows) remain visible.
"""

import numpy as np
import cv2
import pdfplumber
import logging

logger = logging.getLogger(__name__)


class PDFCleaner:

    # Linewidth below this (in PDF points) = dimension/annotation line
    THIN_LW_THRESHOLD = 0.20

    # Lines spanning more than this fraction of page = grid line
    GRID_SPAN_FRACTION = 0.65

    def __init__(self, pdf_bytes, page_num, image_rgb, px_per_pt_x, px_per_pt_y):
        """
        Args:
            pdf_bytes: raw PDF file bytes
            page_num: 0-indexed page number
            image_rgb: H×W×3 rendered image
            px_per_pt_x/y: pixels per PDF point (for coordinate mapping)
        """
        self.image = image_rgb
        self.ih, self.iw = image_rgb.shape[:2]
        self.px_per_pt_x = px_per_pt_x
        self.px_per_pt_y = px_per_pt_y

        # Parse PDF structure
        self.pp = pdfplumber.open(__import__('io').BytesIO(pdf_bytes))
        self.page = self.pp.pages[page_num]
        bx0, by0, bx1, by1 = self.page.bbox
        self._bx0 = bx0
        self._by0 = by0
        self._pw = bx1 - bx0
        self._ph = by1 - by0
        self._sx = self.iw / self._pw
        self._sy = self.ih / self._ph

    def clean(self):
        """
        Returns a cleaned grayscale image with text/dimensions/annotations
        replaced by white pixels.
        """
        gray = cv2.cvtColor(self.image, cv2.COLOR_RGB2GRAY)

        # Build combined noise mask
        noise = np.zeros((self.ih, self.iw), np.uint8)

        # 1. Text regions
        text_mask = self._mask_text()
        noise = cv2.bitwise_or(noise, text_mask)

        # 2. Thin lines (dimensions, annotations)
        thin_mask = self._mask_thin_lines()
        noise = cv2.bitwise_or(noise, thin_mask)

        # 3. Dashed lines
        dash_mask = self._mask_dashed_lines()
        noise = cv2.bitwise_or(noise, dash_mask)

        # 4. Grid lines
        grid_mask = self._mask_grid_lines()
        noise = cv2.bitwise_or(noise, grid_mask)

        # Small dilation to catch edge pixels of masked elements
        noise = cv2.dilate(noise, np.ones((3, 3), np.uint8), iterations=1)

        # Apply: replace noise regions with white
        clean = gray.copy()
        clean[noise > 0] = 255

        removed_pct = 100 * np.sum(noise > 0) / (self.ih * self.iw)
        logger.info(f"PDFCleaner: removed {removed_pct:.1f}% of pixels "
                    f"(text + thin lines + dashed + grid)")

        return clean

    def _to_px(self, x, top):
        """PDF plumber coords → image pixels."""
        return (int((x - self._bx0) * self._sx),
                int((top - self._by0) * self._sy))

    # ─── 1. TEXT MASK ────────────────────────────────────

    def _mask_text(self):
        mask = np.zeros((self.ih, self.iw), np.uint8)
        pad = max(3, int(2 * self.px_per_pt_x))

        for word in self.page.extract_words():
            try:
                x0, y0 = self._to_px(float(word['x0']), float(word['top']))
                x1, y1 = self._to_px(float(word['x1']), float(word['bottom']))
                # Ensure correct order
                x0, x1 = min(x0, x1), max(x0, x1)
                y0, y1 = min(y0, y1), max(y0, y1)
                mask[max(0, y0 - pad):min(self.ih, y1 + pad),
                     max(0, x0 - pad):min(self.iw, x1 + pad)] = 255
            except (ValueError, KeyError):
                continue

        return mask

    # ─── 2. THIN LINES MASK ─────────────────────────────

    def _mask_thin_lines(self):
        mask = np.zeros((self.ih, self.iw), np.uint8)

        for e in self.page.edges:
            lw = float(e.get('linewidth', 0) or 0)
            if lw >= self.THIN_LW_THRESHOLD:
                continue

            otype = e.get('object_type', '')
            if otype not in ('line', 'rect_edge'):
                continue

            pts = e.get('pts', [])
            if len(pts) < 2:
                continue

            try:
                x0, y0 = self._to_px(float(pts[0][0]), float(pts[0][1]))
                x1, y1 = self._to_px(float(pts[-1][0]), float(pts[-1][1]))
                cv2.line(mask, (x0, y0), (x1, y1), 255, 3)
            except (ValueError, IndexError):
                continue

        return mask

    # ─── 3. DASHED LINES MASK ───────────────────────────

    def _mask_dashed_lines(self):
        mask = np.zeros((self.ih, self.iw), np.uint8)

        for e in self.page.edges:
            dash = e.get('dash')
            if dash is None or str(dash) in ('', 'None', '[]'):
                continue

            pts = e.get('pts', [])
            if len(pts) < 2:
                continue

            try:
                x0, y0 = self._to_px(float(pts[0][0]), float(pts[0][1]))
                x1, y1 = self._to_px(float(pts[-1][0]), float(pts[-1][1]))
                thickness = max(3, int(float(e.get('linewidth', 0.5) or 0.5) * self._sx * 2))
                cv2.line(mask, (x0, y0), (x1, y1), 255, thickness)
            except (ValueError, IndexError):
                continue

        return mask

    # ─── 4. GRID LINES MASK ─────────────────────────────

    def _mask_grid_lines(self):
        mask = np.zeros((self.ih, self.iw), np.uint8)
        min_span_x = self._pw * self.GRID_SPAN_FRACTION
        min_span_y = self._ph * self.GRID_SPAN_FRACTION

        for e in self.page.edges:
            if e.get('object_type') != 'line':
                continue

            w = abs(float(e.get('width', 0)))
            h = abs(float(e.get('height', 0)))

            if w > min_span_x or h > min_span_y:
                pts = e.get('pts', [])
                if len(pts) >= 2:
                    try:
                        x0, y0 = self._to_px(float(pts[0][0]), float(pts[0][1]))
                        x1, y1 = self._to_px(float(pts[-1][0]), float(pts[-1][1]))
                        cv2.line(mask, (x0, y0), (x1, y1), 255, 3)
                    except (ValueError, IndexError):
                        continue

        return mask

    def close(self):
        if self.pp:
            self.pp.close()
