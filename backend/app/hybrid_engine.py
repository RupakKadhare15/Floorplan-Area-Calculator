"""
Hybrid Engine v6 — Production floor plan highlighter.

Pipeline: PDFCleaner → WallTracer → optional SAM → vector snap.

FIXES in this version:
  - BUG 1: SAM import changed from 'from sam_engine' to 'from .sam_engine'
"""

import numpy as np
import cv2
import io
import os
import base64
import tempfile
import logging
from PIL import Image
from pdf2image import convert_from_path

from .pdf_vector_engine import VectorPDFEngine
from .pdf_cleaner import PDFCleaner
from .wall_tracer import WallTracer
from .cad_detector import CADDetector

logger = logging.getLogger(__name__)

# ── FIX BUG 1: Relative import so SAM actually loads ──
_SAM_AVAILABLE = False
try:
    from .sam_engine import SAMEngine
    _SAM_AVAILABLE = True
    logger.info("SAM engine module available")
except ImportError as e:
    logger.info(f"SAM engine not available: {e}")


class HybridEngine:

    DPI = 200

    def __init__(self, pdf_bytes, page_num,
                 sam_checkpoint=None, sam_model_type="vit_b", sam_device="cpu"):
        self.pdf_bytes = pdf_bytes
        self.page_num = page_num

        # ── Vector engine ──
        self.vector = VectorPDFEngine(pdf_bytes, page_num)

        # ── Render ──
        self._render_image()

        # ── Scale factors ──
        self.pt_to_px_x = self.img_w / self.vector.page_width
        self.pt_to_px_y = self.img_h / self.vector.page_height

        # ── PDF Cleaning ──
        cleaner = PDFCleaner(
            pdf_bytes, page_num, self.image_rgb,
            self.pt_to_px_x, self.pt_to_px_y,
        )
        clean_gray = cleaner.clean()
        cleaner.close()

        # ── Wall Tracer (on CLEAN image) ──
        self.tracer = WallTracer(clean_gray, px_per_pt=self.pt_to_px_x)

        # ── SAM (optional, on ORIGINAL image for visual context) ──
        self.sam = None
        if _SAM_AVAILABLE and sam_checkpoint and os.path.exists(str(sam_checkpoint)):
            try:
                self.sam = SAMEngine(
                    checkpoint=sam_checkpoint,
                    model_type=sam_model_type,
                    device=sam_device,
                )
                self.sam.set_image(self.image_rgb)
                logger.info(f"SAM loaded successfully: {sam_checkpoint}")
            except Exception as e:
                logger.warning(f"SAM load failed: {e}")
                self.sam = None

        # ── Precompute edge pixel positions (5 sample points per edge) ──
        self._edge_px = []
        for e in self.vector.edges:
            p0 = (e["x0"] * self.pt_to_px_x, e["y0"] * self.pt_to_px_y)
            p1 = (e["x1"] * self.pt_to_px_x, e["y1"] * self.pt_to_px_y)
            mid = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
            q25 = (p0[0] * 0.75 + p1[0] * 0.25, p0[1] * 0.75 + p1[1] * 0.25)
            q75 = (p0[0] * 0.25 + p1[0] * 0.75, p0[1] * 0.25 + p1[1] * 0.75)
            self._edge_px.append({
                "mid": mid, "p0": p0, "p1": p1, "q25": q25, "q75": q75,
            })

        logger.info(
            f"HybridEngine: {len(self.vector.edges)} edges, "
            f"SAM={'YES (' + sam_checkpoint + ')' if self.sam else 'NO'}"
        )

        # ── CAD Detector (doors/windows by geometric pattern) ──
        self.cad = CADDetector(pdf_bytes, page_num)
        logger.info(
            f"CAD Detector: {len(self.cad.doors)} doors, "
            f"{len(self.cad.windows)} windows"
        )

    def _render_image(self):
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(self.pdf_bytes)
            p = tmp.name
        try:
            imgs = convert_from_path(
                p, dpi=self.DPI,
                first_page=self.page_num + 1, last_page=self.page_num + 1,
            )
            self.image_rgb = np.array(imgs[0])
            self.img_h, self.img_w = self.image_rgb.shape[:2]
        finally:
            os.unlink(p)

    def pt_to_px(self, x, y):
        return (x * self.pt_to_px_x, y * self.pt_to_px_y)

    # ─────────────── CORE SELECTION ──────────────────────

    def select(self, pos_points_pt, neg_points_pt=None,
               category="Walls", mask_index=None):

        primary = pos_points_pt[0]
        px_x, px_y = self.pt_to_px(*primary)

        # STAGE 1: WallTracer
        tracer_mask, direction = self.tracer.select_at(px_x, px_y)

        # STAGE 2: Optional SAM refinement
        final_mask = tracer_mask

        if self.sam is not None:
            ys, xs = np.where(tracer_mask > 0)
            if len(xs) > 10:
                pad = int(20 * self.pt_to_px_x)
                box = [
                    max(0, int(xs.min()) - pad),
                    max(0, int(ys.min()) - pad),
                    min(self.img_w, int(xs.max()) + pad),
                    min(self.img_h, int(ys.max()) + pad),
                ]
                pos_px = [self.pt_to_px(x, y) for x, y in pos_points_pt]
                neg_px = [self.pt_to_px(x, y) for x, y in (neg_points_pt or [])]
                try:
                    sam_r = self.sam.predict(
                        pos_points=pos_px,
                        neg_points=neg_px if neg_px else None,
                        box=box, multimask=True,
                    )
                    sam_mask = (sam_r["masks"][mask_index]
                                if mask_index is not None
                                else sam_r["best_mask"])
                    intersection = cv2.bitwise_and(
                        tracer_mask, sam_mask.astype(np.uint8) * 255
                    )
                    if np.sum(intersection > 0) > 50:
                        final_mask = intersection
                except Exception as e:
                    logger.warning(f"SAM prediction failed: {e}")

        # STAGE 3: Vector snap
        selected = self._snap_edges(final_mask, category)
        svg_data = self.vector.edges_to_svg_data(selected)
        total_length = self.vector.compute_length(selected)
        mask_b64 = self._mask_to_b64(final_mask, category)

        return {
            "svg_groups": svg_data["svg_groups"] if svg_data else [],
            "edge_indices": selected,
            "edge_count": len(selected),
            "total_length_pts": total_length,
            "sam_score": 1.0,
            "mask_b64": mask_b64,
            "all_masks": [{"mask_b64": mask_b64, "score": 1.0}],
            "mask_width": self.img_w,
            "mask_height": self.img_h,
            "direction": direction,
        }

    # ─────────────── VECTOR SNAP ─────────────────────────

    def _snap_edges(self, mask_u8, category):
        h, w = mask_u8.shape[:2]
        selected = []

        def _hit(px, py):
            ix, iy = int(px), int(py)
            return 0 <= iy < h and 0 <= ix < w and mask_u8[iy, ix] > 0

        for i, ep in enumerate(self._edge_px):
            edge = self.vector.edges[i]
            if category == "Walls" and not edge.get("structural", True):
                continue
            if (_hit(*ep["mid"]) or _hit(*ep["p0"]) or _hit(*ep["p1"])
                    or _hit(*ep["q25"]) or _hit(*ep["q75"])):
                selected.append(i)

        return selected

    # ─────────────── DOOR/WINDOW SELECTION ──────────────

    def select_door(self, click_x_pt, click_y_pt):
        """Click near a door → returns SVG + measurement."""
        result = self.cad.select_door(click_x_pt, click_y_pt)
        if not result:
            return None
        return {
            "svg_groups": result["svg_groups"],
            "opening_width_pts": result["opening_width_pts"],
            "edge_indices": [],
            "edge_count": 0,
            "total_length_pts": result["opening_width_pts"],
        }

    def select_window(self, click_x_pt, click_y_pt):
        """Click near a window → returns SVG + measurement."""
        result = self.cad.select_window(click_x_pt, click_y_pt)
        if not result:
            return None
        return {
            "svg_groups": result["svg_groups"],
            "opening_width_pts": result["opening_width_pts"],
            "edge_indices": [],
            "edge_count": 0,
            "total_length_pts": result["opening_width_pts"],
        }

    # ─────────────── ERASE ───────────────────────────────

    def erase(self, current_indices, eraser_points_pt, radius_pt=8.0):
        """Remove edges near eraser path. Returns remaining indices."""
        return self.vector.apply_eraser(current_indices, eraser_points_pt, radius_pt)

    # ─────────────── HELPERS ─────────────────────────────

    def _mask_to_b64(self, mask, category):
        h, w = mask.shape[:2]
        rgba = np.zeros((h, w, 4), np.uint8)
        colors = {
            "Walls": (29, 78, 216),
            "Doors": (21, 128, 61),
            "Windows": (194, 65, 12),
        }
        r, g, b = colors.get(category, (100, 100, 255))
        rgba[mask > 0] = [r, g, b, 160]
        buf = io.BytesIO()
        Image.fromarray(rgba).save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode()

    def segregate_rooms(self, wall_idx_lists, open_idx_lists, scale_factor=None):
        return self.vector.segregate_rooms(wall_idx_lists, open_idx_lists, scale_factor)

    def compute_length(self, indices):
        return self.vector.compute_length(indices)

    def get_page_info(self):
        info = self.vector.get_page_info()
        info["img_width"] = self.img_w
        info["img_height"] = self.img_h
        info["dpi"] = self.DPI
        info["sam_available"] = self.sam is not None
        return info
