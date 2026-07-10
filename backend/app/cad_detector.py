"""
CAD Element Detector v2 — Wall-Gap-First Approach

Instead of hunting for arc shapes, we find GAPS in walls first,
then classify each gap:
  - Gap + arc nearby = DOOR
  - Gap + parallel lines inside = WINDOW
  - Gap alone = OPENING (still selectable)

The highlight is always a LINE across the gap (ep1 to ep2),
and the measurement = gap width = real opening width.
"""

import pdfplumber
import math
import io
import logging
from collections import defaultdict

logger = logging.getLogger(__name__)


def find_wall_gaps(pdf_bytes, page_num=0, min_gap=10, max_gap=160, min_wall_len=25):
    pp = pdfplumber.open(io.BytesIO(pdf_bytes))
    page = pp.pages[page_num]
    edges = page.edges or []
    curves = page.curves or []

    lw_counts = defaultdict(int)
    for e in edges:
        lw = round(float(e.get('linewidth', 0) or 0), 2)
        if lw > 0:
            lw_counts[lw] += 1

    sorted_lws = sorted(lw_counts.items(), key=lambda x: -x[0])
    total_edges = sum(v for _, v in lw_counts.items()) or 1
    wall_lws = set()
    for lw, count in sorted_lws:
        if count > total_edges * 0.02 and lw >= 0.15:
            wall_lws.add(lw)
    if not wall_lws and sorted_lws:
        wall_lws = {sorted_lws[0][0]}
    wall_lw_min = min(wall_lws) if wall_lws else 0.15

    logger.info(f"Wall gaps: wall LWs={sorted(wall_lws)}, min={wall_lw_min:.2f}")

    h_walls = []
    v_walls = []
    for e in edges:
        lw = float(e.get('linewidth', 0) or 0)
        if lw < wall_lw_min:
            continue
        pts = e.get('pts', [])
        if len(pts) < 2:
            continue
        x0, y0 = float(pts[0][0]), float(pts[0][1])
        x1, y1 = float(pts[-1][0]), float(pts[-1][1])
        dx, dy = abs(x1 - x0), abs(y1 - y0)
        length = math.hypot(dx, dy)
        if length < min_wall_len:
            continue
        wall = {"x0": x0, "y0": y0, "x1": x1, "y1": y1, "lw": lw, "len": length}
        if dx > dy * 2.5:
            h_walls.append(wall)
        elif dy > dx * 2.5:
            v_walls.append(wall)

    logger.info(f"Wall gaps: {len(h_walls)} H walls, {len(v_walls)} V walls")

    gaps = []
    gaps += _find_collinear_gaps(h_walls, "x", "y", min_gap, max_gap)
    gaps += _find_collinear_gaps(v_walls, "y", "x", min_gap, max_gap)
    unique_gaps = _deduplicate_gaps(gaps)
    classified = _classify_gaps(unique_gaps, curves, edges)

    pp.close()

    doors = sum(1 for g in classified if g['type'] == 'door')
    windows = sum(1 for g in classified if g['type'] == 'window')
    openings = sum(1 for g in classified if g['type'] == 'opening')
    logger.info(f"Wall gaps: {len(unique_gaps)} gaps -> {doors} doors, {windows} windows, {openings} openings")
    return classified


def _find_collinear_gaps(walls, main_axis, perp_axis, min_gap, max_gap):
    gaps = []
    perp_tol = 4.0
    for i, w1 in enumerate(walls):
        p1 = ((w1["y0"] + w1["y1"]) / 2) if perp_axis == "y" else ((w1["x0"] + w1["x1"]) / 2)
        for j in range(i + 1, len(walls)):
            w2 = walls[j]
            p2 = ((w2["y0"] + w2["y1"]) / 2) if perp_axis == "y" else ((w2["x0"] + w2["x1"]) / 2)
            if abs(p1 - p2) > perp_tol:
                continue
            if main_axis == "x":
                w1_min, w1_max = min(w1["x0"], w1["x1"]), max(w1["x0"], w1["x1"])
                w2_min, w2_max = min(w2["x0"], w2["x1"]), max(w2["x0"], w2["x1"])
            else:
                w1_min, w1_max = min(w1["y0"], w1["y1"]), max(w1["y0"], w1["y1"])
                w2_min, w2_max = min(w2["y0"], w2["y1"]), max(w2["y0"], w2["y1"])

            for gap_size, lo, hi in [(w2_min - w1_max, w1_max, w2_min), (w1_min - w2_max, w2_max, w1_min)]:
                if not (min_gap < gap_size < max_gap):
                    continue
                pavg = (p1 + p2) / 2
                if main_axis == "x":
                    ep1 = (lo, pavg)
                    ep2 = (hi, pavg)
                else:
                    ep1 = (pavg, lo)
                    ep2 = (pavg, hi)
                mid = ((ep1[0] + ep2[0]) / 2, (ep1[1] + ep2[1]) / 2)
                gaps.append({
                    "width": abs(gap_size),
                    "ep1": ep1, "ep2": ep2, "mid": mid,
                    "orientation": "H" if main_axis == "x" else "V",
                })
                break
    return gaps


def _deduplicate_gaps(gaps):
    unique = []
    seen = set()
    for g in sorted(gaps, key=lambda x: x["width"]):
        key = (round(g["mid"][0] / 10) * 10, round(g["mid"][1] / 10) * 10)
        if key not in seen:
            unique.append(g)
            seen.add(key)
    return unique


