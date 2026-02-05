"""import cv2
import numpy as np
import base64
from PIL import Image
import io
import math
import random

def process_magic_wand(image_bytes, seed_x, seed_y, tolerance, category, color=(0, 0, 255)):
    # 1. Decode image
    nparr = np.frombuffer(image_bytes, np.uint8)
    img_cv = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img_cv is None:
        return None, 0, 0
    
    h, w = img_cv.shape[:2]
    
    # 2. Pre-process: Create a sharp Black/White map
    gray = cv2.cvtColor(img_cv, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)

    final_mask = np.zeros((h, w), np.uint8)

    # --- STRATEGY 1: LOCALIZED FILL (Doors & Windows) ---
    if category in ["Doors", "Windows"]:
        roi_size = 150 
        half = roi_size // 2
        
        x1 = max(0, seed_x - half)
        y1 = max(0, seed_y - half)
        x2 = min(w, seed_x + half)
        y2 = min(h, seed_y + half)
        
        roi = binary[y1:y2, x1:x2].copy()
        
        roi_seed_x = seed_x - x1
        roi_seed_y = seed_y - y1
        
        # Auto-snap to nearest structure if clicked on empty space
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
        
        if category == "Doors":
            kernel = np.ones((3, 3), np.uint8)
            roi_processed = cv2.dilate(roi, kernel, iterations=3)
        else:
            kernel = np.ones((3, 3), np.uint8)
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
        # Approximate length via perimeter / 2
        # contours, _ = cv2.findContours(final_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        contours, _ = cv2.findContours(final_mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        perimeter = sum(cv2.arcLength(c, True) for c in contours)
        pixel_length = perimeter / 2
    elif category in ["Doors", "Windows"]:
        # For these, we might just default to 0 or calculate perimeter similarly if needed later
        pass
        
    # --- OUTPUT GENERATION ---
    rgba_mask = np.zeros((h, w, 4), dtype=np.uint8)
    r, g, b = color
    rgba_mask[final_mask > 0] = [r, g, b, 200]
    
    pil_img = Image.fromarray(rgba_mask)
    buff = io.BytesIO()
    pil_img.save(buff, format="PNG")
    img_str = base64.b64encode(buff.getvalue()).decode("utf-8")
    
    pixel_area = np.count_nonzero(final_mask)
    
    return img_str, pixel_area, pixel_length

def process_linear_opening(image_bytes, wall_mask_bytes_list, p1, p2, category, color=(0, 255, 0)):
    # 1. Decode Main Image
    nparr = np.frombuffer(image_bytes, np.uint8)
    img_cv = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    h, w = img_cv.shape[:2]

    # 2. Reconstruct Walls
    wall_map = np.zeros((h, w), np.uint8)
    
    # Calculate length immediately from points
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

    # 3. Dynamic Thickness
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
            if max_val > 0:
                thicknesses.append(max_val * 2)

    final_thickness = int(np.mean(thicknesses)) if thicknesses else 15
    
    # 4. Draw Line
    raw_mask = np.zeros((h, w), np.uint8)
    cv2.line(raw_mask, (int(p1[0]), int(p1[1])), (int(p2[0]), int(p2[1])), 255, final_thickness)

    # 5. Intelligent Clipping
    mask_inv_walls = cv2.bitwise_not(wall_binary)
    final_mask = cv2.bitwise_and(raw_mask, mask_inv_walls)

    # 6. Encode
    rgba_mask = np.zeros((h, w, 4), dtype=np.uint8)
    r, g, b = color
    rgba_mask[final_mask > 0] = [r, g, b, 200]
    
    pil_img = Image.fromarray(rgba_mask)
    buff = io.BytesIO()
    pil_img.save(buff, format="PNG")
    img_str = base64.b64encode(buff.getvalue()).decode("utf-8")
    
    pixel_area = np.count_nonzero(final_mask)
    
    return img_str, pixel_area, pixel_length

def perform_room_segmentation(image_bytes, wall_mask_bytes_list, open_mask_bytes_list):
    # 1. Decode Main Image
    nparr = np.frombuffer(image_bytes, np.uint8)
    img_cv = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img_cv is None: return []
    h, w = img_cv.shape[:2]

    # 2. Create the "Barrier" Map (Black Background)
    barriers = np.zeros((h, w), np.uint8)

    # Helper: Robustly extract 'Structure' from RGBA masks
    def add_masks_robust(mask_list):
        nonlocal barriers
        for m_bytes in mask_list:
            m_arr = np.frombuffer(m_bytes, np.uint8)
            # CRITICAL FIX: Read as UNCHANGED to get Alpha Channel
            m_cv = cv2.imdecode(m_arr, cv2.IMREAD_UNCHANGED)
            
            if m_cv is None: continue

            # Resize if dimensions don't match
            if m_cv.shape[:2] != (h, w):
                m_cv = cv2.resize(m_cv, (w, h), interpolation=cv2.INTER_NEAREST)

            # Extract the "Structure"
            if len(m_cv.shape) == 3 and m_cv.shape[2] == 4:
                # If RGBA: Use Alpha channel to find non-transparent pixels
                alpha = m_cv[:, :, 3]
                _, structure = cv2.threshold(alpha, 10, 255, cv2.THRESH_BINARY)
            elif len(m_cv.shape) == 3:
                # If RGB: Use Grayscale brightness
                gray = cv2.cvtColor(m_cv, cv2.COLOR_BGR2GRAY)
                _, structure = cv2.threshold(gray, 5, 255, cv2.THRESH_BINARY)
            else:
                # If Grayscale
                _, structure = cv2.threshold(m_cv, 5, 255, cv2.THRESH_BINARY)

            # Add to main barrier map
            barriers = cv2.bitwise_or(barriers, structure)

    # Process Wall and Opening Masks
    add_masks_robust(wall_mask_bytes_list)
    add_masks_robust(open_mask_bytes_list)

    # 3. HEAVY SEALING (Dilate)
    # We increase iterations to ensure gaps between "Doors" and "Walls" are bridged
    kernel = np.ones((3, 3), np.uint8)
    # Increased from 2 to 4 to close gaps seen in your screenshot
    closed_barriers = cv2.dilate(barriers, kernel, iterations=4)

    # 4. Invert: Rooms = White, Walls = Black
    room_space = cv2.bitwise_not(closed_barriers)

    # 5. Connected Components
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(room_space, connectivity=4)

    rooms_data = []
    
    # Sort by area (Largest is usually the background/exterior)
    sorted_indices = np.argsort(stats[:, cv2.CC_STAT_AREA])[::-1]
    
    # Safety check
    if len(sorted_indices) == 0:
        return []

    background_id = sorted_indices[0] # The biggest white space is the 'outside'

    room_count = 1

    for i in range(1, num_labels):
        area = stats[i, cv2.CC_STAT_AREA]
        
        # Filter: Must not be background, must be > 500 pixels (reduce noise)
        if i == background_id or area < 1000:
            continue

        # Create mask for this room
        this_room_mask = np.zeros(labels.shape, dtype=np.uint8)
        this_room_mask[labels == i] = 255
        
        # Optional: Erode slightly to pull color away from walls for cleaner look
        this_room_mask = cv2.erode(this_room_mask, kernel, iterations=2)

        # Generate Random Pastel Color
        color = (random.randint(100, 255), random.randint(100, 255), random.randint(100, 255))
        r, g, b = color

        # Create Output Image (Transparent PNG)
        rgba_room = np.zeros((h, w, 4), dtype=np.uint8)
        # Set color with 150/255 opacity
        rgba_room[this_room_mask > 0] = [r, g, b, 150]

        # Convert to Base64
        pil_img = Image.fromarray(rgba_room)
        buff = io.BytesIO()
        pil_img.save(buff, format="PNG")
        img_str = base64.b64encode(buff.getvalue()).decode("utf-8")

        rooms_data.append({
            "id": f"R{room_count}",
            "src": img_str,
            "pixel_area": int(area),
            "center": {"x": int(centroids[i][0]), "y": int(centroids[i][1])},
            "color": f"rgb({r},{g},{b})"
        })
        room_count += 1

    return rooms_data """ 

