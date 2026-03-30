import React, { useState } from "react";
import {
  Upload, Ruler, Eraser, Undo2, Trash2,
  BoxSelect, DoorOpen, LayoutTemplate, Split,
  MousePointer, PenTool, Sparkles, Loader2,
} from "lucide-react";
import axios from "axios";

const API = process.env.REACT_APP_API_URL || "http://localhost:8000";

const Sidebar = ({
  onUpload, mode, setMode,
  activeTool, setActiveTool,
  selectedCategory, setSelectedCategory,
  handleUndo, handleClear, hasProject,
  projectData, setProjectData,
  onSplitRooms, projectId,
  onAutoDetectComplete,
}) => {
  const [autoDetecting, setAutoDetecting] = useState(false);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.type === "application/pdf") {
      const page = window.prompt("Page number (default: 1):", "1");
      onUpload(file, (parseInt(page) || 1) - 1);
    } else alert("Please upload a PDF file.");
  };

  const selectCat = (cat) => {
    setMode("drawing");
    setSelectedCategory(cat);
  };

  const handleHeightChange = (e) => {
    setProjectData((prev) => ({
      ...prev,
      wall_height: parseFloat(e.target.value) || 0,
    }));
  };

  // ── Auto AI Detection ──
  const handleAutoDetect = async () => {
    if (!projectId || autoDetecting) return;
    setAutoDetecting(true);
    try {
      const res = await axios.post(`${API}/project/${projectId}/auto-detect`);
      if (onAutoDetectComplete) onAutoDetectComplete(res.data);
      alert("Auto-detection complete! Walls, doors, windows, and rooms detected.");
    } catch (err) {
      console.error("Auto-detect failed:", err);
      const msg = err.response?.data?.detail || err.message;
      alert(`Auto-detection failed: ${msg}\n\nMake sure CubiCasa5K is installed.`);
    }
    setAutoDetecting(false);
  };

  return (
    <aside className="left-sidebar">
      <div className="brand">
        <h1>BygAI.dk</h1>
        <span className="brand-sub">Precision Takeoff Engine</span>
      </div>

      <div className="scroll-content">
        {/* Upload */}
        <div>
          <label className="section-label">Project File</label>
          <label className="upload-btn">
            <Upload size={18} />
            <span>Upload PDF Plan</span>
            <input type="file" accept=".pdf" hidden onChange={handleFileChange} />
          </label>
        </div>

        {/* Calibration panel */}
        {hasProject && mode === "calibration" && (
          <div>
            <label className="section-label">Calibration</label>
            <div className="vertical-stack">
              <label className="field-label">Wall Height (m)</label>
              <input
                type="number" step="0.1" placeholder="e.g. 2.4"
                value={projectData?.wall_height || ""}
                onChange={handleHeightChange}
                className="height-input"
              />
              <p className="hint-text">Draw a line on the plan, enter its real length.</p>
            </div>
          </div>
        )}

        {/* Selection Method toggle — all categories */}
        {hasProject && mode === "drawing" && (
          <div>
            <label className="section-label">Selection Method</label>
            <div className="tool-toggle">
              <button
                className={`tool-toggle-btn ${activeTool === "wand" ? "active" : ""}`}
                onClick={() => setActiveTool("wand")}
                title={selectedCategory === "Walls"
                  ? "AI-assisted wall selection"
                  : `AI-assisted ${selectedCategory.toLowerCase()} detection (CAD pattern)`}
              >
                <MousePointer size={14} /> AI Click
              </button>
              <button
                className={`tool-toggle-btn ${activeTool === "linear" ? "active" : ""}`}
                onClick={() => setActiveTool("linear")}
                title="Manual point-to-point (like Bluebeam)"
              >
                <PenTool size={14} /> Manual Draw
              </button>
            </div>
            <p className="hint-text" style={{ marginTop: 6 }}>
              {activeTool === "wand"
                ? selectedCategory === "Walls"
                  ? "Click wall → AI selects segment. Shift+click to exclude."
                  : `Click on ${selectedCategory.toLowerCase()} → AI detects ${selectedCategory === "Doors" ? "arc swing" : "parallel lines"}.`
                : `Click point-to-point along ${selectedCategory.toLowerCase()}. Double-click or Enter to finish.`}
            </p>
          </div>
        )}

        {/* Categories + Tools */}
        <div className={!hasProject ? "disabled" : ""}>
          <label className="section-label">Tools & Categories</label>
          <div className="vertical-stack">
            <button
              className={`main-btn ${mode === "calibration" ? "active" : ""}`}
              onClick={() => setMode("calibration")}
            >
              <Ruler size={18} /> Calibrate Scale
            </button>

            <button
              className={`main-btn ${selectedCategory === "Walls" && mode === "drawing" ? "active-wall" : ""}`}
              onClick={() => selectCat("Walls")}
            >
              <BoxSelect size={18} /> Highlight Walls
            </button>

            <button
              className={`main-btn ${selectedCategory === "Doors" && mode === "drawing" ? "active-door" : ""}`}
              onClick={() => selectCat("Doors")}
            >
              <DoorOpen size={18} /> Highlight Doors
            </button>

            <button
              className={`main-btn ${selectedCategory === "Windows" && mode === "drawing" ? "active-window" : ""}`}
              onClick={() => selectCat("Windows")}
            >
              <LayoutTemplate size={18} /> Highlight Windows
            </button>

            {/* ── AUTO AI DETECTION ── */}
            <button
              className="main-btn auto-ai-btn"
              onClick={handleAutoDetect}
              disabled={!hasProject || autoDetecting}
              title="Auto-detect walls, doors, windows & rooms using CubiCasa5K AI"
            >
              {autoDetecting ? <Loader2 size={18} className="spin" /> : <Sparkles size={18} />}
              {autoDetecting ? "Detecting..." : "Auto AI Detection"}
            </button>

            {/* ── SPLIT ROOMS ── */}
            <button
              className={`main-btn ${mode === "segregation" ? "active" : ""}`}
              onClick={onSplitRooms}
              style={{ marginTop: 12 }}
            >
              <Split size={18} />
              {mode === "segregation" ? "Back to Drawing" : "Split Rooms"}
            </button>
          </div>
        </div>

        {/* Actions */}
        {mode !== "segregation" && (
          <div className={`mt-auto ${!hasProject ? "disabled" : ""}`}>
            <label className="section-label">Actions</label>
            <div className="tools-row">
              <button
                className={`icon-btn ${activeTool === "eraser" ? "active" : ""}`}
                onClick={() => { setMode("drawing"); setActiveTool("eraser"); }}
                title="Eraser"
              >
                <Eraser size={20} />
              </button>
              <button className="icon-btn" onClick={handleUndo} title="Undo Last">
                <Undo2 size={20} />
              </button>
              <button className="icon-btn danger" onClick={handleClear} title="Clear All">
                <Trash2 size={20} />
              </button>
            </div>
          </div>
        )}

        {/* Layers */}
        {hasProject && projectData?.has_layers && (
          <div>
            <label className="section-label">PDF Layers</label>
            <div style={{ fontSize: 12, color: "#64748b" }}>
              {projectData.layer_names?.map((n) => (
                <div key={n} style={{ padding: "2px 0" }}>▸ {n}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;