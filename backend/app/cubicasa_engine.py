"""
CubiCasa5K Auto-Detection Engine — with Preprocessing Pipeline

ROOT CAUSES of poor results (fixed here):
  1. CubiCasa was trained on CLEAN residential floor plans, not raw CAD exports
  2. Dimension text, annotations, title blocks confuse the model
  3. Floor plan may be tiny within a large PDF page — model sees mostly whitespace
  4. Gray-only input loses the visual context CubiCasa expects

PREPROCESSING PIPELINE:
  Step 1: Auto-crop to the floor plan region (remove margins, title blocks, legends)
  Step 2: Remove dimension text, annotations, hatching (use PDFCleaner mask)
  Step 3: Convert cleaned image to proper RGB format with white background
  Step 4: Resize to model-optimal dimensions (multiples of 64)
  Step 5: Run inference
  Step 6: Post-process — morphological cleanup, remove tiny fragments

Setup:
  1. git clone https://github.com/EmanuelKuhn/CubiCasa5k.git cubicasa
  2. Download model_best_val_loss_var.pkl from Google Drive
  3. pip install torch torchvision
"""

import numpy as np
import cv2
import io
import os
import sys
import math
import base64
import random
import logging
from PIL import Image

logger = logging.getLogger(__name__)

ROOM_CLASSES = [
    "Background", "Outdoor", "Wall", "Kitchen", "Living Room",
    "Bedroom", "Bathroom", "Hallway", "Storage", "Garage",
    "Undefined", "Railing"
]

ICON_CLASSES = [
    "Background", "Window", "Door", "Closet", "Toilet",
    "Sink", "Sauna", "Fireplace", "Bathtub", "Chimney", "Undefined"
]

_model = None
_cubicasa_path = None


# ═══════════════════════════════════════════════════════════════
# MODEL LOADING
# ═══════════════════════════════════════════════════════════════

def _find_cubicasa():
    """Find CubiCasa5K installation."""
    candidates = [
        os.path.join(os.path.dirname(__file__), "cubicasa"),
        os.path.join(os.path.dirname(__file__), "CubiCasa5k"),
        os.path.join(os.path.dirname(__file__), "..", "cubicasa"),
        os.path.join(os.path.dirname(__file__), "..", "CubiCasa5k"),
        os.path.join(os.path.dirname(__file__), "..", "..", "cubicasa"),
        os.path.join(os.path.dirname(__file__), "..", "..", "CubiCasa5k"),
        "/app/cubicasa",
        "/app/backend/cubicasa",
    ]
    for p in candidates:
        if os.path.isdir(p) and os.path.exists(os.path.join(p, "floortrans")):
            logger.info(f"CubiCasa5K found at: {os.path.abspath(p)}")
            return os.path.abspath(p)
    logger.warning(f"CubiCasa5K not found. Searched: {[os.path.abspath(c) for c in candidates]}")
    return None


def load_model(weights_path=None):
    """Load CubiCasa5K model, bypassing init_weights."""
    global _model, _cubicasa_path
    import torch

    _cubicasa_path = _find_cubicasa()
    if not _cubicasa_path:
        raise RuntimeError(
            "CubiCasa5K not found. Clone it:\n"
            "  git clone https://github.com/EmanuelKuhn/CubiCasa5k.git cubicasa"
        )

    if _cubicasa_path not in sys.path:
        sys.path.insert(0, _cubicasa_path)

    # Bypass get_model() → avoids init_weights() → avoids needing model_1427.pth
    from floortrans.models.hg_furukawa_original import hg_furukawa_original

    n_classes = 44
    model = hg_furukawa_original(51)
    model.conv4_ = torch.nn.Conv2d(256, n_classes, bias=True, kernel_size=1)
    model.upsample = torch.nn.ConvTranspose2d(
        n_classes, n_classes, kernel_size=4, stride=4
    )

    if weights_path is None:
        for candidate in [
            os.path.join(_cubicasa_path, "model_best_val_loss_var.pkl"),
            os.path.join(os.path.dirname(__file__), "model_best_val_loss_var.pkl"),
            os.path.join(os.path.dirname(__file__), "..", "model_best_val_loss_var.pkl"),
            "model_best_val_loss_var.pkl",
        ]:
            if os.path.exists(candidate):
                weights_path = candidate
                break

    if not weights_path or not os.path.exists(weights_path):
        raise RuntimeError(
            "CubiCasa5K weights not found. Download from:\n"
            "  https://drive.google.com/file/d/1gRB7ez1e4H7a9Y09lLqRuna0luZO5VRK"
        )

    device = "cuda" if torch.cuda.is_available() else "cpu"
    checkpoint = torch.load(weights_path, map_location=device, weights_only=False)
    model.load_state_dict(checkpoint["model_state"], strict=False)
    model.to(device)
    model.eval()
    _model = model

    logger.info(f"CubiCasa5K loaded on {device} from {weights_path}")
    return model


