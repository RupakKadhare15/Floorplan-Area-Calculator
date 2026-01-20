/*import React, { useState } from "react";
import axios from "axios"; // <--- 1. Make sure to import axios
import Sidebar from "./components/Sidebar";
import CanvasBoard from "./components/CanvasBoard";
import { Layers, MousePointer2, Ruler, Download, Trash2 } from "lucide-react";
import "./App.css";

function App() {
  const [projectId, setProjectId] = useState(null);
  const [mode, setMode] = useState("calibration"); 
  const [projectData, setProjectData] = useState(null);

  // 2. This is the logic that was missing. 
  // It sends the file to the backend and updates the screen.
  const handleFileUpload = async (file) => {
    const formData = new FormData();
    formData.append("file", file);

    try {
      // ↓↓↓ REPLACE THIS URL with your actual backend endpoint if different
      const response = await axios.post("http://localhost:8000/upload", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      console.log("Upload successful:", response.data);
      
      // 3. IMPORTANT: These lines update the UI to show the CanvasBoard
      setProjectId(response.data._id); // or response.data._id depending on your backend
      setProjectData(response.data);  
      
    } catch (error) {
      console.error("Error uploading file:", error);
      alert("Failed to upload file. Check console for details.");
    }
  };

  return (
    <div className="app-viewport">
      <Sidebar 
        onUpload={handleFileUpload} 
        projectData={projectData} 
        setProjectId={setProjectId}
        setProjectData={setProjectData}
        mode={mode}
        setMode={setMode}
      />

      <main className="workspace">
        <div className="absolute top-6 left-6 right-6 flex justify-between items-center pointer-events-none">
          <div className="flex bg-gray-900/80 backdrop-blur p-1 rounded-xl border border-white/10 pointer-events-auto">
            <button onClick={() => setMode('calibration')} className={`p-3 rounded-lg flex gap-2 ${mode === 'calibration' ? 'bg-blue-600 text-white' : 'text-gray-400'}`}>
              <Ruler size={18} /> Calibration
            </button>
            <button onClick={() => setMode('drawing')} className={`p-3 rounded-lg flex gap-2 ${mode === 'drawing' ? 'bg-blue-600 text-white' : 'text-gray-400'}`}>
              <MousePointer2 size={18} /> Analysis
            </button>
          </div>

          <div className="flex gap-3 pointer-events-auto">
            <button className="btn-secondary flex gap-2"><Download size={18}/> Export PDF</button>
            <button className="btn-secondary text-red-400 border-red-900/30"><Trash2 size={18}/></button>
          </div>
        </div>

        {projectData ? (
          <CanvasBoard 
            projectId={projectId} 
            mode={mode} 
            projectData={projectData} 
            setProjectData={setProjectData} 
          />
        ) : (
          <div className="text-gray-500 flex flex-col items-center gap-4">
            <Layers size={48} className="opacity-20" />
            <p>Upload a floor plan to begin</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default App; */

import React, { useState, useEffect } from "react";
import axios from "axios";
import Sidebar from "./components/Sidebar";
import CanvasBoard from "./components/CanvasBoard";
import { AreaChart, CheckCircle2, LayoutDashboard } from "lucide-react";
import "./App.css";

