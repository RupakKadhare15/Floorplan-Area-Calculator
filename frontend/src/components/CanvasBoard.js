import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import axios from "axios";
import * as pdfjsLib from "pdfjs-dist/build/pdf";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.entry";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const API = process.env.REACT_APP_API_URL || "http://localhost:8000";
const RENDER_SCALE = 1.5;

const COLORS = {
  Walls:   { stroke: "#1d4ed8", fill: "rgba(29,78,216,0.55)", glow: "rgba(29,78,216,0.35)" },
  Doors:   { stroke: "#15803d", fill: "rgba(21,128,61,0.55)", glow: "rgba(21,128,61,0.35)" },
  Windows: { stroke: "#c2410c", fill: "rgba(194,65,12,0.55)", glow: "rgba(194,65,12,0.35)" },
};

const CanvasBoard = ({
  projectId, projectData, setProjectData,
  mode, setMode, activeTool, setActiveTool, selectedCategory,
  masks, addMask, updateMask, rooms, autoDetectResult, setAutoDetectResult,
}) => {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [pageInfo, setPageInfo] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [fitZoom, setFitZoom] = useState(1);  // zoom level that fits PDF in viewport
  const [loading, setLoading] = useState(false);

  // AI Wand state
  const [posPoints, setPosPoints] = useState([]);
  const [negPoints, setNegPoints] = useState([]);
  const [previewMask, setPreviewMask] = useState(null);
  const [previewSvg, setPreviewSvg] = useState(null);
  const [samMasks, setSamMasks] = useState([]);
  const [selectedMaskIdx, setSelectedMaskIdx] = useState(null);

  // Manual Polyline state
  const [polyPoints, setPolyPoints] = useState([]);
  const [mousePos, setMousePos] = useState(null);

  // Draw state
  const [isDrawing, setIsDrawing] = useState(false);
  const [calibLine, setCalibLine] = useState([]);
  const [eraserPath, setEraserPath] = useState([]);
  const [openingLine, setOpeningLine] = useState([]);

  // FIX ISSUE 6: show/hide auto-detect overlays
  const [showAutoDetect, setShowAutoDetect] = useState(true);

  const isLinearTool = useMemo(
    () => ["Doors", "Windows"].includes(selectedCategory) && activeTool === "line_draw",
    [selectedCategory, activeTool]
  );

  // Door/window AI click mode
  const isDoorWindowAI = useMemo(
    () => ["Doors", "Windows"].includes(selectedCategory) && activeTool === "wand",
    [selectedCategory, activeTool]
  );

  // Reset on mode/tool change
  useEffect(() => {
    setPosPoints([]); setNegPoints([]);
    setPreviewMask(null); setPreviewSvg(null);
    setSamMasks([]); setSelectedMaskIdx(null);
    setPolyPoints([]); setMousePos(null);
  }, [mode, selectedCategory, activeTool]);

  // Show auto-detect when new result arrives
  useEffect(() => {
    if (autoDetectResult) setShowAutoDetect(true);
  }, [autoDetectResult]);

  // ── FIX ISSUE 16: Render PDF with correct page number ──
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const pdf = await pdfjsLib.getDocument(`${API}/pdf/${projectId}`).promise;
        const pageNum = (projectData?.page_num || 0) + 1;  // FIX: was hardcoded to 1
        const page = await pdf.getPage(Math.min(pageNum, pdf.numPages));
        const vp = page.getViewport({ scale: RENDER_SCALE });
        const vp1 = page.getViewport({ scale: 1 });
        if (cancelled) return;
        setPageInfo({ width: vp1.width, height: vp1.height });
        const canvas = canvasRef.current;
        canvas.width = vp.width; canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
        const aw = window.innerWidth - 580, ah = window.innerHeight - 40;
        const fit = Math.min(aw / vp.width, ah / vp.height, 1);
        setFitZoom(fit);
        setZoom(fit);  // Start at fit-to-screen
      } catch (err) { console.error("PDF render:", err); }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectId, projectData?.page_num]);

  const screenToNorm = useCallback((e) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / zoom / RENDER_SCALE,
      y: (e.clientY - rect.top) / zoom / RENDER_SCALE,
    };
  }, [zoom]);

  // SAM/hybrid query
  const querySAM = useCallback(async (pos, neg, maskIdx = null) => {
    if (!projectId || pos.length === 0) return;
    setLoading(true);
    try {
      const res = await axios.post(`${API}/project/${projectId}/hybrid-select`, {
        pos_points: pos.map(p => [p.x, p.y]),
        neg_points: neg.length > 0 ? neg.map(p => [p.x, p.y]) : null,
        category: selectedCategory, mask_index: maskIdx,
      });
      setPreviewMask(res.data);
      setPreviewSvg(res.data.svg_groups || []);
      setSamMasks(res.data.all_masks || []);
      if (maskIdx === null) setSelectedMaskIdx(null);
    } catch (err) { console.error("Hybrid-select failed:", err); }
    setLoading(false);
  }, [projectId, selectedCategory]);

  // Zoom bounds: 50% to 200% of fit-to-screen size
  const minZoom = fitZoom * 0.5;
  const maxZoom = fitZoom * 2.0;

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    setZoom(z => {
      const next = z * (e.deltaY < 0 ? 1.1 : 1 / 1.1);
      return Math.max(minZoom, Math.min(maxZoom, next));
    });
  }, [minZoom, maxZoom]);

  // ── Mouse handlers ──
  const handleMouseDown = (e) => {
    if (mode === "segregation") return;
    const pos = screenToNorm(e);
    if (mode === "calibration") {
      setIsDrawing(true); setCalibLine([pos.x, pos.y, pos.x, pos.y]);
    } else if (mode === "drawing" && activeTool === "eraser") {
      setIsDrawing(true); setEraserPath([pos.x, pos.y]);
    } else if (mode === "drawing" && isLinearTool) {
      setIsDrawing(true); setOpeningLine([pos.x, pos.y, pos.x, pos.y]);
    }
  };

  const handleMouseMove = (e) => {
    if (mode === "drawing" && activeTool === "linear" && polyPoints.length > 0) {
      setMousePos(screenToNorm(e));
    }
    if (!isDrawing) return;
    const pos = screenToNorm(e);
    if (mode === "calibration") setCalibLine(p => [p[0], p[1], pos.x, pos.y]);
    else if (activeTool === "eraser") setEraserPath(p => [...p, pos.x, pos.y]);
    else if (isLinearTool) setOpeningLine(p => [p[0], p[1], pos.x, pos.y]);
  };

  const handleMouseUp = async (e) => {
    if (mode === "segregation") return;
    setIsDrawing(false);

    // Calibration
    if (mode === "calibration") {
      const [x0, y0, x1, y1] = calibLine;
      const dist = Math.hypot(x1 - x0, y1 - y0);
      if (dist > 5) {
        const rl = window.prompt("Enter the real-world length (e.g. 5.0):");
        if (rl) {
          try {
            const res = await axios.post(`${API}/project/${projectId}/calibrate`, {
              px_distance: dist, real_length: parseFloat(rl),
            });
            setProjectData(p => ({ ...p, ...res.data }));
            setMode("drawing");
          } catch { alert("Calibration failed"); }
        }
      }
      setCalibLine([]); return;
    }

    if (mode !== "drawing") return;

    // AI Wand click (walls)
    if (activeTool === "wand" && !isLinearTool && !isDoorWindowAI) {
      const pos = screenToNorm(e);
      if (e.shiftKey) {
        const n = [...negPoints, pos]; setNegPoints(n);
        querySAM(posPoints, n, selectedMaskIdx);
      } else {
        const p = [...posPoints, pos]; setPosPoints(p);
        querySAM(p, negPoints, selectedMaskIdx);
      }
      return;
    }

    // AI Click for doors/windows (CAD pattern detection)
    if (isDoorWindowAI) {
      const pos = screenToNorm(e);
      setLoading(true);
      try {
        const endpoint = selectedCategory === "Doors" ? "click-door" : "click-window";
        const res = await axios.post(`${API}/project/${projectId}/${endpoint}`, {
          pos_points: [[pos.x, pos.y]],
          category: selectedCategory,
        });
        if (res.data.found && res.data.svg_groups?.length) {
          const h = selectedCategory === "Doors"
            ? parseFloat(window.prompt("Door height (m):", "2.1")) || 2.1
            : parseFloat(window.prompt("Window height (m):", "1.2")) || 1.2;
          addMask({
            svg_groups: res.data.svg_groups,
            edge_indices: [],
            real_length: res.data.real_length,
            total_length_pts: res.data.total_length_pts,
            category: selectedCategory,
            height: h,
            src: "",
          });
        } else {
          console.log("No door/window found near click. Try Manual Draw.");
        }
      } catch (err) { console.error("Door/window click failed:", err); }
      setLoading(false);
      return;
    }

    // Opening line tool
    if (isLinearTool && openingLine.length === 4) {
      const [x0, y0, x1, y1] = openingLine;
      if (Math.hypot(x1 - x0, y1 - y0) > 3) {
        try {
          const res = await axios.post(`${API}/project/${projectId}/draw-opening`, {
            p1: [x0, y0], p2: [x1, y1], category: selectedCategory,
          });
          const h = parseFloat(window.prompt("Height (m):", "2.1")) || 0;
          addMask({
            ...res.data, height: h,
            src: res.data.mask_image ? `data:image/png;base64,${res.data.mask_image}` : "",
          });
        } catch (err) { console.error(err); }
      }
      setOpeningLine([]); return;
    }

    // ── FIX BUG 2: Eraser actually calls the backend ──
    if (activeTool === "eraser" && eraserPath.length >= 4) {
      // Find masks with edge_indices to erase from (hybrid-select masks)
      let erased = false;
      for (let i = masks.length - 1; i >= 0; i--) {
        const mask = masks[i];
        if (mask.category !== selectedCategory) continue;
        
        // Only erase from masks that have edge_indices (vector-based)
        if (mask.edge_indices && mask.edge_indices.length > 0) {
          try {
            const res = await axios.post(`${API}/project/${projectId}/erase`, {
              mask_index: i,
              eraser_points: eraserPath,
              radius: 8.0,
            });
            if (res.data.edge_indices) {
              updateMask(i, {
                svg_groups: res.data.svg_groups || [],
                edge_indices: res.data.edge_indices,
                edge_count: res.data.edge_count,
                real_length: res.data.real_length,
                total_length_pts: res.data.total_length_pts,
              });
              erased = true;
            }
          } catch (err) { console.error("Erase failed:", err); }
        }
        // For raster masks (src/mask_b64), we can't partially erase — skip
      }
      
      if (!erased) {
        console.log("No erasable masks found for category:", selectedCategory);
      }
      setEraserPath([]);
    }
  };

  // Manual Polyline: single click
  const handleClick = (e) => {
    if (mode !== "drawing" || activeTool !== "linear") return;
    setPolyPoints(p => [...p, screenToNorm(e)]);
  };

  // Manual Polyline: double-click finishes
  const handleDoubleClick = (e) => {
    if (mode !== "drawing" || activeTool !== "linear") return;
    e.preventDefault(); finishPolyline();
  };

  // Keyboard
  useEffect(() => {
    const h = (e) => {
      if (activeTool !== "linear") return;
      if (e.key === "Enter" && polyPoints.length >= 2) finishPolyline();
      else if (e.key === "Escape") { setPolyPoints([]); setMousePos(null); }
      else if (e.key === "z" && (e.ctrlKey || e.metaKey) && polyPoints.length > 0) {
        e.preventDefault(); setPolyPoints(p => p.slice(0, -1));
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [activeTool, polyPoints]);

  const finishPolyline = () => {
    if (polyPoints.length < 2) return;
    let totalPx = 0;
    for (let i = 0; i < polyPoints.length - 1; i++)
      totalPx += Math.hypot(polyPoints[i+1].x - polyPoints[i].x, polyPoints[i+1].y - polyPoints[i].y);
    const sf = projectData?.scale_factor;
    const rl = sf ? totalPx / sf : null;
    const h = parseFloat(window.prompt(
      `Length: ${rl ? rl.toFixed(2) + " m" : totalPx.toFixed(0) + " pts"}\n${selectedCategory === "Walls" ? "Wall" : selectedCategory.slice(0, -1)} height (m):`,
      selectedCategory === "Doors" ? "2.1" : selectedCategory === "Windows" ? "1.2" : (projectData?.wall_height || "2.4")
    )) || 0;

    // Generate raster mask_b64 so split rooms can use this polyline
    const canvas = canvasRef.current;
    let maskB64 = "";
    if (canvas && polyPoints.length >= 2) {
      const tmpCanvas = document.createElement("canvas");
      tmpCanvas.width = canvas.width;
      tmpCanvas.height = canvas.height;
      const ctx = tmpCanvas.getContext("2d");
      ctx.clearRect(0, 0, tmpCanvas.width, tmpCanvas.height);

      // Draw polyline as thick semi-transparent stroke
      const catColors = { Walls: "rgba(29,78,216,0.63)", Doors: "rgba(21,128,61,0.63)", Windows: "rgba(194,65,12,0.63)" };
      ctx.strokeStyle = catColors[selectedCategory] || "rgba(100,100,255,0.63)";
      ctx.lineWidth = 12;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      const scale = canvas.width / (pageInfo?.width || 1);
      polyPoints.forEach((p, i) => {
        const px = p.x * scale;
        const py = p.y * scale;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();

      // Export as base64 PNG
      const dataUrl = tmpCanvas.toDataURL("image/png");
      maskB64 = dataUrl.replace("data:image/png;base64,", "");
    }

    const pts = polyPoints.map(p => `${p.x},${p.y}`).join(" ");
    addMask({
      category: selectedCategory,
      real_length: rl,
      height: h,
      polyline_points: pts,
      mask_b64: maskB64,
      manual: true,
      src: maskB64 ? `data:image/png;base64,${maskB64}` : "",
      svg_groups: [], edge_indices: [],
    });
    setPolyPoints([]); setMousePos(null);
  };

  const confirmSelection = () => {
    if (!previewMask) return;
    addMask({
      svg_groups: previewSvg || [],
      edge_indices: previewMask.edge_indices || [],
      edge_count: previewMask.edge_count || 0,
      total_length_pts: previewMask.total_length_pts || 0,
      real_length: previewMask.real_length,
      category: selectedCategory,
      height: 0,
      mask_b64: previewMask.mask_b64 || "",
      src: previewMask.mask_b64 ? `data:image/png;base64,${previewMask.mask_b64}` : "",
    });
    setPosPoints([]); setNegPoints([]);
    setPreviewMask(null); setPreviewSvg(null);
    setSamMasks([]); setSelectedMaskIdx(null);
  };

  const cancelSelection = () => {
    setPosPoints([]); setNegPoints([]);
    setPreviewMask(null); setPreviewSvg(null);
    setSamMasks([]); setSelectedMaskIdx(null);
  };

  const handleContextMenu = (e) => e.preventDefault();

  const pw = pageInfo?.width || 1;
  const ph = pageInfo?.height || 1;
  const canvasW = (pageInfo?.width || 800) * RENDER_SCALE;
  const canvasH = (pageInfo?.height || 600) * RENDER_SCALE;

  if (!projectId) return null;

  const polyLength = () => {
    if (polyPoints.length < 2) return null;
    let t = 0;
    for (let i = 0; i < polyPoints.length - 1; i++)
      t += Math.hypot(polyPoints[i+1].x - polyPoints[i].x, polyPoints[i+1].y - polyPoints[i].y);
    const sf = projectData?.scale_factor;
    return sf ? (t / sf).toFixed(2) + " m" : t.toFixed(0) + " pts";
  };

  return (
    <div ref={containerRef} className="canvas-scroll-container" onWheel={handleWheel}>
      <div className="canvas-sizer" style={{ width: canvasW * zoom, height: canvasH * zoom }}>
        <div className="canvas-zoom-wrapper"
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: "0 0",
            width: canvasW,
            height: canvasH,
          }}>
        <canvas ref={canvasRef} style={{ display: "block" }}
          onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}
          onClick={handleClick} onDoubleClick={handleDoubleClick} onContextMenu={handleContextMenu} />

        <svg className="svg-overlay" viewBox={`0 0 ${pw} ${ph}`} preserveAspectRatio="none"
          style={{ width: canvasW, height: canvasH }}>

          {/* ── Confirmed masks: polylines ── */}
          {mode !== "segregation" && masks.map((mask, mi) => {
            if (!mask.polyline_points) return null;
            const c = COLORS[mask.category] || COLORS.Walls;
            return (
              <polyline key={`poly-${mi}`} points={mask.polyline_points}
                stroke={c.stroke} strokeWidth={4} strokeLinecap="round"
                strokeLinejoin="round" fill="none" opacity={0.9} />
            );
          })}

          {/* ── Confirmed masks: SVG groups (hybrid-select) ── */}
          {mode !== "segregation" && masks.map((mask, mi) => {
            if (!mask.svg_groups?.length) return null;
            const c = COLORS[mask.category] || COLORS.Walls;
            return (
              <g key={`svg-${mi}`}>
                {mask.svg_groups.map((g, gi) => (
                  <path key={`glow-${gi}`} d={g.d}
                    stroke={c.glow} strokeWidth={Math.max(g.strokeWidth * 8, 10)}
                    strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.6} />
                ))}
                {mask.svg_groups.map((g, gi) => (
                  <path key={`core-${gi}`} d={g.d}
                    stroke={c.stroke} strokeWidth={Math.max(g.strokeWidth * 2.5, 3)}
                    strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.9} />
                ))}
              </g>
            );
          })}

          {/* ── Confirmed masks: raster images (magic-wand, auto-detect) ── */}
          {mode !== "segregation" && masks.map((mask, mi) => {
            if (mask.polyline_points || mask.svg_groups?.length) return null;
            const imgSrc = mask.mask_b64
              ? `data:image/png;base64,${mask.mask_b64}`
              : mask.src;
            if (!imgSrc) return null;
            return (
              <image key={`raster-${mi}`} href={imgSrc}
                x="0" y="0" width={pw} height={ph}
                preserveAspectRatio="none" opacity={0.5} />
            );
          })}

          {/* ── AI Wand preview ── */}
          {mode === "drawing" && activeTool === "wand" && !isLinearTool && previewMask?.mask_b64 && (
            <image href={`data:image/png;base64,${previewMask.mask_b64}`}
              x="0" y="0" width={pw} height={ph} preserveAspectRatio="none" opacity={0.45} />
          )}
          {mode === "drawing" && activeTool === "wand" && !isLinearTool && previewSvg && (
            <g opacity={0.85}>
              {previewSvg.map((g, gi) => (
                <path key={`pv-${gi}`} d={g.d}
                  stroke={COLORS[selectedCategory]?.stroke}
                  strokeWidth={Math.max(g.strokeWidth * 2.5, 3)}
                  strokeLinecap="round" strokeLinejoin="round" fill="none"
                  strokeDasharray="8 4" />
              ))}
            </g>
          )}

          {/* ── AI point markers ── */}
          {posPoints.map((p, i) => (
            <circle key={`pos-${i}`} cx={p.x} cy={p.y} r={6 / zoom}
              fill="#22c55e" stroke="white" strokeWidth={1.5 / zoom} />
          ))}
          {negPoints.map((p, i) => (
            <circle key={`neg-${i}`} cx={p.x} cy={p.y} r={6 / zoom}
              fill="#ef4444" stroke="white" strokeWidth={1.5 / zoom} />
          ))}

          {/* ── Manual Polyline: completed segments ── */}
          {polyPoints.length >= 2 && (
            <polyline points={polyPoints.map(p => `${p.x},${p.y}`).join(" ")}
              stroke={COLORS[selectedCategory]?.stroke || "#1d4ed8"}
              strokeWidth={3 / zoom} strokeLinecap="round" strokeLinejoin="round"
              fill="none" opacity={0.9} />
          )}
          {/* Rubber band */}
          {polyPoints.length > 0 && mousePos && (
            <line x1={polyPoints[polyPoints.length - 1].x} y1={polyPoints[polyPoints.length - 1].y}
              x2={mousePos.x} y2={mousePos.y}
              stroke={COLORS[selectedCategory]?.stroke}
              strokeWidth={2 / zoom} strokeDasharray={`${6/zoom} ${4/zoom}`} opacity={0.7} />
          )}
          {/* Vertex dots */}
          {polyPoints.map((p, i) => (
            <circle key={`vx-${i}`} cx={p.x} cy={p.y} r={4 / zoom}
              fill="white" stroke={COLORS[selectedCategory]?.stroke}
              strokeWidth={2 / zoom} />
          ))}
          {/* Segment lengths */}
          {polyPoints.length >= 2 && polyPoints.map((p, i) => {
            if (i === 0) return null;
            const prev = polyPoints[i - 1];
            const d = Math.hypot(p.x - prev.x, p.y - prev.y);
            const sf = projectData?.scale_factor;
            const label = sf ? (d / sf).toFixed(2) + "m" : d.toFixed(0);
            const mx = (p.x + prev.x) / 2, my = (p.y + prev.y) / 2;
            return (
              <g key={`len-${i}`}>
                <rect x={mx - 22/zoom} y={my - 9/zoom} width={44/zoom} height={16/zoom}
                  rx={3/zoom} fill="rgba(0,0,0,0.75)" />
                <text x={mx} y={my + 3/zoom} textAnchor="middle"
                  fontSize={10/zoom} fill="white" fontWeight="bold">{label}</text>
              </g>
            );
          })}

          {/* ── FIX ISSUE 6: Auto-detect overlays (dismissible) ── */}
          {showAutoDetect && autoDetectResult?.walls?.mask_b64 && (
            <image href={`data:image/png;base64,${autoDetectResult.walls.mask_b64}`}
              x="0" y="0" width={pw} height={ph} preserveAspectRatio="none" opacity={0.4} />
          )}
          {showAutoDetect && autoDetectResult?.doors?.mask_b64 && (
            <image href={`data:image/png;base64,${autoDetectResult.doors.mask_b64}`}
              x="0" y="0" width={pw} height={ph} preserveAspectRatio="none" opacity={0.4} />
          )}
          {showAutoDetect && autoDetectResult?.windows?.mask_b64 && (
            <image href={`data:image/png;base64,${autoDetectResult.windows.mask_b64}`}
              x="0" y="0" width={pw} height={ph} preserveAspectRatio="none" opacity={0.4} />
          )}

          {/* ── Room overlays (segregation mode) ── */}
          {mode === "segregation" && rooms.map((room) => {
            const cx = room.center?.x || 0;
            const cy = room.center?.y || 0;
            const fs = 12 / zoom;
            const fsSmall = 9 / zoom;
            const lineH = fs * 1.4;
            const displayName = room.name || room.id;
            const wallInfo = room.wall_count ? `${room.wall_count} walls` : "";
            const areaInfo = `${room.real_area?.toFixed(1) || room.pixel_area} m²`;
            const pillW = Math.max(displayName.length, areaInfo.length) * fs * 0.65 + 16 / zoom;
            const pillH = lineH * 3 + 8 / zoom;
            return (
              <g key={room.id}>
                <image
                  href={room.src?.startsWith("data:") ? room.src : `data:image/png;base64,${room.src}`}
                  x="0" y="0" width={pw} height={ph} preserveAspectRatio="none" />
                <rect x={cx - pillW / 2} y={cy - pillH / 2}
                  width={pillW} height={pillH}
                  rx={4 / zoom} fill="rgba(0,0,0,0.72)" />
                <text x={cx} y={cy - lineH * 0.8} textAnchor="middle"
                  dominantBaseline="middle" fontSize={fs} fontWeight="bold"
                  fill="white">{displayName}</text>
                <text x={cx} y={cy + lineH * 0.05} textAnchor="middle"
                  dominantBaseline="middle" fontSize={fsSmall}
                  fill="rgba(255,255,255,0.7)">{room.id}{wallInfo ? ` · ${wallInfo}` : ""}</text>
                <text x={cx} y={cy + lineH * 0.95} textAnchor="middle"
                  dominantBaseline="middle" fontSize={fs} fontWeight="bold"
                  fill="#60a5fa">{areaInfo}</text>
              </g>
            );
          })}

          {/* ── Guides ── */}
          {mode === "calibration" && calibLine.length === 4 && (
            <line x1={calibLine[0]} y1={calibLine[1]} x2={calibLine[2]} y2={calibLine[3]}
              stroke="#ff00ff" strokeWidth={2 / zoom} strokeDasharray={`${6/zoom} ${4/zoom}`} />
          )}
          {isDrawing && activeTool === "eraser" && eraserPath.length >= 4 && (
            <polyline
              points={Array.from({ length: Math.floor(eraserPath.length / 2) }, (_, i) =>
                `${eraserPath[i*2]},${eraserPath[i*2+1]}`).join(" ")}
              stroke="rgba(239,68,68,0.7)" strokeWidth={12 / zoom}
              strokeLinecap="round" strokeLinejoin="round" fill="none" />
          )}
          {isDrawing && isLinearTool && openingLine.length === 4 && (
            <line x1={openingLine[0]} y1={openingLine[1]} x2={openingLine[2]} y2={openingLine[3]}
              stroke={selectedCategory === "Doors" ? "#16a34a" : "#ea580c"}
              strokeWidth={3 / zoom} strokeDasharray={`${8/zoom} ${4/zoom}`} />
          )}
        </svg>

        {loading && <div className="loading-overlay"><div className="loading-spinner" /></div>}
      </div>{/* zoom-wrapper */}
      </div>{/* sizer */}

      {/* ── Zoom slider bar ── */}
      <div className="zoom-bar">
        <button className="zoom-btn" onClick={() => setZoom(z => Math.max(minZoom, z / 1.25))}>−</button>
        <input
          type="range"
          className="zoom-slider"
          min={minZoom * 100}
          max={maxZoom * 100}
          value={zoom * 100}
          onChange={(e) => setZoom(parseFloat(e.target.value) / 100)}
          step={1}
        />
        <button className="zoom-btn" onClick={() => setZoom(z => Math.min(maxZoom, z * 1.25))}>+</button>
        <span className="zoom-label">{Math.round(zoom / fitZoom * 100)}%</span>
        <button className="zoom-fit-btn" onClick={() => setZoom(fitZoom)}>Fit</button>
      </div>
      {autoDetectResult && showAutoDetect && mode !== "segregation" && (
        <div className="auto-detect-bar">
          <span>AI Detection Active</span>
          <button onClick={() => setShowAutoDetect(false)}>Hide Overlay</button>
          <button onClick={() => { setShowAutoDetect(false); if (setAutoDetectResult) setAutoDetectResult(null); }}>
            Clear Detection
          </button>
        </div>
      )}
      {autoDetectResult && !showAutoDetect && mode !== "segregation" && (
        <div className="auto-detect-bar faded">
          <span>AI Detection Hidden</span>
          <button onClick={() => setShowAutoDetect(true)}>Show Overlay</button>
        </div>
      )}

      {/* Polyline control bar */}
      {mode === "drawing" && activeTool === "linear" && polyPoints.length > 0 && (
        <div className="sam-controls"><div className="sam-controls-inner">
          <span className="sam-hint">
            {polyPoints.length} pts · Total: {polyLength() || "—"} · Enter=finish · Esc=cancel · Ctrl+Z=undo
          </span>
          <button className="sam-confirm-btn" onClick={finishPolyline}
            disabled={polyPoints.length < 2}>✓ Finish</button>
          <button className="sam-cancel-btn"
            onClick={() => { setPolyPoints([]); setMousePos(null); }}>✕ Cancel</button>
        </div></div>
      )}

      {/* AI Wand control bar */}
      {mode === "drawing" && activeTool === "wand" && !isLinearTool && posPoints.length > 0 && (
        <div className="sam-controls"><div className="sam-controls-inner">
          <span className="sam-hint">
            Click=more · Shift+click=exclude
            {previewMask && ` · Score: ${(previewMask.sam_score * 100).toFixed(0)}%`}
          </span>
          <button className="sam-confirm-btn" onClick={confirmSelection}
            disabled={!previewSvg?.length && !previewMask?.mask_b64}>✓ Confirm</button>
          <button className="sam-cancel-btn" onClick={cancelSelection}>✕ Cancel</button>
        </div></div>
      )}
    </div>
  );
};

export default CanvasBoard;