# ═══════════════════════════════════════════════════════════════
# PREPROCESSING PIPELINE — THE KEY TO GOOD RESULTS
# ═══════════════════════════════════════════════════════════════

def _auto_crop_floorplan(image_rgb):
    """
    Step 1: Find the floor plan region and crop out margins, title blocks, legends.
    
    Strategy: The floor plan is the densest connected region of dark ink.
    Title blocks and legends are typically at edges with lots of text.
    """
    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    h, w = gray.shape

    # Threshold to find all ink
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    # Close small gaps to connect wall segments
    kernel = np.ones((15, 15), np.uint8)
    closed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)

    # Find largest connected region (the floor plan)
    n_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(closed)

    if n_labels <= 1:
        logger.warning("Auto-crop: no ink regions found, using full image")
        return image_rgb, (0, 0, w, h)

    # Skip background (label 0), find largest component
    areas = stats[1:, cv2.CC_STAT_AREA]
    largest_idx = np.argmax(areas) + 1  # +1 because we skipped background

    # Get bounding box of largest component
    x = stats[largest_idx, cv2.CC_STAT_LEFT]
    y = stats[largest_idx, cv2.CC_STAT_TOP]
    cw = stats[largest_idx, cv2.CC_STAT_WIDTH]
    ch = stats[largest_idx, cv2.CC_STAT_HEIGHT]

    # If the largest region is very small (< 10% of page), it's probably not the floor plan
    # In that case, use the bounding box of ALL ink regions
    if cw * ch < 0.1 * w * h:
        # Use convex hull of all non-zero pixels
        all_ink = np.where(binary > 0)
        if len(all_ink[0]) > 100:
            y = int(np.percentile(all_ink[0], 2))
            x = int(np.percentile(all_ink[1], 2))
            y2 = int(np.percentile(all_ink[0], 98))
            x2 = int(np.percentile(all_ink[1], 98))
            cw = x2 - x
            ch = y2 - y

    # Add padding (5% of each dimension)
    pad_x = int(cw * 0.05)
    pad_y = int(ch * 0.05)
    x0 = max(0, x - pad_x)
    y0 = max(0, y - pad_y)
    x1 = min(w, x + cw + pad_x)
    y1 = min(h, y + ch + pad_y)

    cropped = image_rgb[y0:y1, x0:x1]
    crop_box = (x0, y0, x1, y1)

    logger.info(f"Auto-crop: {w}x{h} → {x1-x0}x{y1-y0} "
                f"(removed {100*(1 - (x1-x0)*(y1-y0)/(w*h)):.0f}% margins)")

    return cropped, crop_box


def _clean_for_model(image_rgb, clean_gray_mask=None):
    """
    Step 2+3: Remove annotations and prepare clean RGB image.
    
    If clean_gray_mask is provided (from PDFCleaner), use it to mask out noise.
    Otherwise, apply our own basic cleaning.
    """
    h, w = image_rgb.shape[:2]
    result = image_rgb.copy()

    if clean_gray_mask is not None:
        # PDFCleaner already identified noise regions (white = clean, dark = ink)
        # Where the clean gray is white (255) but original is dark → that was noise
        orig_gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)

        # Noise = pixels that are dark in original but white in cleaned version
        noise = (orig_gray < 200) & (clean_gray_mask > 240)
        result[noise] = [255, 255, 255]  # Replace noise with white
    else:
        # Basic cleaning: remove very thin lines (likely dimension/annotation lines)
        gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

        # Morphological opening with large kernel removes thin lines but keeps walls
        thick_kernel = np.ones((5, 5), np.uint8)
        thick_only = cv2.morphologyEx(binary, cv2.MORPH_OPEN, thick_kernel)

        # Thin lines = original minus thick structures
        thin_lines = cv2.subtract(binary, thick_only)

        # Dilate thin lines slightly to catch their full width
        thin_lines = cv2.dilate(thin_lines, np.ones((3, 3), np.uint8), iterations=1)

        # Replace thin lines with white
        result[thin_lines > 0] = [255, 255, 255]

    return result


