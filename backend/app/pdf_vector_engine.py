"""
Vector PDF Engine v2 — hyper-precise selection for CAD-exported PDFs.

Key fixes over v1:
  1. Filters out hatching (short diagonal lines), text glyphs (unstroke curves),
     and fill-only backgrounds before indexing.
  2. Classifies every edge as STRUCTURAL (walls/partitions) or DECORATIVE
     (dimensions, annotations, hatching).
  3. Flood-select respects orientation: won't jump from a horizontal wall
     to a 45° hatch stroke even if they share an endpoint.

Coordinate system: all public methods use normalised coords where
(0,0) is top-left, matching PDF.js canvas at scale=1.
"""

import pdfplumber
import pikepdf
import math
import io
import cv2
import numpy as np
import random
import base64
from PIL import Image
from collections import defaultdict, deque

# ─────────────────────────── constants ──────────────────────────────

_AXIS_TOL_DEG = 10          # degrees from 0/90 to count as axis-aligned
_MIN_STRUCT_LENGTH = 12.0   # pts — shorter lines are decorative
_HATCH_MAX_LENGTH = 20.0    # pts — diagonal lines shorter than this = hatch
_HATCH_ANGLE_RANGE = (20, 70)  # degrees from horizontal to be "diagonal"

# ─────────────────────────── helpers ────────────────────────────────

def _pt_seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    len_sq = dx * dx + dy * dy
    if len_sq < 1e-12:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / len_sq))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _seg_length(x0, y0, x1, y1):
    return math.hypot(x1 - x0, y1 - y0)


def _seg_angle(x0, y0, x1, y1):
    """Returns angle in degrees [0, 180)."""
    return abs(math.degrees(math.atan2(y1 - y0, x1 - x0))) % 180


def _is_axis_aligned(angle):
    return angle < _AXIS_TOL_DEG or abs(angle - 90) < _AXIS_TOL_DEG or angle > (180 - _AXIS_TOL_DEG)


def _is_diagonal_hatch(angle, length):
    a = angle % 180
    in_diag = _HATCH_ANGLE_RANGE[0] < a < _HATCH_ANGLE_RANGE[1] or \
              (180 - _HATCH_ANGLE_RANGE[1]) < a < (180 - _HATCH_ANGLE_RANGE[0])
    return in_diag and length < _HATCH_MAX_LENGTH


def _orientations_compatible(a1, a2):
    """Check if two angles are in the same orientation class (both H, both V, or both diagonal)."""
    aa1 = _is_axis_aligned(a1)
    aa2 = _is_axis_aligned(a2)
    if aa1 and aa2:
        # both axis-aligned — OK (H connects to V at corners)
        return True
    if not aa1 and not aa2:
        # both diagonal — only if similar angle
        return abs(a1 - a2) < 15 or abs(a1 - a2 - 180) < 15
    # one axis, one diagonal — NOT compatible (wall vs hatch)
    return False


# ─────────────────────── grid spatial index ─────────────────────────

class _GridIndex:
    def __init__(self, cell):
        self.cell = max(cell, 1.0)
        self.grid = defaultdict(list)

    def insert(self, idx, x0, y0, x1, y1, pad=0.0):
        gx0 = int(math.floor((min(x0, x1) - pad) / self.cell))
        gx1 = int(math.floor((max(x0, x1) + pad) / self.cell))
        gy0 = int(math.floor((min(y0, y1) - pad) / self.cell))
        gy1 = int(math.floor((max(y0, y1) + pad) / self.cell))
        for gx in range(gx0, gx1 + 1):
            for gy in range(gy0, gy1 + 1):
                self.grid[(gx, gy)].append(idx)

    def query(self, x, y, radius):
        r = int(math.ceil(radius / self.cell))
        cx = int(math.floor(x / self.cell))
        cy = int(math.floor(y / self.cell))
        result = set()
        for dx in range(-r, r + 1):
            for dy in range(-r, r + 1):
                result.update(self.grid.get((cx + dx, cy + dy), []))
        return list(result)


class _EndpointIndex:
    def __init__(self, snap=0.5):
        self.snap = snap
        self.map = defaultdict(set)

    def _key(self, x, y):
        return (round(x / self.snap), round(y / self.snap))

    def add(self, idx, x, y):
        self.map[self._key(x, y)].add(idx)

    def neighbors(self, x, y, r=2):
        kx, ky = self._key(x, y)
        result = set()
        for dx in range(-r, r + 1):
            for dy in range(-r, r + 1):
                result.update(self.map.get((kx + dx, ky + dy), set()))
        return result


# ──────────────────────── main engine ───────────────────────────────