import cv2
import numpy as np
import base64
from PIL import Image
import io
import math
import random

# --- IMPROVEMENT: VECTOR-BASED AREA CALCULATION ---
def calculate_precise_area(mask):
    """
    1. Converts Pixel Mask -> Vector Contours.
    2. Smooths the jagged 'staircase' pixels using approxPolyDP.
    3. Calculates area using Geometry (Shoelace Formula).
    """
    # Find contours
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    total_vector_area = 0
    
    for cnt in contours:
        # Filter noise
        if cv2.contourArea(cnt) < 5: 
            continue
            
        # --- THE VECTOR FIX ---
        # Epsilon is the accuracy threshold. 0.2% of perimeter is standard for floor plans.
        # This converts "jagged pixels" into "straight vector lines".
        epsilon = 0.002 * cv2.arcLength(cnt, True)
        approx_poly = cv2.approxPolyDP(cnt, epsilon, True)
        
        # Calculate area of the smooth vector polygon
        total_vector_area += cv2.contourArea(approx_poly)
        
    return total_vector_area

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
        
        # Auto-snap
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

    # --- CALCULATE LENGTH (Approx perimeter / 2) ---
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
    
    # Use the new Vector function
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
    
    # Use the new Vector function
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
    # Keep this at 1 to minimize initial shrinkage
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
        # Filter noise (adjust 1000 if needed for very small rooms like WC)
        if i == background_id or area < 1000: continue

        # --- SMART ROOM RECOVERY (THE FIX) ---
        blob_mask = np.zeros(labels.shape, dtype=np.uint8)
        blob_mask[labels == i] = 255
        
        # [CHANGE HERE] Increased iterations to 2 to reclaim wall edge space
        blob_mask = cv2.dilate(blob_mask, kernel, iterations=2)

        # Snap to Polygon (Vectorizing rooms)
        contours, _ = cv2.findContours(blob_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours: continue
        cnt = contours[0]

        # 0.2% epsilon gives nice clean lines
        epsilon = 0.002 * cv2.arcLength(cnt, True) 
        approx_curve = cv2.approxPolyDP(cnt, epsilon, True)
        
        clean_mask = np.zeros((h, w), dtype=np.uint8)
        cv2.drawContours(clean_mask, [approx_curve], -1, 255, -1)
        
        # Use geometric area for precision
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