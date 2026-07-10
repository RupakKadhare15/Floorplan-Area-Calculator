import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import Sidebar from "./components/Sidebar";
import CanvasBoard from "./components/CanvasBoard";
import { AreaChart, CheckCircle2, LayoutDashboard, Download, Pencil, Check, X } from "lucide-react";
import "./App.css";

const API = process.env.REACT_APP_API_URL || "http://localhost:8000";

function App() {
  const [projectId, setProjectId] = useState(null);
  const [projectData, setProjectData] = useState(null);
  const [mode, setMode] = useState("calibration");
  const [activeTool, setActiveTool] = useState("wand");
  const [selectedCategory, setSelectedCategory] = useState("Walls");
  const [masks, setMasks] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [autoDetectResult, setAutoDetectResult] = useState(null);

  // Room rename state
  const [editingRoomId, setEditingRoomId] = useState(null);
  const [editingRoomName, setEditingRoomName] = useState("");

  /* ─── upload ─────────────────────────────────────────────── */
  const handleFileUpload = async (file, pageIndex = 0) => {
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await axios.post(`${API}/upload?pdf_page=${pageIndex}`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setProjectId(res.data._id);
      setProjectData(res.data);
      setMasks(res.data.masks || []);
      setRooms([]);
      setMode("calibration");
    } catch (err) {
      console.error("Upload failed", err);
      alert("Upload failed. Check console for details.");
    }
  };

  /* ─── auto-save masks ────────────────────────────────────── */
  useEffect(() => {
    if (!projectId) return;
    const t = setTimeout(async () => {
      try {
        await axios.put(`${API}/project/${projectId}/state`, {
          masks,
          wall_height: projectData?.wall_height,
        });
      } catch (err) {
        console.error("Auto-save failed", err);
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [masks, projectData?.wall_height, projectId]);

  /* ─── add a new selection from backend ───────────────────── */
  const addMask = useCallback((maskData) => {
    setMasks((prev) => [...prev, maskData]);
  }, []);

  /* ─── update a mask in-place (for eraser) ────────────────── */
  const updateMask = useCallback((index, newData) => {
    setMasks((prev) => prev.map((m, i) => (i === index ? { ...m, ...newData } : m)));
  }, []);

  /* ─── undo / clear ───────────────────────────────────────── */
  const handleUndo = () => setMasks((prev) => prev.slice(0, -1));
  const handleClear = () => { setMasks([]); setRooms([]); setAutoDetectResult(null);};

  /* ─── room segregation ───────────────────────────────────── */
  const handleSplitRooms = async () => {
    if (!projectId) return;
    if (mode === "segregation") { setMode("drawing"); return; }
    try {
      await axios.put(`${API}/project/${projectId}/state`, {
        masks,
        wall_height: projectData?.wall_height,
      });
      const res = await axios.post(`${API}/project/${projectId}/segregate-rooms`);
      setRooms(res.data.rooms);
      setMode("segregation");
    } catch (err) {
      console.error("Segregation failed", err);
    }
  };

  /* ─── measurements helpers ───────────────────────────────── */

  /* ─── room rename ────────────────────────────────────────── */
  const startRenameRoom = (room) => {
    setEditingRoomId(room.id);
    setEditingRoomName(room.name || room.id);
  };

  const confirmRenameRoom = async () => {
    if (!editingRoomId || !editingRoomName.trim()) return;
    try {
      await axios.put(`${API}/project/${projectId}/rename-room`, {
        room_id: editingRoomId,
        new_name: editingRoomName.trim(),
      });
      setRooms((prev) =>
        prev.map((r) =>
          r.id === editingRoomId ? { ...r, name: editingRoomName.trim() } : r
        )
      );
    } catch (err) {
      console.error("Rename failed", err);
    }
    setEditingRoomId(null);
    setEditingRoomName("");
  };

  const cancelRenameRoom = () => {
    setEditingRoomId(null);
    setEditingRoomName("");
  };

  const handleRenameKeyDown = (e) => {
    if (e.key === "Enter") confirmRenameRoom();
    else if (e.key === "Escape") cancelRenameRoom();
  };
  const getArea = (cat) => {
    const catMasks = masks.filter((m) => m.category === cat);
    const wh = parseFloat(projectData?.wall_height) || 0;
    if (cat === "Walls") {
      const base = catMasks.reduce((s, m) => s + (m.real_length || 0) * wh, 0);
      const openings = masks
        .filter((m) => ["Doors", "Windows"].includes(m.category))
        .reduce((s, m) => s + (m.real_length || 0) * Math.max(0, wh - (m.height || 0)), 0);
      return (base + openings).toFixed(2);
    }
    return catMasks.reduce((s, m) => s + (m.real_length || 0) * (m.height || 0), 0).toFixed(2);
  };

  const getCeilingArea = () => {
    if (!rooms.length) return "0.00";
    return rooms.reduce((s, r) => s + (r.real_area || 0), 0).toFixed(2);
  };

  const getTotalNetWallArea = () => {
    const wh = parseFloat(projectData?.wall_height) || 0;
    const gross = rooms.reduce((s, r) => s + (r.real_perimeter || 0) * wh, 0);
    const openings = masks
      .filter((m) => ["Doors", "Windows"].includes(m.category))
      .reduce((s, m) => s + (m.real_length || 0) * (m.height || 0), 0);
    return (gross - openings).toFixed(2);
  };

  const getNetRoomWallArea = (room) => {
    const wh = parseFloat(projectData?.wall_height) || 0;
    const gross = (room.real_perimeter || 0) * wh;
    const totalOpenings = masks
      .filter((m) => ["Doors", "Windows"].includes(m.category))
      .reduce((s, m) => s + (m.real_length || 0) * (m.height || 0), 0);
    return (gross - totalOpenings / (rooms.length || 1)).toFixed(2);
  };

  const getCount = (cat) => {
    return masks
      .filter((m) => m.category === cat)
      .reduce((sum, m) => sum + (m.count || 1), 0);
  };

  /* ─── export ─────────────────────────────────────────────── */
  const handleExport = async () => {
    if (!rooms.length) { alert("Please segregate rooms first."); return; }
    const roomRows = rooms.map((r) => ({
      "Room No": r.id,
      "Room Name": r.name || r.id,
      "Wall Count": r.wall_count || "—",
      "Inner Wall Area (m²)": parseFloat(getNetRoomWallArea(r)),
      "Ceiling Area (m²)": parseFloat(r.real_area ? r.real_area.toFixed(2) : 0),
      "Inner Perimeter (m)": parseFloat(r.real_perimeter ? r.real_perimeter.toFixed(2) : 0),
    }));
    const summaryData = {
      "Total Wall Area (m²)": parseFloat(getTotalNetWallArea()),
      "Total Ceiling Area (m²)": parseFloat(getCeilingArea()),
      "Total Door Area (m²)": parseFloat(getArea("Doors")),
      "Total Window Area (m²)": parseFloat(getArea("Windows")),
      "Total Rooms": rooms.length,
      "Total Doors": getCount("Doors"),
      "Total Windows": getCount("Windows"),
    };
    try {
      const res = await axios.post(`${API}/project/export`,
        { rooms: roomRows, summary: summaryData },
        { responseType: "blob" }
      );
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = "measurements.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      console.error("Export failed", err);
    }
  };

  /* ─── auto-detect complete ────────────────────────────────── */
  const handleAutoDetectComplete = useCallback((data) => {
    setAutoDetectResult(data);
    
    // 1. Add Wall Mask
    if (data.walls?.real_length) {
      addMask({
        category: "Walls",
        real_length: data.walls.real_length,
        mask_b64: data.walls.mask_b64,
        src: `data:image/png;base64,${data.walls.mask_b64}`,
        height: 0,
        auto_detected: true,
        svg_groups: [],
        edge_indices: [],
      });
    }

    // 2. Add Door Mask
    if (data.doors?.count > 0) {
      addMask({
        category: "Doors",
        count: data.doors.count,
        real_length: 0.9 * data.doors.count, // Standard door width estimate
        mask_b64: data.doors.mask_b64,
        src: `data:image/png;base64,${data.doors.mask_b64}`,
        height: 2.1, // Standard door height
        auto_detected: true,
      });
    }

    // 3. Add Window Mask
    if (data.windows?.count > 0) {
      addMask({
        category: "Windows",
        count: data.windows.count,
        real_length: 1.2 * data.windows.count, // Standard window width estimate
        mask_b64: data.windows.mask_b64,
        src: `data:image/png;base64,${data.windows.mask_b64}`,
        height: 1.2, // Standard window height
        auto_detected: true,
      });
    }

    // 4. Add rooms
    if (data.rooms?.length) {
      setRooms(data.rooms.map((r) => ({
        ...r,
        src: r.mask_b64 ? `data:image/png;base64,${r.mask_b64}` : "",
      })));
    }
    
    setMode("drawing");
  }, [addMask, setMode]);

  /* ─── render ─────────────────────────────────────────────── */
  return (
    <div className="app-container">
      <Sidebar
        onUpload={handleFileUpload}
        mode={mode}
        setMode={setMode}
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        selectedCategory={selectedCategory}
        setSelectedCategory={setSelectedCategory}
        handleUndo={handleUndo}
        handleClear={handleClear}
        hasProject={!!projectId}
        projectData={projectData}
        setProjectData={setProjectData}
        onSplitRooms={handleSplitRooms}
        projectId={projectId}
        onAutoDetectComplete={handleAutoDetectComplete}
      />

      <main className="main-canvas-area">
        {projectData ? (
          <CanvasBoard
            projectId={projectId}
            projectData={projectData}
            setProjectData={setProjectData}
            mode={mode}
            setMode={setMode}
            activeTool={activeTool}
            setActiveTool={setActiveTool}
            selectedCategory={selectedCategory}
            masks={masks}
            addMask={addMask}
            updateMask={updateMask}
            rooms={rooms}
            autoDetectResult={autoDetectResult}
            setAutoDetectResult={setAutoDetectResult}
          />
        ) : (
          <div className="empty-state"><p>Upload a floor plan PDF to begin</p></div>
        )}
      </main>

      <aside className="right-panel">
        <div className="panel-header">
          <h2>
            {mode === "segregation" ? <LayoutDashboard size={18} /> : <AreaChart size={18} />}{" "}
            {mode === "segregation" ? " Room List" : " Area Report"}
          </h2>
          <button onClick={handleExport} className="export-btn" title="Export to Excel">
            <Download size={16} /> Export
          </button>
        </div>

        <div className="stats-content">
          {mode === "segregation" ? (
            <div className="flex flex-col gap-3">
              <div className="stat-card" style={{ background: "#eff6ff", border: "1px solid #dbeafe" }}>
                <div className="stat-title">Total Net Wall Area</div>
                <div className="stat-value">{getTotalNetWallArea()} m²</div>
              </div>
              {rooms.map((room) => (
                <div key={room.id} className="room-card">
                  <div className="room-card-header">
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                      <div className="room-color-dot" style={{ background: room.color }} />
                      {editingRoomId === room.id ? (
                        <div className="room-rename-row">
                          <input className="room-rename-input" value={editingRoomName}
                            onChange={(e) => setEditingRoomName(e.target.value)}
                            onKeyDown={handleRenameKeyDown} autoFocus />
                          <button className="room-rename-action confirm"
                            onClick={confirmRenameRoom} title="Save"><Check size={14} /></button>
                          <button className="room-rename-action cancel"
                            onClick={cancelRenameRoom} title="Cancel"><X size={14} /></button>
                        </div>
                      ) : (
                        <div className="room-name-row">
                          <span className="room-name">{room.name || room.id}</span>
                          <span className="room-id-badge">{room.id}</span>
                          <button className="room-rename-btn"
                            onClick={() => startRenameRoom(room)} title="Rename room">
                            <Pencil size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="room-card-body">
                    <div className="room-metric-row">
                      <span className="room-metric-label">Walls</span>
                      <span className="room-metric-value">{room.wall_count || "—"} sides</span>
                    </div>
                    <div className="room-metric-row">
                      <span className="room-metric-label">Wall Area</span>
                      <span className="room-metric-value">{getNetRoomWallArea(room)} m²</span>
                    </div>
                    <div className="room-metric-row">
                      <span className="room-metric-label">Perimeter</span>
                      <span className="room-metric-value">{room.real_perimeter?.toFixed(2) || 0} m</span>
                    </div>
                    <div className="room-area-highlight">
                      {room.real_area?.toFixed(2) || 0} m²
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#64748b", marginBottom: 16 }}>
                Wall Height: {projectData?.wall_height || 0} m
              </div>
              <div className="stat-card walls">
                <div className="stat-title">Total Wall Area</div>
                <div className="stat-value">{getArea("Walls")} m²</div>
              </div>
              <div className="stat-card" style={{ background: "#faf5ff", border: "1px solid #e9d5ff" }}>
                <div className="stat-title" style={{ color: "#9333ea" }}>Total Ceiling Area</div>
                <div className="stat-value" style={{ color: "#6b21a8" }}>{getCeilingArea()} m²</div>
              </div>
              <div className="stat-card" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
                <div className="stat-title">Doors ({getCount("Doors")})</div>
                <div className="stat-value">{getArea("Doors")} m²</div>
              </div>
              <div className="stat-card" style={{ background: "#fff7ed", border: "1px solid #fed7aa" }}>
                <div className="stat-title">Windows ({getCount("Windows")})</div>
                <div className="stat-value">{getArea("Windows")} m²</div>
              </div>
            </>
          )}
        </div>

        {projectData && (
          <div className="project-meta">
            <div className="meta-item">
              <CheckCircle2 size={14} className={projectData.scale_factor ? "text-green" : "text-yellow"} />
              <span>{projectData.scale_factor ? "Calibrated" : "Calibration Required"}</span>
            </div>
            <div className="meta-item" style={{ marginTop: 4 }}>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>
                {projectData.edge_count?.toLocaleString()} vector edges indexed
              </span>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

export default App;