class VectorPDFEngine:

    def __init__(self, pdf_bytes: bytes, page_num: int = 0):
        self.pdf_bytes = pdf_bytes

        # layers via pikepdf
        pk = pikepdf.open(io.BytesIO(pdf_bytes))
        self.layers = {}
        root = pk.Root
        if pikepdf.Name("/OCProperties") in root:
            oc = root[pikepdf.Name("/OCProperties")]
            if pikepdf.Name("/OCGs") in oc:
                for ocg in oc[pikepdf.Name("/OCGs")]:
                    try:
                        self.layers[str(ocg[pikepdf.Name("/Name")])] = True
                    except Exception:
                        pass
        pk.close()

        # pdfplumber — THE authoritative coordinate source
        self.pp = pdfplumber.open(io.BytesIO(pdf_bytes))
        self.pp_page = self.pp.pages[page_num]
        bx0, by0, bx1, by1 = self.pp_page.bbox
        self._bx0 = bx0    # left edge in pdfplumber coords
        self._by0 = by0     # top edge in pdfplumber coords
        self.page_width = bx1 - bx0
        self.page_height = by1 - by0

        # build
        self.edges = []
        cell = max(self.page_width, self.page_height) / 150.0
        self.spatial = _GridIndex(cell)
        self.endpoints = _EndpointIndex(snap=max(cell / 4.0, 0.5))
        self._extract()

    # ──────────── coordinate transforms ─────────────

    def _norm(self, x, top):
        """pdfplumber (x, top) → normalised (0-based top-left)."""
        return (x - self._bx0, top - self._by0)

    # ──────────── extraction with filtering ─────────

    def _extract(self):
        pw, ph = self.page_width, self.page_height
        margin = 5.0

        for raw in self.pp_page.edges:
            otype = raw.get("object_type", "")
            stroke = bool(raw.get("stroke", False))
            fill = bool(raw.get("fill", False))

            # ── FILTER 1: skip text glyphs (curve_edges with no stroke) ──
            if otype == "curve_edge" and not stroke:
                continue

            # ── FILTER 2: skip fill-only shapes (hatching backgrounds) ──
            if fill and not stroke:
                continue

            # ── FILTER 3: skip LW=0 filled rects (gray hatching fills) ──
            lw = float(raw.get("linewidth", 0) or 0)
            if lw < 0.01 and fill:
                continue

            # ── determine endpoints via pts (most precise) ──
            pts = raw.get("pts", [])
            if pts and len(pts) >= 2:
                nx0, ny0 = self._norm(float(pts[0][0]), float(pts[0][1]))
                nx1, ny1 = self._norm(float(pts[-1][0]), float(pts[-1][1]))
            else:
                # fallback to bounding box coords
                nx0, ny0 = self._norm(float(raw["x0"]), float(raw["top"]))
                nx1, ny1 = self._norm(float(raw["x1"]), float(raw["bottom"]))

            # visibility
            if max(nx0, nx1) < -margin or min(nx0, nx1) > pw + margin:
                continue
            if max(ny0, ny1) < -margin or min(ny0, ny1) > ph + margin:
                continue
            color = raw.get("stroking_color")
            if isinstance(color, (list, tuple)):
                color = tuple(round(c, 3) for c in color)
            else:
                color = None

            # ── geometry metrics ──
            length = _seg_length(nx0, ny0, nx1, ny1)
            angle = _seg_angle(nx0, ny0, nx1, ny1)
            axis = _is_axis_aligned(angle)

            # ── FILTER 3: skip hatching strokes ──
            if _is_diagonal_hatch(angle, length):
                continue

            # ── classify ──
            # structural = likely wall/partition: axis-aligned OR long enough
            structural = axis or length >= _MIN_STRUCT_LENGTH

            dash = raw.get("dash")
            is_filled = fill  # edges that are both stroked AND filled

            idx = len(self.edges)
            edge = {
                "id": idx,
                "x0": nx0, "y0": ny0, "x1": nx1, "y1": ny1,
                "lw": lw,
                "color": color,
                "filled": is_filled,
                "type": otype,
                "dash": dash,
                "length": length,
                "angle": angle,
                "axis": axis,
                "structural": structural,
            }
            self.edges.append(edge)

            pad = lw / 2.0
            self.spatial.insert(idx, nx0, ny0, nx1, ny1, pad=pad)
            self.endpoints.add(idx, nx0, ny0)
            self.endpoints.add(idx, nx1, ny1)

    # ──────────── hit testing ───────────────────────

    def hit_test(self, x, y, radius=10.0, prefer_structural=True):
        """
        Find edges near click. When prefer_structural=True,
        structural edges are boosted (sorted first).
        """
        candidates = self.spatial.query(x, y, radius)
        hits = []
        for idx in candidates:
            e = self.edges[idx]
            d = _pt_seg_dist(x, y, e["x0"], e["y0"], e["x1"], e["y1"])
            effective = d - e["lw"] / 2.0
            if effective <= radius:
                hits.append((idx, max(0.0, effective)))

        if prefer_structural:
            # sort: structural first, then by distance
            hits.sort(key=lambda h: (0 if self.edges[h[0]]["structural"] else 1, h[1]))
        else:
            hits.sort(key=lambda h: h[1])
        return hits

    # ──────────── auto gap detection ────────────────

    def auto_gap_tolerance(self, seed_idx, lw_tol=0.2):
        seed = self.edges[seed_idx]
        target_lw = seed["lw"]

        pts = []
        for e in self.edges:
            if abs(e["lw"] - target_lw) > lw_tol:
                continue
            if not e["structural"]:
                continue
            pts.append((e["x0"], e["y0"]))
            pts.append((e["x1"], e["y1"]))
            if len(pts) >= 400:
                break

        if len(pts) < 10:
            return 5.0

        import random as _rnd
        sample = _rnd.sample(pts, min(200, len(pts)))
        nn = []
        for i, (px, py) in enumerate(sample):
            best = 1e9
            for j, (qx, qy) in enumerate(sample):
                if i == j:
                    continue
                d = math.hypot(px - qx, py - qy)
                if 0.01 < d < best:
                    best = d
            if best < 1e9:
                nn.append(best)
        if not nn:
            return 5.0
        nn.sort()
        p85 = nn[min(len(nn) - 1, int(len(nn) * 0.85))]
        return max(2.0, min(p85 * 1.5, 20.0))

    # ──────────── flood selection ───────────────────

    def flood_select(
        self,
        seed_idx: int,
        lw_tol: float = 0.2,
        gap_tol: float = 3.0,
        color_match: bool = True,
        structural_only: bool = True,
        max_edges: int = 12000,
    ):
        seed = self.edges[seed_idx]
        target_lw = seed["lw"]
        target_color = seed["color"]
        target_filled = seed["filled"]
        seed_angle = seed["angle"]

        selected = set()
        enqueued = {seed_idx}
        queue = deque([seed_idx])

        ep_r = max(2, min(int(gap_tol / self.endpoints.snap) + 1, 6))

        while queue and len(selected) < max_edges:
            idx = queue.popleft()
            e = self.edges[idx]

            # ── linewidth gate ──
            if abs(e["lw"] - target_lw) > lw_tol:
                continue

            # ── colour gate ──
            if color_match and e["color"] != target_color:
                continue

            # ── fill-type gate ──
            if e["filled"] != target_filled:
                continue

            # ── structural gate ──
            if structural_only and not e["structural"]:
                continue

            # ── orientation gate ──
            # don't jump from wall-type to hatch-type
            if not _orientations_compatible(seed_angle, e["angle"]):
                # allow if the edge is strongly axis-aligned (it's a wall corner)
                if not e["axis"]:
                    continue

            selected.add(idx)

            # expand
            for ep_x, ep_y in [(e["x0"], e["y0"]), (e["x1"], e["y1"])]:
                for n_idx in self.endpoints.neighbors(ep_x, ep_y, r=ep_r):
                    if n_idx in enqueued:
                        continue
                    ne = self.edges[n_idx]
                    for nx, ny in [(ne["x0"], ne["y0"]), (ne["x1"], ne["y1"])]:
                        if math.hypot(ep_x - nx, ep_y - ny) <= gap_tol:
                            enqueued.add(n_idx)
                            queue.append(n_idx)
                            break

        return list(selected)

    # ──────────── SVG output ────────────────────────

    def edges_to_svg_data(self, indices):
        if not indices:
            return None

        groups = defaultdict(list)
        total_length = 0.0

        for idx in indices:
            e = self.edges[idx]
            total_length += e["length"]
            lw_key = round(e["lw"], 3)
            groups[lw_key].append(
                f"M{e['x0']:.2f},{e['y0']:.2f}L{e['x1']:.2f},{e['y1']:.2f}"
            )

        svg_groups = []
        for lw, frags in groups.items():
            svg_groups.append({
                "d": " ".join(frags),
                "strokeWidth": max(lw, 0.5),
            })

        return {
            "svg_groups": svg_groups,
            "total_length_pts": total_length,
            "edge_count": len(indices),
            "edge_indices": indices,
        }

    # ──────────── eraser ────────────────────────────

    def apply_eraser(self, current_indices, eraser_points, radius=8.0):
        pts = [(eraser_points[i], eraser_points[i + 1])
               for i in range(0, len(eraser_points) - 1, 2)]
        keep = []
        for idx in current_indices:
            e = self.edges[idx]
            mx = (e["x0"] + e["x1"]) / 2.0
            my = (e["y0"] + e["y1"]) / 2.0
            erased = False
            for px, py in pts:
                if math.hypot(px - mx, py - my) < radius:
                    erased = True
                    break
                if _pt_seg_dist(px, py, e["x0"], e["y0"], e["x1"], e["y1"]) < radius:
                    erased = True
                    break
            if not erased:
                keep.append(idx)
        return keep

    # ──────────── measurements ──────────────────────

    def compute_length(self, indices):
        return sum(self.edges[i]["length"] for i in indices)

    # ──────────── room segregation ──────────────────

    def segregate_rooms(self, wall_idx_lists, open_idx_lists, scale_factor=None):
        res_scale = min(3000, max(1500, int(max(self.page_width, self.page_height) * 1.2)))
        sx = res_scale / self.page_width
        sy = (res_scale * self.page_height / self.page_width) / self.page_height
        sr = min(sx, sy)
        w_img = int(self.page_width * sr)
        h_img = int(self.page_height * sr)

        barrier = np.zeros((h_img, w_img), dtype=np.uint8)

        def _draw(lists):
            for idx_list in lists:
                for idx in idx_list:
                    if idx >= len(self.edges):
                        continue
                    e = self.edges[idx]
                    p0 = (int(e["x0"] * sr), int(e["y0"] * sr))
                    p1 = (int(e["x1"] * sr), int(e["y1"] * sr))
                    thick = max(2, int(e["lw"] * sr * 1.5))
                    cv2.line(barrier, p0, p1, 255, thick)

        _draw(wall_idx_lists)
        _draw(open_idx_lists)

        k = max(3, int(3 * sr / 1.5))
        if k % 2 == 0: k += 1
        kernel = np.ones((k, k), np.uint8)
        closed = cv2.dilate(barrier, kernel, iterations=2)
        room_space = cv2.bitwise_not(closed)

        n_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(room_space, 4)
        bg_id = np.argsort(stats[:, cv2.CC_STAT_AREA])[-1]
        min_area = w_img * h_img * 0.0005

        rooms = []
        rn = 1
        for i in range(1, n_labels):
            if i == bg_id or stats[i, cv2.CC_STAT_AREA] < min_area:
                continue
            blob = np.zeros(labels.shape, np.uint8)
            blob[labels == i] = 255
            blob = cv2.dilate(blob, np.ones((3, 3), np.uint8), iterations=2)
            cnts, _ = cv2.findContours(blob, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if not cnts:
                continue
            cnt = cnts[0]
            eps = 0.002 * cv2.arcLength(cnt, True)
            approx = cv2.approxPolyDP(cnt, eps, True)
            pa = cv2.contourArea(approx)
            pp = cv2.arcLength(approx, True)
            pt_area = pa / (sr ** 2)
            pt_perim = pp / sr
            ra = pt_area / (scale_factor ** 2) if scale_factor else None
            rp = pt_perim / scale_factor if scale_factor else None

            color = (random.randint(100, 255), random.randint(100, 255), random.randint(100, 255))
            r, g, b = color
            rgba = np.zeros((h_img, w_img, 4), np.uint8)
            clean = np.zeros((h_img, w_img), np.uint8)
            cv2.drawContours(clean, [approx], -1, 255, -1)
            rgba[clean > 0] = [r, g, b, 140]
            buf = io.BytesIO()
            Image.fromarray(rgba).save(buf, format="PNG")
            b64 = base64.b64encode(buf.getvalue()).decode()

            rooms.append({
                "id": f"R{rn}", "src": b64,
                "pixel_area": pt_area, "pixel_perimeter": pt_perim,
                "real_area": ra, "real_perimeter": rp,
                "center": {"x": float(centroids[i][0]) / sr, "y": float(centroids[i][1]) / sr},
                "color": f"rgb({r},{g},{b})",
                "img_width": w_img, "img_height": h_img,
            })
            rn += 1
        return rooms

    # ──────────── info ──────────────────────────────

    def get_page_info(self):
        structural = sum(1 for e in self.edges if e["structural"])
        return {
            "width": self.page_width,
            "height": self.page_height,
            "edge_count": len(self.edges),
            "structural_count": structural,
            "has_layers": len(self.layers) > 0,
            "layer_names": list(self.layers.keys()),
        }