def _classify_gaps(gaps, curves, edges):
    classified = []
    for gap in gaps:
        mx, my = gap["mid"]
        gw = gap["width"]

        has_arc = False
        for c in curves:
            pts = c.get('pts', [])
            if len(pts) < 4:
                continue
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
            size = max(max(xs) - min(xs), max(ys) - min(ys))
            if size < 8 or size > gw * 4:
                continue
            if math.hypot(cx - mx, cy - my) < gw * 1.8:
                has_arc = True
                break

        lines_in_gap = 0
        for e in edges:
            pts_e = e.get('pts', [])
            if len(pts_e) < 2:
                continue
            ex = (float(pts_e[0][0]) + float(pts_e[-1][0])) / 2
            ey = (float(pts_e[0][1]) + float(pts_e[-1][1])) / 2
            elen = math.hypot(float(pts_e[-1][0]) - float(pts_e[0][0]),
                              float(pts_e[-1][1]) - float(pts_e[0][1]))
            if (math.hypot(ex - mx, ey - my) < gw * 0.8 and
                    gw * 0.5 < elen < gw * 1.5):
                lines_in_gap += 1

        if has_arc:
            gap_type = "door"
        elif lines_in_gap >= 3:
            gap_type = "window"
        else:
            gap_type = "opening"

        classified.append({**gap, "type": gap_type})
    return classified


def gap_to_svg(gap):
    x0, y0 = gap["ep1"]
    x1, y1 = gap["ep2"]
    line_path = f"M{x0:.2f},{y0:.2f} L{x1:.2f},{y1:.2f}"
    tick = 4
    if gap["orientation"] == "H":
        t1 = f"M{x0:.2f},{y0-tick:.2f} L{x0:.2f},{y0+tick:.2f}"
        t2 = f"M{x1:.2f},{y1-tick:.2f} L{x1:.2f},{y1+tick:.2f}"
    else:
        t1 = f"M{x0-tick:.2f},{y0:.2f} L{x0+tick:.2f},{y0:.2f}"
        t2 = f"M{x1-tick:.2f},{y1:.2f} L{x1+tick:.2f},{y1:.2f}"
    return {
        "svg_groups": [
            {"d": line_path, "strokeWidth": 4},
            {"d": t1, "strokeWidth": 2},
            {"d": t2, "strokeWidth": 2},
        ],
        "opening_width_pts": gap["width"],
        "center": gap["mid"],
        "ep1": gap["ep1"],
        "ep2": gap["ep2"],
        "type": gap["type"],
    }


def find_nearest_gap(gaps, click_x, click_y, max_dist=80):
    best, best_dist = None, max_dist
    for gap in gaps:
        dist = math.hypot(gap["mid"][0] - click_x, gap["mid"][1] - click_y)
        if dist < best_dist:
            best_dist = dist
            best = gap
    return best


class CADDetector:
    def __init__(self, pdf_bytes, page_num=0):
        all_gaps = find_wall_gaps(pdf_bytes, page_num)

        pp = pdfplumber.open(io.BytesIO(pdf_bytes))
        page = pp.pages[page_num]
        self._ox = page.bbox[0]
        self._oy = page.bbox[1]
        pp.close()

        self.doors = []
        self.windows = []
        self.openings = []

        for gap in all_gaps:
            t = {
                **gap,
                "ep1": (gap["ep1"][0] - self._ox, gap["ep1"][1] - self._oy),
                "ep2": (gap["ep2"][0] - self._ox, gap["ep2"][1] - self._oy),
                "mid": (gap["mid"][0] - self._ox, gap["mid"][1] - self._oy),
            }
            if gap["type"] == "door":
                self.doors.append(t)
            elif gap["type"] == "window":
                self.windows.append(t)
            else:
                self.openings.append(t)

        logger.info(
            f"CADDetector v2: {len(self.doors)} doors, "
            f"{len(self.windows)} windows, {len(self.openings)} openings, "
            f"offset=({self._ox:.1f}, {self._oy:.1f})"
        )

    def select_door(self, click_x_pt, click_y_pt, max_dist=80):
        gap = find_nearest_gap(self.doors, click_x_pt, click_y_pt, max_dist)
        if not gap:
            gap = find_nearest_gap(self.openings, click_x_pt, click_y_pt, max_dist)
        if not gap:
            if self.doors:
                nearest = min(self.doors, key=lambda d: math.hypot(
                    d["mid"][0] - click_x_pt, d["mid"][1] - click_y_pt))
                dist = math.hypot(nearest["mid"][0] - click_x_pt, nearest["mid"][1] - click_y_pt)
                logger.warning(
                    f"Door miss: click=({click_x_pt:.1f},{click_y_pt:.1f}), "
                    f"nearest=({nearest['mid'][0]:.1f},{nearest['mid'][1]:.1f}), dist={dist:.1f}"
                )
            else:
                logger.warning("Door miss: 0 doors detected")
            return None
        logger.info(f"Door hit: width={gap['width']:.1f}pts, type={gap['type']}")
        return gap_to_svg(gap)

    def select_window(self, click_x_pt, click_y_pt, max_dist=80):
        gap = find_nearest_gap(self.windows, click_x_pt, click_y_pt, max_dist)
        if not gap:
            gap = find_nearest_gap(self.openings, click_x_pt, click_y_pt, max_dist)
        if not gap:
            return None
        return gap_to_svg(gap)

    def close(self):
        pass
