"""
SAM Engine v3 — Unified SAM interface.

Installation options (pick ONE):
  SAM 1:      pip install segment-anything
  SAM 2:      pip install sam2           (requires python>=3.10, torch>=2.5.1)
  MobileSAM:  pip install mobile-sam

All run on CPU. SAM 2 is recommended for best boundary precision.
"""

import numpy as np
import logging

logger = logging.getLogger(__name__)

_BACKEND = None


def _detect_backend():
    global _BACKEND
    if _BACKEND is not None:
        return _BACKEND

    # SAM 2 (pip install sam2)
    try:
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor
        _BACKEND = "sam2"
        logger.info("SAM backend: SAM 2 (sam2 package)")
        return _BACKEND
    except ImportError:
        pass

    # SAM 1 (pip install segment-anything)
    try:
        from segment_anything import sam_model_registry, SamPredictor
        _BACKEND = "sam1"
        logger.info("SAM backend: SAM 1 (segment-anything)")
        return _BACKEND
    except ImportError:
        pass

    # MobileSAM (pip install mobile-sam)
    try:
        from mobile_sam import sam_model_registry, SamPredictor
        _BACKEND = "mobile_sam"
        logger.info("SAM backend: MobileSAM")
        return _BACKEND
    except ImportError:
        pass

    raise RuntimeError(
        "No SAM package found. Install one:\n"
        "  pip install sam2                  (best, needs python>=3.10 + torch>=2.5.1)\n"
        "  pip install segment-anything      (stable, any python + torch)\n"
        "  pip install mobile-sam            (lightest, fastest on CPU)\n"
    )


class SAMEngine:

    def __init__(self, checkpoint, model_type="vit_b", device="auto"):
        self.backend = _detect_backend()

        if device == "auto":
            try:
                import torch
                self.device = "cuda" if torch.cuda.is_available() else "cpu"
            except ImportError:
                self.device = "cpu"
        else:
            self.device = device

        self.predictor = None
        self._image_set = False
        self._load(checkpoint, model_type)

    def _load(self, checkpoint, model_type):

        if self.backend == "sam2":
            from sam2.build_sam import build_sam2
            from sam2.sam2_image_predictor import SAM2ImagePredictor

            # SAM 2 config is inferred from checkpoint filename
            configs = {
                "tiny": "configs/sam2.1/sam2.1_hiera_t.yaml",
                "small": "configs/sam2.1/sam2.1_hiera_s.yaml",
                "base_plus": "configs/sam2.1/sam2.1_hiera_b+.yaml",
                "large": "configs/sam2.1/sam2.1_hiera_l.yaml",
            }
            ckpt = checkpoint.lower()
            cfg = None
            for key, val in configs.items():
                if key in ckpt:
                    cfg = val
                    break
            if cfg is None:
                # Try model_type as key
                cfg = configs.get(model_type, "configs/sam2.1/sam2.1_hiera_t.yaml")

            model = build_sam2(cfg, checkpoint, device=self.device)
            self.predictor = SAM2ImagePredictor(model)
            logger.info(f"SAM 2 loaded: {checkpoint} on {self.device}")

        elif self.backend == "sam1":
            from segment_anything import sam_model_registry, SamPredictor
            import torch
            sam = sam_model_registry[model_type](checkpoint=checkpoint)
            sam.to(device=self.device)
            self.predictor = SamPredictor(sam)
            logger.info(f"SAM 1 {model_type} loaded on {self.device}")

        elif self.backend == "mobile_sam":
            from mobile_sam import sam_model_registry, SamPredictor
            import torch
            sam = sam_model_registry["vit_t"](checkpoint=checkpoint)
            sam.to(device=self.device)
            self.predictor = SamPredictor(sam)
            logger.info(f"MobileSAM loaded on {self.device}")

    def set_image(self, image_rgb):
        """Encode image. Call once per page."""
        self.predictor.set_image(image_rgb)
        self._image_set = True
        self._h, self._w = image_rgb.shape[:2]

    def predict(self, pos_points=None, neg_points=None, box=None, multimask=True):
        """
        Predict masks with point and/or box prompts.
        All coordinates are in image pixel space.
        """
        if not self._image_set:
            raise RuntimeError("Call set_image() first")

        coords, labels = [], []
        if pos_points:
            for p in pos_points:
                coords.append([float(p[0]), float(p[1])])
                labels.append(1)
        if neg_points:
            for p in neg_points:
                coords.append([float(p[0]), float(p[1])])
                labels.append(0)

        kwargs = {"multimask_output": multimask}
        if coords:
            kwargs["point_coords"] = np.array(coords, dtype=np.float32)
            kwargs["point_labels"] = np.array(labels, dtype=np.int32)
        if box is not None:
            kwargs["box"] = np.array(box, dtype=np.float32)

        if not coords and box is None:
            raise ValueError("Need at least one point or box")

        masks, scores, logits = self.predictor.predict(**kwargs)
        best = int(np.argmax(scores))
        return {
            "masks": masks,
            "scores": scores,
            "best_mask": masks[best],
            "best_score": float(scores[best]),
        }
