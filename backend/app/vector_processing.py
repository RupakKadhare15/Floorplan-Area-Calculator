import fitz
import numpy as np
import base64
import cv2
import io
import math
import random
from PIL import Image

# --- 1. CORE HELPERS ---
def get_dynamic_kernel(image_shape, base_size=3, reference_width=800):
    h, w = image_shape[:2]
    scale = max(h, w) / reference_width
    new_size = int(base_size * scale)
    if new_size % 2 == 0: new_size += 1
    return np.ones((max(3, new_size), max(3, new_size)), np.uint8)

def calculate_precise_area(mask):
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    total_area = 0
    for cnt in contours:
        if cv2.contourArea(cnt) < 5: continue
        approx = cv2.approxPolyDP(cnt, 0.002 * cv2.arcLength(cnt, True), True)
        total_area += cv2.contourArea(approx)
    return total_area

# --- 2. VECTOR DNA LOGIC ---
def get_dna(d):
    """Extracts the semantic identity of a CAD vector."""
    return {
        "color": d.get("color"),
        "fill": d.get("fill"),
        "width": d.get("width"),
        "type": "fill" if d.get("type") in ["f", "fs"] else "stroke"
    }

def match_dna(dna1, dna2):
    """Safely compares DNA, handling null/None types perfectly."""
    if dna1["type"] != dna2["type"]: return False
    if dna1["color"] != dna2["color"]: return False
    if dna1["fill"] != dna2["fill"]: return False
    
    w1, w2 = dna1["width"], dna2["width"]
    if w1 is None and w2 is None: return True
    if w1 is None or w2 is None: return False
    return math.isclose(w1, w2, abs_tol=0.5) # Generous tolerance for CAD scaling

