"""import cv2
import numpy as np
import base64
from PIL import Image
import io

def process_magic_wand(image_bytes, seed_x, seed_y, tolerance, color=(0, 0, 255), isolate_structure=False):
    # 1. Decode image
    nparr = np.frombuffer(image_bytes, np.uint8)
    img_cv = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img_cv is None:
        return None, 0
    
    h, w = img_cv.shape[:2]
    
    # --- SMART STRUCTURE ISOLATION (The Fix) ---
    # If we are looking for Walls, we want to ignore thin furniture lines.
    if isolate_structure:
        # 1. Convert to Grayscale
        gray = cv2.cvtColor(img_cv, cv2.COLOR_BGR2GRAY)
        
        # 2. Threshold: Force everything to be strictly Black (0) or White (255)
        # We assume walls are darker than background. 
        # THRESH_BINARY_INV makes walls White (255) and background Black (0) for processing
        _, binary = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)
        
        # 3. Erosion: This "eats away" pixels. 
        # Thin lines (sofas/text) will disappear or disconnect. Thick walls will remain.
        kernel = np.ones((3, 3), np.uint8) # A 3x3 square
        processed_img = cv2.erode(binary, kernel, iterations=1)
        
        # Use this processed image for the flood fill calculation
        # We need to convert it back to BGR for floodFill function compatibility
        work_img = cv2.cvtColor(processed_img, cv2.COLOR_GRAY2BGR)
        
        # Since we inverted the image (Walls are now white), the seed point should be white (255,255,255)
        # But floodFill expects to start on a color. 
        # We just run floodFill on this high-contrast map.
    else:
        # Standard mode for Doors/Floors
        work_img = img_cv

    # 2. Prepare Mask
    mask = np.zeros((h + 2, w + 2), np.uint8)
    flood_flags = 4 | (255 << 8) | cv2.FLOODFILL_FIXED_RANGE
    
    # 3. Perform FloodFill on the Working Image
    # Note: We use a high tolerance here because we already thresholded the image if in isolation mode
    eff_tolerance = tolerance if not isolate_structure else 10
    
    cv2.floodFill(
        work_img,
        mask,
        (seed_x, seed_y),
        (0, 0, 0),
        (eff_tolerance, eff_tolerance, eff_tolerance),
        (eff_tolerance, eff_tolerance, eff_tolerance),
        flood_flags
    )
    
    # 4. Extract Area
    filled_area = mask[1:-1, 1:-1]
    
    # 5. DILATION (Grow Back)
    # If we eroded the walls to isolate them, the result is too thin. 
    # We must Dilate (grow) the mask back to cover the original wall width.
    if isolate_structure:
        kernel = np.ones((3, 3), np.uint8)
        filled_area = cv2.dilate(filled_area, kernel, iterations=1)

    # 6. Create Colored Output
    rgba_mask = np.zeros((h, w, 4), dtype=np.uint8)
    r, g, b = color
    rgba_mask[filled_area > 0] = [r, g, b, 200]
    
    # 7. Encode
    pil_img = Image.fromarray(rgba_mask)
    buff = io.BytesIO()
    pil_img.save(buff, format="PNG")
    img_str = base64.b64encode(buff.getvalue()).decode("utf-8")
    
    pixel_area = np.count_nonzero(filled_area)
    
    return img_str, pixel_area """