function App() {
  // --- GLOBAL STATE ---
  const [projectId, setProjectId] = useState(null);
  const [projectData, setProjectData] = useState(null);
  
  // Tools & Modes
  const [mode, setMode] = useState("calibration"); 
  const [activeTool, setActiveTool] = useState("wand"); 
  const [selectedCategory, setSelectedCategory] = useState("Walls");
  
  // Data State
  const [masks, setMasks] = useState([]);
  const [rooms, setRooms] = useState([]); // <--- NEW ROOMS STATE

  // Uploader Logic
  const handleFileUpload = async (file) => {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const response = await axios.post("http://localhost:8000/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setProjectId(response.data._id);
      setProjectData(response.data);
      setMasks(response.data.masks || []); 
    } catch (error) {
      console.error("Upload failed", error);
      alert("Upload failed. Check console.");
    }
  };

  // --- AUTO-SAVE LOGIC (Includes Wall Height) ---
  useEffect(() => {
    if (!projectId) return;

    const saveData = async () => {
      try {
        await axios.put(`http://localhost:8000/project/${projectId}/state`, { 
          masks: masks,
          wall_height: projectData?.wall_height
        });
        console.log("Auto-saved project state");
      } catch (err) {
        console.error("Auto-save failed", err);
      }
    };

    const timeoutId = setTimeout(saveData, 1000);
    return () => clearTimeout(timeoutId);
  }, [masks, projectData?.wall_height, projectId]);
  
  // --- ACTIONS ---
  const handleUndo = () => setMasks((prev) => prev.slice(0, -1));
  const handleClear = () => setMasks([]);

  // --- NEW: SPLIT ROOMS HANDLER ---
  const handleSplitRooms = async () => {
    if (!projectId) return;

    if (mode === 'segregation') {
      setMode('drawing');
      return;
    }

    try {
      // 1. Force save current state first
      await axios.put(`http://localhost:8000/project/${projectId}/state`, { 
        masks: masks,
        wall_height: projectData?.wall_height 
      });

      // 2. Call segregation endpoint
      const res = await axios.post(`http://localhost:8000/project/${projectId}/segregate-rooms`);
      
      // 3. Update state
      setRooms(res.data.rooms);
      setMode('segregation');

    } catch (err) {
      console.error("Segregation failed", err);
      alert("Failed to split rooms. Make sure walls are highlighted.");
    }
  };

  // --- AREA CALCULATION HELPER ---
  const getArea = (cat) => {
    const catMasks = masks.filter(m => m.category === cat);
    if (cat === "Walls") {
      const totalLength = catMasks.reduce((sum, m) => sum + (m.real_length || 0), 0);
      const height = parseFloat(projectData?.wall_height) || 0;
      return (totalLength * height).toFixed(2);
    }
    return catMasks.reduce((sum, m) => sum + (m.area || 0), 0).toFixed(2);
  };

  return (
    <div className="app-container">
      {/* 1. LEFT PANEL: CONTROLS */}
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

      {/* 2. CENTER PANEL: CANVAS */}
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

      {/* 3. RIGHT PANEL: STATS */}
      <aside className="right-panel">
        <div className="panel-header">
          {mode === 'segregation' ? (
             <h2><LayoutDashboard size={18}/> Room List</h2>
          ) : (
             <h2><AreaChart size={18}/> Area Report</h2>
          )}
        </div>
        
        <div className="stats-content">
          
          {/* VIEW 1: ROOM LIST (Segregation Mode) */}
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
            /* VIEW 2: STANDARD REPORT (Drawing Mode) */
            <>
              {/* Walls Card */}
              <div className="stat-card walls">
                <div className="stat-title">
                  Walls Surface Area <span style={{fontSize:'10px', opacity:0.6}}>(L × H)</span>
                </div>
                <div className="stat-value">{getArea('Walls')} m²</div>
              </div>

              {/* Ceiling Card */}
              <div className="stat-card ceiling">
                <div className="stat-title">Ceiling Area</div>
                <div className="stat-value">{getArea('Ceiling')} m²</div>
              </div>

              {/* Grid */}
              <div className="stats-grid">
                <div className="mini-stat">
                  <span>Doors</span>
                  <strong>{getArea('Doors')} m²</strong>
                </div>
                <div className="mini-stat">
                  <span>Windows</span>
                  <strong>{getArea('Windows')} m²</strong>
                </div>
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
            {projectData.wall_height && (
              <div className="meta-item" style={{marginTop:'8px'}}>
                 <span style={{fontSize:'12px'}}>Height set to: <b>{projectData.wall_height}m</b></span>
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

export default App;