# --- 3. SMART VECTOR WAND ---
def process_vector_wand(pdf_bytes, click_x_px, click_y_px, dpi, category, color):
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page = doc[0]
    
    scale = 72.0 / dpi
    img_w = int(page.rect.width / scale)
    img_h = int(page.rect.height / scale)
    
    # Create an invisible ID map to precisely detect what the user clicks
    id_map = np.full((img_h, img_w), -1, dtype=np.int32)
    items_list = []
    
    drawings = page.get_drawings()
    
    # 1. PARSE & MAP VECTORS
    for d in drawings:
        # Semantic Filter: Drop dashed lines (architectural grids)
        if d.get("dashes") and d.get("dashes") != "[] 0": continue
        # Semantic Filter: Drop massive background boundaries
        rect = d.get("rect")
        if rect and (rect.width > page.rect.width * 0.95 and rect.height > page.rect.height * 0.95): continue

        dna = get_dna(d)
        is_fill = dna["type"] == "fill"
        thick = max(1, int((dna["width"] or 1.0) / scale))
        if thick < 1: thick = 1
        
        for item in d["items"]:
            idx = len(items_list)
            items_list.append({"item": item, "dna": dna})
            
            # Draw exactly to the ID map
            if item[0] == "l":
                p1 = (int(item[1].x / scale), int(item[1].y / scale))
                p2 = (int(item[2].x / scale), int(item[2].y / scale))
                cv2.line(id_map, p1, p2, idx, max(thick, 3)) # Minimum 3px hit-box
            elif item[0] == "re":
                r = item[1]
                p1, p2 = (int(r.x0 / scale), int(r.y0 / scale)), (int(r.x1 / scale), int(r.y1 / scale))
                if is_fill: cv2.rectangle(id_map, p1, p2, idx, -1)
                else: cv2.rectangle(id_map, p1, p2, idx, max(thick, 3))
            elif item[0] == "qu":
                q = item[1]
                pts = np.array([[q.ul.x, q.ul.y], [q.ur.x, q.ur.y], [q.lr.x, q.lr.y], [q.ll.x, q.ll.y]]) / scale
                if is_fill: cv2.fillPoly(id_map, [pts.astype(np.int32)], idx)
                else: cv2.polylines(id_map, [pts.astype(np.int32)], True, idx, max(thick, 3))

    y, x = click_y_px, click_x_px
    if not (0 <= x < img_w and 0 <= y < img_h): return None, 0, 0

    # 2. IDENTIFY CLICKED TARGET
    clicked_idx = id_map[y, x]
    if clicked_idx == -1:
        # Search a 10px radius if the user slightly missed the line
        r = 10
        patch = id_map[max(0, y-r):min(img_h, y+r+1), max(0, x-r):min(img_w, x+r+1)]
        valid_pixels = patch[patch != -1]
        if len(valid_pixels) > 0:
            clicked_idx = valid_pixels[0]
            
    if clicked_idx == -1: return None, 0, 0 # Clicked absolute empty space
        
    target_dna = items_list[clicked_idx]["dna"]

    # 3. ISOLATE THE DNA LAYER
    clean_canvas = np.zeros((img_h, img_w), dtype=np.uint8)
    
    for d in drawings:
        if d.get("dashes") and d.get("dashes") != "[] 0": continue
        if match_dna(get_dna(d), target_dna):
            is_fill = target_dna["type"] == "fill"
            thick = max(2, int((target_dna["width"] or 1.0) / scale))
            
            for item in d["items"]:
                if item[0] == "l":
                    p1 = (int(item[1].x / scale), int(item[1].y / scale))
                    p2 = (int(item[2].x / scale), int(item[2].y / scale))
                    cv2.line(clean_canvas, p1, p2, 255, thick)
                elif item[0] == "re":
                    r = item[1]
                    p1, p2 = (int(r.x0 / scale), int(r.y0 / scale)), (int(r.x1 / scale), int(r.y1 / scale))
                    if is_fill: cv2.rectangle(clean_canvas, p1, p2, 255, -1)
                    else: cv2.rectangle(clean_canvas, p1, p2, 255, thick)
                elif item[0] == "qu":
                    q = item[1]
                    pts = np.array([[q.ul.x, q.ul.y], [q.ur.x, q.ur.y], [q.lr.x, q.lr.y], [q.ll.x, q.ll.y]]) / scale
                    if is_fill: cv2.fillPoly(clean_canvas, [pts.astype(np.int32)], 255)
                    else: cv2.polylines(clean_canvas, [pts.astype(np.int32)], True, 255, thick)

    # 4. SECURE SELECTION
    mask = np.zeros((img_h, img_w), dtype=np.uint8)
    
    if target_dna["type"] == "fill":
        # Connect isolated fills
        num_labels, labels = cv2.connectedComponents(clean_canvas, connectivity=8)
        roi_labels = labels[max(0, y-10):min(img_h, y+10), max(0, x-10):min(img_w, x+10)]
        valid_labels = roi_labels[roi_labels > 0]
        if len(valid_labels) > 0:
            target_label = np.bincount(valid_labels.flatten()).argmax()
            mask[labels == target_label] = 255
    else:
        # Unfilled walls. We try to flood fill the cavity first.
        flood_mask = np.zeros((img_h + 2, img_w + 2), dtype=np.uint8)
        
        # Dilate slightly to seal small CAD corners
        dilated_canvas = cv2.dilate(clean_canvas, np.ones((3,3), np.uint8), iterations=1)
        cv2.floodFill(dilated_canvas, flood_mask, (x, y), 255, flags=4 | (255 << 8))
        filled_area = flood_mask[1:-1, 1:-1]
        
        # Anti-Bleed constraint: If flood covers >15% of page, it leaked out a doorway
        if cv2.countNonZero(filled_area) < (img_w * img_h * 0.15):
            mask = filled_area
        else:
            # Fallback: Just grab the contiguous vector lines themselves
            num_labels, labels = cv2.connectedComponents(clean_canvas, connectivity=8)
            roi_labels = labels[max(0, y-10):min(img_h, y+10), max(0, x-10):min(img_w, x+10)]
            valid_labels = roi_labels[roi_labels > 0]
            if len(valid_labels) > 0:
                target_label = np.bincount(valid_labels.flatten()).argmax()
                mask[labels == target_label] = 255

    if cv2.countNonZero(mask) == 0: return None, 0, 0

    # 5. RENDER OVERLAY
    rgba = np.zeros((img_h, img_w, 4), dtype=np.uint8)
    rgba[mask == 255] = [*color, 200]
    
    buff = io.BytesIO()
    Image.fromarray(rgba).save(buff, format="PNG")
    img_str = base64.b64encode(buff.getvalue()).decode("utf-8")
    
    pixel_area = calculate_precise_area(mask)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    pixel_length = sum(cv2.arcLength(c, True) for c in contours) / 2 if contours else 0
    
    return img_str, pixel_area, pixel_length