"""
import cv2
import numpy as np
import base64
from PIL import Image
import io

def process_magic_wand(image_bytes, seed_x, seed_y, tolerance, category, color=(0, 0, 255)):
    # 1. Decode image
    nparr = np.frombuffer(image_bytes, np.uint8)
    img_cv = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img_cv is None:
        return None, 0
    
    h, w = img_cv.shape[:2]
    
    # Convert to Grayscale for structural analysis
    gray = cv2.cvtColor(img_cv, cv2.COLOR_BGR2GRAY)
    
    # Create a binary threshold (Black lines = 0, White space = 255)
    # We invert it so Lines are White (255) for processing
    _, binary = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)

    # --- STRATEGY SELECTION BASED ON CATEGORY ---
    
    if category == "Doors":
        # STRATEGY: HEAVY DILATION
        # Doors have gaps between the arc and the line. 
        # We dilate (thicken) lines significantly to fuse them into one "blob".
        kernel = np.ones((5, 5), np.uint8) 
        # Dilate to connect the arc to the line
        processed_map = cv2.dilate(binary, kernel, iterations=2)
        
        # We flood fill on this "Thick" map
        work_img = processed_map
        
    elif category == "Windows":
        # STRATEGY: MODERATE CLOSE
        # Windows are parallel lines. We want to merge them, 
        # but try not to merge them fully into the main walls if possible.
        kernel = np.ones((3, 3), np.uint8)
        # Closing = Dilate then Erode. Fills small gaps (windows) but keeps large shapes (walls)
        processed_map = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=2)
        work_img = processed_map
        
    elif category == "Walls":
        # STRATEGY: EROSION (ISOLATION)
        # As discussed before, remove furniture touching walls
        kernel = np.ones((3, 3), np.uint8)
        processed_map = cv2.erode(binary, kernel, iterations=1)
        work_img = processed_map

    else:
        # STRATEGY: STANDARD (Ceiling/Floor)
        # Just use the original image color logic
        work_img = img_cv

    # --- FLOOD FILL EXECUTION ---
    
    # Mask must be 2 pixels larger
    mask = np.zeros((h + 2, w + 2), np.uint8)
    
    # Configure Flags
    # If we are using binary maps (Doors/Windows/Walls), we just look for connectivity (1)
    # If we are using standard (Ceiling), we use color diff
    if category in ["Doors", "Windows", "Walls"]:
        # Simple connectivity for binary maps
        flood_flags = 4 | (255 << 8) | cv2.FLOODFILL_FIXED_RANGE
        # Seed point for binary map (ensure we click on white part)
        # We treat the work_img as a single channel map
        fill_target = work_img
    else:
        # Color tolerance for Ceilings
        flood_flags = 4 | (255 << 8) | cv2.FLOODFILL_FIXED_RANGE
        fill_target = work_img

    # Perform Fill
    # If it's a binary map, we don't care about color difference (0,0,0)
    # If it's ceiling, we care about tolerance
    try:
        cv2.floodFill(
            fill_target,
            mask,
            (seed_x, seed_y),
            (255), # Fill value
            (tolerance, tolerance, tolerance),
            (tolerance, tolerance, tolerance),
            flood_flags
        )
    except Exception as e:
        print(f"Flood fill error: {e}")
        return None, 0
    
    # Extract the result area
    filled_area = mask[1:-1, 1:-1]
    
    # --- POST-PROCESSING ---
    
    if category == "Doors":
        # The fill is "blobby" because we dilated it. 
        # We intersect the Blob with the Original Lines to get a sharp result.
        # Logic: KEEP pixel IF (Filled_Area is Active AND Original_Binary is Active)
        final_mask = cv2.bitwise_and(filled_area, binary)
        
    elif category == "Windows":
        # Similar to doors, sharpen it back up
        final_mask = cv2.bitwise_and(filled_area, binary)
        
    elif category == "Walls":
        # Grow the walls back to original size (since we eroded them)
        kernel = np.ones((3, 3), np.uint8)
        final_mask = cv2.dilate(filled_area, kernel, iterations=1)
        
    else:
        # Ceiling/Floors: Use the fill as is
        final_mask = filled_area

    # --- OUTPUT GENERATION ---
    rgba_mask = np.zeros((h, w, 4), dtype=np.uint8)
    r, g, b = color
    
    # Paint the final calculated mask
    # Using 200/255 opacity for high visibility
    rgba_mask[final_mask > 0] = [r, g, b, 200]
    
    pil_img = Image.fromarray(rgba_mask)
    buff = io.BytesIO()
    pil_img.save(buff, format="PNG")
    img_str = base64.b64encode(buff.getvalue()).decode("utf-8")
    
    pixel_area = np.count_nonzero(final_mask)
    
    return img_str, pixel_area """


import cv2
import numpy as np
import base64
from PIL import Image
import io
import math
import random

# --- HELPER: PRECISE AREA CALCULATION ---
def calculate_precise_area(mask):
    """
    Calculates area using Contour Geometry for sub-pixel accuracy.
    """
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    total_area = 0
    for cnt in contours:
        total_area += cv2.contourArea(cnt)
    return total_area

def process_magic_wand(image_bytes, seed_x, seed_y, tolerance, category, color=(0, 0, 255)):
    # 1. Decode image
    nparr = np.frombuffer(image_bytes, np.uint8)
    img_cv = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img_cv is None: return None, 0, 0
    h, w = img_cv.shape[:2]
    
    # 2. Pre-process
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
        
        # Auto-snap to nearest structure
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

    # --- STRATEGY 2: GLOBAL ISOLATION (Walls) ---
    elif category == "Walls":
        kernel = np.ones((3, 3), np.uint8)
        processed = cv2.erode(binary, kernel, iterations=1)
        mask = np.zeros((h + 2, w + 2), np.uint8)
        cv2.floodFill(processed, mask, (seed_x, seed_y), 255, flags=4|(255<<8)|cv2.FLOODFILL_FIXED_RANGE)
        filled_area = mask[1:-1, 1:-1]
        final_mask = cv2.dilate(filled_area, kernel, iterations=1)

    # --- STRATEGY 3: COLOR (Ceiling/Floor) ---
    else:
        mask = np.zeros((h + 2, w + 2), np.uint8)
        cv2.floodFill(img_cv, mask, (seed_x, seed_y), (255,255,255), (tolerance,)*3, (tolerance,)*3, 4|(255<<8))
        final_mask = mask[1:-1, 1:-1]

    # --- CALCULATE LENGTH ---
    pixel_length = 0
    if category == "Walls":
        contours, _ = cv2.findContours(final_mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        perimeter = sum(cv2.arcLength(c, True) for c in contours)
        pixel_length = perimeter / 2
    
    # --- OUTPUT GENERATION ---
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

    # Reconstruct Walls
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

    # 3. SEAL GAPS (Thicken walls temporarily)
    kernel = np.ones((3, 3), np.uint8)
    closed_barriers = cv2.dilate(barriers, kernel, iterations=1)

    # 4. FIND ROOMS
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

        # --- SMART ROOM RECOVERY ---
        blob_mask = np.zeros(labels.shape, dtype=np.uint8)
        blob_mask[labels == i] = 255
        
        # Dilate slightly to reclaim space lost by wall thickening
        blob_mask = cv2.dilate(blob_mask, kernel, iterations=1)

        # Snap to Polygon
        contours, _ = cv2.findContours(blob_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours: continue
        cnt = contours[0]

        epsilon = 0.003 * cv2.arcLength(cnt, True) 
        approx_curve = cv2.approxPolyDP(cnt, epsilon, True)
        
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
            "center": {"x": int(centroids[i][0]), "y": int(centroids[i][1])},
            "color": f"rgb({r},{g},{b})"
        })
        room_count += 1

    return rooms_data
   