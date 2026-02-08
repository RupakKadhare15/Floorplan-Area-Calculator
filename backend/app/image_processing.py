import cv2
import numpy as np
import base64
from PIL import Image
import io
import math
import random

def calculate_precise_area(mask):
    """Calculates area using smoothed vector contours."""
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    total_vector_area = 0
    for cnt in contours:
        if cv2.contourArea(cnt) < 5: 
            continue
        epsilon = 0.002 * cv2.arcLength(cnt, True)
        approx_poly = cv2.approxPolyDP(cnt, epsilon, True)
        total_vector_area += cv2.contourArea(approx_poly)
    return total_vector_area

def process_magic_wand(image_bytes, seed_x, seed_y, tolerance, category, color=(0, 0, 255)):
    nparr = np.frombuffer(image_bytes, np.uint8)
    img_cv = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img_cv is None: return None, 0, 0
    h, w = img_cv.shape[:2]
    gray = cv2.cvtColor(img_cv, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)
    final_mask = np.zeros((h, w), np.uint8)

    # --- STRATEGY 1: LOCALIZED FILL (Doors & Windows) ---
    if category in ["Doors", "Windows"]:
        roi_size = 150 
        half = roi_size // 2
        x1, y1 = max(0, seed_x - half), max(0, seed_y - half)
        x2, y2 = min(w, seed_x + half), min(h, seed_y + half)
        roi = binary[y1:y2, x1:x2].copy()
        roi_seed_x, roi_seed_y = seed_x - x1, seed_y - y1
        if roi[roi_seed_y, roi_seed_x] == 0:
            r_search = 10
            found = False
            for dy in range(-r_search, r_search):
                for dx in range(-r_search, r_search):
                    ny, nx = roi_seed_y + dy, roi_seed_x + dx
                    if 0 <= ny < roi.shape[0] and 0 <= nx < roi.shape[1]:
                        if roi[ny, nx] == 255:
                            roi_seed_x, roi_seed_y = nx, ny
                            found = True
                            break
                if found: break
        kernel = np.ones((3, 3), np.uint8)
        if category == "Doors":
            roi_processed = cv2.dilate(roi, kernel, iterations=3)
        else:
            roi_processed = cv2.morphologyEx(roi, cv2.MORPH_CLOSE, kernel, iterations=2)
        h_roi, w_roi = roi.shape[:2]
        mask_roi = np.zeros((h_roi + 2, w_roi + 2), np.uint8)
        cv2.floodFill(roi_processed, mask_roi, (roi_seed_x, roi_seed_y), 255, flags=4|(255<<8)|cv2.FLOODFILL_FIXED_RANGE)
        filled_roi = mask_roi[1:-1, 1:-1]
        result_roi = cv2.bitwise_and(filled_roi, roi)
        final_mask[y1:y2, x1:x2] = result_roi
    elif category == "Walls":
        kernel = np.ones((3, 3), np.uint8)
        processed = cv2.erode(binary, kernel, iterations=1)
        mask = np.zeros((h + 2, w + 2), np.uint8)
        cv2.floodFill(processed, mask, (seed_x, seed_y), 255, flags=4|(255<<8)|cv2.FLOODFILL_FIXED_RANGE)
        filled_area = mask[1:-1, 1:-1]
        final_mask = cv2.dilate(filled_area, kernel, iterations=1)
    else:
        mask = np.zeros((h + 2, w + 2), np.uint8)
        cv2.floodFill(img_cv, mask, (seed_x, seed_y), (255,255,255), (tolerance,)*3, (tolerance,)*3, 4|(255<<8))
        final_mask = mask[1:-1, 1:-1]

    pixel_length = 0
    if category == "Walls":
        contours, _ = cv2.findContours(final_mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        perimeter = sum(cv2.arcLength(c, True) for c in contours)
        pixel_length = perimeter / 2
    
    rgba_mask = np.zeros((h, w, 4), dtype=np.uint8)
    r, g, b = color
    rgba_mask[final_mask > 0] = [r, g, b, 200]
    pil_img = Image.fromarray(rgba_mask)
    buff = io.BytesIO()
    pil_img.save(buff, format="PNG")
    img_str = base64.b64encode(buff.getvalue()).decode("utf-8")
    pixel_area = calculate_precise_area(final_mask)
    return img_str, pixel_area, pixel_length

def process_linear_opening(image_bytes, wall_mask_bytes_list, p1, p2, category, color=(0, 255, 0)):
    nparr = np.frombuffer(image_bytes, np.uint8)
    img_cv = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    h, w = img_cv.shape[:2]
    wall_map = np.zeros((h, w), np.uint8)
    pixel_length = math.sqrt((p2[0] - p1[0])**2 + (p2[1] - p1[1])**2)
    if wall_mask_bytes_list:
        for m_bytes in wall_mask_bytes_list:
            m_arr = np.frombuffer(m_bytes, np.uint8)
            m_cv = cv2.imdecode(m_arr, cv2.IMREAD_GRAYSCALE) 
            if m_cv is not None:
                if m_cv.shape[:2] != (h, w):
                    m_cv = cv2.resize(m_cv, (w, h))
                wall_map = cv2.bitwise_or(wall_map, m_cv)
    _, wall_binary = cv2.threshold(wall_map, 10, 255, cv2.THRESH_BINARY)
    dist_transform = cv2.distanceTransform(wall_binary, cv2.DIST_L2, 5)
    check_radius = 20
    thicknesses = []
    for p in [p1, p2]:
        x, y = int(p[0]), int(p[1])
        y1, y2 = max(0, y - check_radius), min(h, y + check_radius)
        x1, x2 = max(0, x - check_radius), min(w, x + check_radius)
        patch = dist_transform[y1:y2, x1:x2]
        if patch.size > 0:
            max_val = np.max(patch)
            if max_val > 0: thicknesses.append(max_val * 2)
    final_thickness = int(np.mean(thicknesses)) if thicknesses else 15
    raw_mask = np.zeros((h, w), np.uint8)
    cv2.line(raw_mask, (int(p1[0]), int(p1[1])), (int(p2[0]), int(p2[1])), 255, final_thickness)
    mask_inv_walls = cv2.bitwise_not(wall_binary)
    final_mask = cv2.bitwise_and(raw_mask, mask_inv_walls)
    rgba_mask = np.zeros((h, w, 4), dtype=np.uint8)
    r, g, b = color
    rgba_mask[final_mask > 0] = [r, g, b, 200]
    pil_img = Image.fromarray(rgba_mask)
    buff = io.BytesIO()
    pil_img.save(buff, format="PNG")
    img_str = base64.b64encode(buff.getvalue()).decode("utf-8")
    pixel_area = calculate_precise_area(final_mask)
    return img_str, pixel_area, pixel_length

def perform_room_segmentation(image_bytes, wall_mask_bytes_list, open_mask_bytes_list):
    nparr = np.frombuffer(image_bytes, np.uint8)
    img_cv = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img_cv is None: return []
    h, w = img_cv.shape[:2]
    barriers = np.zeros((h, w), np.uint8)

    def add_masks_robust(mask_list):
        nonlocal barriers
        for m_bytes in mask_list:
            m_arr = np.frombuffer(m_bytes, np.uint8)
            m_cv = cv2.imdecode(m_arr, cv2.IMREAD_UNCHANGED)
            if m_cv is None: continue
            if m_cv.shape[:2] != (h, w):
                m_cv = cv2.resize(m_cv, (w, h), interpolation=cv2.INTER_NEAREST)
            if len(m_cv.shape) == 3 and m_cv.shape[2] == 4:
                alpha = m_cv[:, :, 3]
                _, structure = cv2.threshold(alpha, 10, 255, cv2.THRESH_BINARY)
            elif len(m_cv.shape) == 3:
                gray = cv2.cvtColor(m_cv, cv2.COLOR_BGR2GRAY)
                _, structure = cv2.threshold(gray, 5, 255, cv2.THRESH_BINARY)
            else:
                _, structure = cv2.threshold(m_cv, 5, 255, cv2.THRESH_BINARY)
            barriers = cv2.bitwise_or(barriers, structure)

    add_masks_robust(wall_mask_bytes_list)
    add_masks_robust(open_mask_bytes_list)
    kernel = np.ones((3, 3), np.uint8)
    closed_barriers = cv2.dilate(barriers, kernel, iterations=1)
    room_space = cv2.bitwise_not(closed_barriers)
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(room_space, connectivity=4)

    rooms_data = []
    sorted_indices = np.argsort(stats[:, cv2.CC_STAT_AREA])[::-1]
    if len(sorted_indices) == 0: return []
    background_id = sorted_indices[0]
    room_count = 1

    for i in range(1, num_labels):
        area = stats[i, cv2.CC_STAT_AREA]
        if i == background_id or area < 1000: continue
        blob_mask = np.zeros(labels.shape, dtype=np.uint8)
        blob_mask[labels == i] = 255
        blob_mask = cv2.dilate(blob_mask, kernel, iterations=2)
        contours, _ = cv2.findContours(blob_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours: continue
        cnt = contours[0]
        epsilon = 0.002 * cv2.arcLength(cnt, True) 
        approx_curve = cv2.approxPolyDP(cnt, epsilon, True)
        
        pixel_perimeter = cv2.arcLength(approx_curve, True)

        clean_mask = np.zeros((h, w), dtype=np.uint8)
        cv2.drawContours(clean_mask, [approx_curve], -1, 255, -1)
        precise_pixel_area = cv2.contourArea(approx_curve)
        color = (random.randint(100, 255), random.randint(100, 255), random.randint(100, 255))
        r, g, b = color
        rgba_room = np.zeros((h, w, 4), dtype=np.uint8)
        rgba_room[clean_mask > 0] = [r, g, b, 150]
        pil_img = Image.fromarray(rgba_room)
        buff = io.BytesIO()
        pil_img.save(buff, format="PNG")
        img_str = base64.b64encode(buff.getvalue()).decode("utf-8")

        rooms_data.append({
            "id": f"R{room_count}",
            "src": img_str,
            "pixel_area": precise_pixel_area,
            "pixel_perimeter": pixel_perimeter, 
            "center": {"x": int(centroids[i][0]), "y": int(centroids[i][1])},
            "color": f"rgb({r},{g},{b})"
        })
        room_count += 1
    return rooms_data