# --- 4. VECTOR LINE TOOL ---
def process_vector_line(p1, p2, image_shape, color):
    h, w = image_shape[:2]
    raw_mask = np.zeros((h, w), np.uint8)
    cv2.line(raw_mask, (int(p1[0]), int(p1[1])), (int(p2[0]), int(p2[1])), 255, 12)
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[raw_mask > 0] = [*color, 200]
    buff = io.BytesIO()
    Image.fromarray(rgba).save(buff, format="PNG")
    return base64.b64encode(buff.getvalue()).decode("utf-8"), calculate_precise_area(raw_mask), math.sqrt((p2[0]-p1[0])**2 + (p2[1]-p1[1])**2)

# --- 5. EXISTING SEGMENTATION ---
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
            if m_cv.shape[:2] != (h, w): m_cv = cv2.resize(m_cv, (w, h), interpolation=cv2.INTER_NEAREST)
            if len(m_cv.shape) == 3 and m_cv.shape[2] == 4:
                _, structure = cv2.threshold(m_cv[:, :, 3], 10, 255, cv2.THRESH_BINARY)
            elif len(m_cv.shape) == 3:
                _, structure = cv2.threshold(cv2.cvtColor(m_cv, cv2.COLOR_BGR2GRAY), 5, 255, cv2.THRESH_BINARY)
            else:
                _, structure = cv2.threshold(m_cv, 5, 255, cv2.THRESH_BINARY)
            barriers = cv2.bitwise_or(barriers, structure)

    add_masks_robust(wall_mask_bytes_list)
    add_masks_robust(open_mask_bytes_list)
    
    kernel = get_dynamic_kernel(img_cv.shape, base_size=3)
    room_space = cv2.bitwise_not(cv2.dilate(barriers, kernel, iterations=1))
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(room_space, connectivity=4)

    rooms_data = []
    sorted_indices = np.argsort(stats[:, cv2.CC_STAT_AREA])[::-1]
    if len(sorted_indices) == 0: return []

    min_area = (w * h) * 0.0005 
    for i in range(1, num_labels):
        if i == sorted_indices[0] or stats[i, cv2.CC_STAT_AREA] < min_area: continue
        
        blob = np.zeros(labels.shape, dtype=np.uint8)
        blob[labels == i] = 255
        blob = cv2.dilate(blob, kernel, iterations=2)
        
        contours, _ = cv2.findContours(blob, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours: continue
        
        approx = cv2.approxPolyDP(contours[0], 0.002 * cv2.arcLength(contours[0], True), True)
        clean_mask = np.zeros((h, w), dtype=np.uint8)
        cv2.drawContours(clean_mask, [approx], -1, 255, -1)
        
        color = (random.randint(100, 255), random.randint(100, 255), random.randint(100, 255))
        rgba = np.zeros((h, w, 4), dtype=np.uint8)
        rgba[clean_mask > 0] = [*color, 150]
        
        buff = io.BytesIO()
        Image.fromarray(rgba).save(buff, format="PNG")
        
        rooms_data.append({
            "id": f"R{len(rooms_data)+1}",
            "src": base64.b64encode(buff.getvalue()).decode("utf-8"),
            "pixel_area": cv2.contourArea(approx),
            "pixel_perimeter": cv2.arcLength(approx, True), 
            "center": {"x": int(centroids[i][0]), "y": int(centroids[i][1])},
            "color": f"rgb({color[0]},{color[1]},{color[2]})"
        })
    return rooms_data