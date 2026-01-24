import React, { useState, useEffect } from "react";
import axios from "axios";
import Sidebar from "./components/Sidebar";
import CanvasBoard from "./components/CanvasBoard";
import { AreaChart, CheckCircle2, LayoutDashboard, Settings2 } from "lucide-react";
import "./App.css";

function App() {

  const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:8000";
  // --- GLOBAL STATE ---
  const [projectId, setProjectId] = useState(null);
  const [projectData, setProjectData] = useState(null);
  
  // Tools & Modes
  const [mode, setMode] = useState("calibration"); 
  const [activeTool, setActiveTool] = useState("wand"); 
  const [selectedCategory, setSelectedCategory] = useState("Walls");
  
  // Data State
  const [masks, setMasks] = useState([]);
  const [rooms, setRooms] = useState([]);

  // --- NEW: HEIGHT STATE ---
  // Initialize with standard defaults (meters)
  const [windowHeight, setWindowHeight] = useState(2.1); 
  const [doorHeight, setDoorHeight] = useState(2.1);

  // Uploader Logic
  const handleFileUpload = async (file) => {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const response = await axios.post(`${API_BASE}/upload`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setProjectId(response.data._id);
      setProjectData(response.data);
      setMasks(response.data.masks || []); 
      
      // Load heights if they exist in saved project, otherwise keep defaults
      if (response.data.window_height) setWindowHeight(response.data.window_height);
      if (response.data.door_height) setDoorHeight(response.data.door_height);
      
    } catch (error) {
      console.error("Upload failed", error);
      alert("Upload failed. Check console.");
    }
  };

  // --- AUTO-SAVE LOGIC (Includes All Heights) ---
  useEffect(() => {
    if (!projectId) return;

    const saveData = async () => {
      try {
        await axios.put(`${API_BASE}/project/${projectId}/state`,{ 
          masks: masks,
          wall_height: projectData?.wall_height,
          window_height: windowHeight, // <--- Saving new height
          door_height: doorHeight      // <--- Saving new height
        });
        console.log("Auto-saved project state");
      } catch (err) {
        console.error("Auto-save failed", err);
      }
    };

    const timeoutId = setTimeout(saveData, 1000);
    return () => clearTimeout(timeoutId);
  }, [masks, projectData?.wall_height, windowHeight, doorHeight, projectId]);
  
  // --- ACTIONS ---
  const handleUndo = () => setMasks((prev) => prev.slice(0, -1));
  const handleClear = () => setMasks([]);

  const handleSplitRooms = async () => {
    if (!projectId) return;
    if (mode === 'segregation') {
      setMode('drawing');
      return;
    }
    try {
      await axios.put(`${API_BASE}/project/${projectId}/state`, { 
        masks: masks,
        wall_height: projectData?.wall_height,
        window_height: windowHeight,
        door_height: doorHeight
      });

      const res = await axios.post(`${API_BASE}/project/${projectId}/segregate-rooms`);
      setRooms(res.data.rooms);
      setMode('segregation');
    } catch (err) {
      console.error("Segregation failed", err);
      alert("Failed to split rooms. Make sure walls are highlighted.");
    }
  };

  // --- UPDATED AREA CALCULATION HELPER ---
  const getArea = (cat) => {
    const catMasks = masks.filter(m => m.category === cat);
    
    // 1. Walls: Length x Wall Height
    if (cat === "Walls") {
      const totalLength = catMasks.reduce((sum, m) => sum + (m.real_length || 0), 0);
      const height = parseFloat(projectData?.wall_height) || 0;
      return (totalLength * height).toFixed(2);
    }
    
    // 2. Windows: Length x Window Height
    if (cat === "Windows") {
      const totalLength = catMasks.reduce((sum, m) => sum + (m.real_length || 0), 0);
      return (totalLength * windowHeight).toFixed(2);
    }

    // 3. Doors: Length x Door Height
    if (cat === "Doors") {
      const totalLength = catMasks.reduce((sum, m) => sum + (m.real_length || 0), 0);
      return (totalLength * doorHeight).toFixed(2);
    }

    // 4. Others (Floor, etc.): Polygon Area
    return catMasks.reduce((sum, m) => sum + (m.area || 0), 0).toFixed(2);
  };

  // Helper to handle wall height change separately since it's in projectData
  const handleWallHeightChange = (e) => {
    setProjectData(prev => ({ ...prev, wall_height: e.target.value }));
  };

  return (
    <div className="app-container">
      {/* 1. LEFT PANEL */}
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
      />

      {/* 2. CENTER PANEL */}
      <main className="main-canvas-area">
        {projectData ? (
          <CanvasBoard 
            projectId={projectId}
            projectData={projectData}
            setProjectData={setProjectData}
            mode={mode}
            activeTool={activeTool}
            selectedCategory={selectedCategory}
            masks={masks}
            setMasks={setMasks}
            rooms={rooms}
          />
        ) : (
          <div className="empty-state">
            <p>Please upload a floor plan to start</p>
          </div>
        )}
      </main>

      {/* 3. RIGHT PANEL */}
      <aside className="right-panel">
        <div className="panel-header">
          {mode === 'segregation' ? (
             <h2><LayoutDashboard size={18}/> Room List</h2>
          ) : (
             <h2><AreaChart size={18}/> Area Report</h2>
          )}
        </div>
        
        <div className="stats-content">
          
          {/* VIEW 1: ROOM LIST */}
          {mode === 'segregation' ? (
             <div className="flex flex-col gap-3">
               {rooms.length === 0 ? (
                 <p className="text-gray-400 text-sm text-center">No rooms detected yet.</p>
               ) : (
                 rooms.map(room => (
                   <div key={room.id} className="mini-stat flex justify-between items-center px-4" style={{borderColor: '#e2e8f0'}}>
                     <div className="flex items-center gap-2">
                       <div style={{width:12, height:12, borderRadius:'50%', background: room.color, border: '1px solid rgba(0,0,0,0.1)'}}></div>
                       <span className="font-bold text-gray-700">{room.id}</span>
                     </div>
                     <strong className="text-lg">{room.real_area ? room.real_area.toFixed(2) : room.pixel_area} m²</strong>
                   </div>
                 ))
               )}
             </div>
          ) : (
            /* VIEW 2: STANDARD REPORT */
            <>
              {/* --- DYNAMIC HEIGHT INPUTS --- */}
              {/* This section appears only when specific categories are selected */}
              <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
                <div className="flex items-center gap-2 mb-2 text-blue-800 font-semibold text-sm">
                  <Settings2 size={14} /> 
                  <span>Active Height Settings</span>
                </div>
                
                {selectedCategory === 'Walls' && (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500">Wall Height (m)</label>
                    <input 
                      type="number" 
                      step="0.1"
                      className="p-1 border rounded"
                      value={projectData?.wall_height || ''} 
                      onChange={handleWallHeightChange}
                    />
                  </div>
                )}
                
                {selectedCategory === 'Windows' && (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500">Window Height (m)</label>
                    <input 
                      type="number" 
                      step="0.1"
                      className="p-1 border rounded"
                      value={windowHeight} 
                      onChange={(e) => setWindowHeight(e.target.value)}
                    />
                  </div>
                )}

                {selectedCategory === 'Doors' && (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500">Door Height (m)</label>
                    <input 
                      type="number" 
                      step="0.1"
                      className="p-1 border rounded"
                      value={doorHeight} 
                      onChange={(e) => setDoorHeight(e.target.value)}
                    />
                  </div>
                )}
                
                {/* Default view if no specific category matches */}
                {!['Walls', 'Windows', 'Doors'].includes(selectedCategory) && (
                   <span className="text-xs text-gray-400 italic">Select Walls, Windows, or Doors to adjust height.</span>
                )}
              </div>

              {/* Walls Card */}
              <div className={`stat-card walls ${selectedCategory === 'Walls' ? 'ring-2 ring-blue-500' : ''}`}>
                <div className="stat-title">Walls Area (L × H)</div>
                <div className="stat-value">{getArea('Walls')} m²</div>
              </div>

              {/* Grid */}
              <div className="stats-grid">
                <div className={`mini-stat ${selectedCategory === 'Doors' ? 'ring-2 ring-blue-500' : ''}`}>
                  <span>Doors (L×H)</span>
                  <strong>{getArea('Doors')} m²</strong>
                </div>
                <div className={`mini-stat ${selectedCategory === 'Windows' ? 'ring-2 ring-blue-500' : ''}`}>
                  <span>Windows (L×H)</span>
                  <strong>{getArea('Windows')} m²</strong>
                </div>
              </div>

              {/* Ceiling Card */}
              <div className="stat-card ceiling mt-3">
                <div className="stat-title">Ceiling Area</div>
                <div className="stat-value">{getArea('Ceiling')} m²</div>
              </div>
            </>
          )}

        </div>

        {/* Footer Info */}
        {projectData && (
          <div className="project-meta">
            <div className="meta-item">
              <CheckCircle2 size={14} className={projectData.scale_factor ? "text-green-500" : "text-yellow-500"}/>
              <span>{projectData.scale_factor ? "Calibrated" : "Calibration Required"}</span>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

export default App;