def _postprocess_masks(room_pred, icon_pred, orig_h, orig_w):
    """
    Step 6: Morphological cleanup on prediction masks.
    
    Removes noise, fills small holes, smooths boundaries.
    """
    # Morphological cleanup for walls
    wall_mask = (room_pred == 2).astype(np.uint8) * 255
    # Close small gaps in walls
    wall_mask = cv2.morphologyEx(wall_mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    # Remove tiny wall fragments (< 500 pixels)
    n_labels, labels, stats, _ = cv2.connectedComponentsWithStats(wall_mask)
    for i in range(1, n_labels):
        if stats[i, cv2.CC_STAT_AREA] < 500:
            wall_mask[labels == i] = 0

    # Cleanup doors and windows similarly
    door_mask = (icon_pred == 2).astype(np.uint8) * 255
    door_mask = cv2.morphologyEx(door_mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    # Remove tiny door fragments
    n_labels, labels, stats, _ = cv2.connectedComponentsWithStats(door_mask)
    for i in range(1, n_labels):
        if stats[i, cv2.CC_STAT_AREA] < 200:
            door_mask[labels == i] = 0

    window_mask = (icon_pred == 1).astype(np.uint8) * 255
    window_mask = cv2.morphologyEx(window_mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    n_labels, labels, stats, _ = cv2.connectedComponentsWithStats(window_mask)
    for i in range(1, n_labels):
        if stats[i, cv2.CC_STAT_AREA] < 200:
            window_mask[labels == i] = 0

    return wall_mask, door_mask, window_mask


# ═══════════════════════════════════════════════════════════════
# INFERENCE
# ═══════════════════════════════════════════════════════════════

def predict(image_rgb, clean_gray=None):
    """
    Run CubiCasa5K with full preprocessing pipeline.

    Args:
        image_rgb: H×W×3 numpy array, uint8, RGB — ORIGINAL render
        clean_gray: H×W uint8 — cleaned grayscale from PDFCleaner (optional)
    """
    import torch

    global _model
    if _model is None:
        load_model()

    device = next(_model.parameters()).device
    orig_h, orig_w = image_rgb.shape[:2]

    # ── STEP 1: Auto-crop to floor plan region ──
    cropped_rgb, crop_box = _auto_crop_floorplan(image_rgb)

    # ── STEP 2+3: Clean annotations, prepare model input ──
    # Crop the clean_gray too if available
    cropped_clean = None
    if clean_gray is not None:
        x0, y0, x1, y1 = crop_box
        cropped_clean = clean_gray[y0:y1, x0:x1]

    clean_rgb = _clean_for_model(cropped_rgb, cropped_clean)

    # ── STEP 4: Resize for model (multiples of 64) ──
    crop_h, crop_w = clean_rgb.shape[:2]
    max_dim = 1024.0
    scale = max_dim / max(crop_h, crop_w)
    new_w = int(math.ceil(crop_w * scale / 64.0) * 64)
    new_h = int(math.ceil(crop_h * scale / 64.0) * 64)

    model_input = cv2.resize(clean_rgb, (new_w, new_h))

    # Normalize with ImageNet stats
    img_float = model_input.astype(np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406])
    std = np.array([0.229, 0.224, 0.225])
    img_norm = (img_float - mean) / std

    tensor = torch.from_numpy(img_norm.transpose(2, 0, 1)).float().unsqueeze(0)
    tensor = tensor.to(device)

    # ── STEP 5: Inference ──
    with torch.no_grad():
        output = _model(tensor)
        pred = output[-1] if isinstance(output, (list, tuple)) else output

    pred = pred.cpu().numpy()[0]  # (44, H_pred, W_pred)

    rooms = pred[21:33]
    icons = pred[33:44]

    room_pred = np.argmax(rooms, axis=0).astype(np.uint8)
    icon_pred = np.argmax(icons, axis=0).astype(np.uint8)

    # Resize predictions back to CROPPED size
    room_pred = cv2.resize(room_pred, (crop_w, crop_h),
                           interpolation=cv2.INTER_NEAREST).astype(np.int32)
    icon_pred = cv2.resize(icon_pred, (crop_w, crop_h),
                           interpolation=cv2.INTER_NEAREST).astype(np.int32)

    # ── STEP 6: Post-process ──
    wall_mask_crop, door_mask_crop, window_mask_crop = _postprocess_masks(
        room_pred, icon_pred, crop_h, crop_w
    )

    # ── Map predictions back to FULL image coordinates ──
    x0, y0, x1, y1 = crop_box
    wall_mask = np.zeros((orig_h, orig_w), np.uint8)
    door_mask = np.zeros((orig_h, orig_w), np.uint8)
    window_mask = np.zeros((orig_h, orig_w), np.uint8)
    room_pred_full = np.zeros((orig_h, orig_w), np.int32)

    wall_mask[y0:y1, x0:x1] = wall_mask_crop
    door_mask[y0:y1, x0:x1] = door_mask_crop
    window_mask[y0:y1, x0:x1] = window_mask_crop
    room_pred_full[y0:y1, x0:x1] = room_pred

    # Extract individual rooms
    room_masks = []
    for cls_id in range(3, 12):
        mask = (room_pred_full == cls_id)
        if np.sum(mask) < 200:
            continue

        mask_u8 = mask.astype(np.uint8) * 255
        # Clean small fragments
        mask_u8 = cv2.morphologyEx(mask_u8, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
        n_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(mask_u8)

        for i in range(1, n_labels):
            area = int(stats[i, cv2.CC_STAT_AREA])
            if area < 500:  # Minimum room size
                continue

            room_blob = (labels == i).astype(np.uint8) * 255
            # Compute perimeter
            contours, _ = cv2.findContours(room_blob, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            perimeter = sum(cv2.arcLength(c, True) for c in contours) if contours else 0

            color = (random.randint(100, 255), random.randint(100, 255), random.randint(100, 255))
            room_masks.append({
                "class_name": ROOM_CLASSES[cls_id],
                "class_id": cls_id,
                "mask": room_blob,
                "area": area,
                "perimeter": perimeter,
                "center": {"x": int(centroids[i][0]), "y": int(centroids[i][1])},
                "color": color,
            })

    return {
        "wall_mask": wall_mask > 0,
        "door_mask": door_mask > 0,
        "window_mask": window_mask > 0,
        "room_masks": room_masks,
        "room_pred": room_pred_full,
        "crop_box": crop_box,
    }


# ═══════════════════════════════════════════════════════════════
# HIGH-LEVEL API
# ═══════════════════════════════════════════════════════════════

def auto_detect(image_rgb: np.ndarray, scale_factor: float = None,
                clean_gray: np.ndarray = None):
    """
    Full auto-detection with preprocessing pipeline.

    Args:
        image_rgb: Original rendered floor plan (H×W×3 RGB)
        scale_factor: pixels per real-world unit (from calibration)
        clean_gray: Cleaned grayscale from PDFCleaner (optional but recommended)
    """
    result = predict(image_rgb, clean_gray=clean_gray)
    h, w = image_rgb.shape[:2]

    # Walls
    wall_u8 = result["wall_mask"].astype(np.uint8) * 255
    wall_b64 = _mask_to_b64(wall_u8, (29, 78, 216), w, h, alpha=180)
    wall_contours, _ = cv2.findContours(wall_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    wall_length = float(sum(cv2.arcLength(c, True) for c in wall_contours) / 2)

    # Doors
    door_u8 = result["door_mask"].astype(np.uint8) * 255
    door_b64 = _mask_to_b64(door_u8, (21, 128, 61), w, h, alpha=180)
    door_contours, _ = cv2.findContours(door_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    door_count = len([c for c in door_contours if cv2.contourArea(c) > 100])

    # Windows
    win_u8 = result["window_mask"].astype(np.uint8) * 255
    win_b64 = _mask_to_b64(win_u8, (194, 65, 12), w, h, alpha=180)
    win_contours, _ = cv2.findContours(win_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    win_count = len([c for c in win_contours if cv2.contourArea(c) > 100])

    # Rooms
    rooms = []
    for i, rm in enumerate(result["room_masks"]):
        rm_b64 = _mask_to_b64(rm["mask"], rm["color"], w, h, alpha=140)
        pixel_area = rm["area"]
        pixel_perimeter = rm.get("perimeter", 0)
        rooms.append({
            "id": f"R{i+1}",
            "mask_b64": rm_b64,
            "class_name": rm["class_name"],
            "pixel_area": pixel_area,
            "pixel_perimeter": pixel_perimeter,
            "real_area": pixel_area / (scale_factor ** 2) if scale_factor else None,
            "real_perimeter": pixel_perimeter / scale_factor if scale_factor else None,
            "center": rm["center"],
            "color": f"rgb({rm['color'][0]},{rm['color'][1]},{rm['color'][2]})",
        })

    return {
        "walls": {
            "mask_b64": wall_b64,
            "pixel_length": float(wall_length),
            "real_length": float(wall_length / scale_factor) if scale_factor else None,
        },
        "doors": {
            "mask_b64": door_b64,
            "count": int(door_count),
        },
        "windows": {
            "mask_b64": win_b64,
            "count": int(win_count),
        },
        "rooms": rooms,
        "img_width": int(w),
        "img_height": int(h),
    }


def _mask_to_b64(mask_u8, color, w, h, alpha=160):
    """Convert uint8 mask → base64 RGBA PNG."""
    rgba = np.zeros((h, w, 4), np.uint8)
    r, g, b = color
    rgba[mask_u8 > 0] = [r, g, b, alpha]
    buf = io.BytesIO()
    Image.fromarray(rgba).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()
