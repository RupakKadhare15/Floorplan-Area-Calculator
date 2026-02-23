import React, { useState, useEffect } from "react";
import axios from "axios";
import Sidebar from "./components/Sidebar";
import CanvasBoard from "./components/CanvasBoard";
import { AreaChart, CheckCircle2, LayoutDashboard, Download } from "lucide-react"; // Import Download Icon
import "./App.css";

const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:8000";

function App() {
  const [projectId, setProjectId] = useState(null);
  const [projectData, setProjectData] = useState(null);
  const [mode, setMode] = useState("calibration"); 
  const [activeTool, setActiveTool] = useState("wand"); 
  const [selectedCategory, setSelectedCategory] = useState("Walls");
  const [masks, setMasks] = useState([]);
  const [rooms, setRooms] = useState([]);

  const handleFileUpload = async (file, pageIndex = 0) => {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const response = await axios.post(`${API_BASE}/upload?pdf_page=${pageIndex}`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setProjectId(response.data._id);
      setProjectData(response.data);
      setMasks(response.data.masks || []); 
    } catch (error) {
      console.error("Upload failed", error);
      alert("Upload failed. If this is a large PDF, it might have timed out.");
    }
  };

  useEffect(() => {
    if (!projectId) return;
    const saveData = async () => {
      try {
        await axios.put(`${API_BASE}/project/${projectId}/state`,{ 
          masks: masks,
          wall_height: projectData?.wall_height,
        });
      } catch (err) {
        console.error("Auto-save failed", err);
      }
    };
    const timeoutId = setTimeout(saveData, 1000);
    return () => clearTimeout(timeoutId);
  }, [masks, projectData?.wall_height, projectId]);
  
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
      });
      const res = await axios.post(`${API_BASE}/project/${projectId}/segregate-rooms`);
      setRooms(res.data.rooms);
      setMode('segregation');
    } catch (err) {
      console.error("Segregation failed", err);
    }
  };

  const getArea = (cat) => {
    const catMasks = masks.filter(m => m.category === cat);
    if (cat === "Walls") {
      const wallHeight = parseFloat(projectData?.wall_height) || 0;
      const baseWallArea = catMasks.reduce((sum, m) => sum + ((m.real_length || 0) * wallHeight), 0);
      const remainingArea = masks.filter(m => ['Doors', 'Windows'].includes(m.category)).reduce((sum, m) => {
        const verticalDiff = Math.max(0, wallHeight - (m.height || 0));
        return sum + ((m.real_length || 0) * verticalDiff);
      }, 0);
      return (baseWallArea + remainingArea).toFixed(2);
    }
    if (['Windows', 'Doors'].includes(cat)) {
       return catMasks.reduce((sum, m) => {
        return sum + ((m.real_length || 0) * (m.height || 0));
      }, 0).toFixed(2);
    }
    return 0;
  };

  const getCeilingArea = () => {
    if (!rooms || rooms.length === 0) return "0.00";
    const total = rooms.reduce((sum, room) => sum + (room.real_area || 0), 0);
    return total.toFixed(2);
  };

  const getTotalNetWallArea = () => {
    const wallHeight = parseFloat(projectData?.wall_height) || 0;
    const totalGross = rooms.reduce((sum, room) => sum + ((room.real_perimeter || 0) * wallHeight), 0);
    const totalOpenings = masks.filter(m => ['Doors', 'Windows'].includes(m.category))
                               .reduce((sum, m) => sum + ((m.real_length || 0) * (m.height || 0)), 0);
    return (totalGross - totalOpenings).toFixed(2);
  };

  const getNetRoomWallArea = (room) => {
    const wallHeight = parseFloat(projectData?.wall_height) || 0;
    const grossWallArea = (room.real_perimeter || 0) * wallHeight;
    const totalOpeningsArea = masks.filter(m => ['Doors', 'Windows'].includes(m.category))
                                   .reduce((sum, m) => sum + ((m.real_length || 0) * (m.height || 0)), 0);
    const deductionPerRoom = totalOpeningsArea / (rooms.length || 1);
    return (grossWallArea - deductionPerRoom).toFixed(2);
  };

  const getCount = (cat) => masks.filter(m => m.category === cat).length;

  // --- NEW EXPORT FUNCTION ---
  const handleExport = async () => {
    if (!rooms || rooms.length === 0) {
      alert("Please segregate rooms first before exporting.");
      return;
    }

    // 1. Prepare Room Rows
    const roomRows = rooms.map(room => ({
      "Room No": room.id,
      "Inner Wall Area (m²)": parseFloat(getNetRoomWallArea(room)),
      "Ceiling Area (m²)": parseFloat(room.real_area ? room.real_area.toFixed(2) : 0),
      "Inner Perimeter (m)": parseFloat(room.real_perimeter ? room.real_perimeter.toFixed(2) : 0)
    }));

    // 2. Prepare Summary Table
    const summaryData = {
      "Total Wall Area (m²)": parseFloat(getTotalNetWallArea()),
      "Total Ceiling Area (m²)": parseFloat(getCeilingArea()),
      "Total Door Area (m²)": parseFloat(getArea('Doors')),
      "Total Window Area (m²)": parseFloat(getArea('Windows'))
    };

    try {
      const response = await axios.post(`${API_BASE}/project/export`, {
        rooms: roomRows,
        summary: summaryData
      }, {
        responseType: 'blob', // Important for file download
      });

      // Trigger Browser Download
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'measurements.xlsx');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error("Export failed", err);
      alert("Failed to export Excel file.");
    }
  };

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
      />

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
          <div className="empty-state"><p>Please upload a floor plan</p></div>
        )}
      </main>

      <aside className="right-panel">
        <div className="panel-header flex justify-between items-center">
          <h2>
            {mode === 'segregation' ? <LayoutDashboard size={18}/> : <AreaChart size={18}/>} 
            {mode === 'segregation' ? " Room List" : " Area Report"}
          </h2>
          
        <br></br>
          {/* {mode === 'segregation' && ( */}
             <button 
                onClick={handleExport}
                className="p-1 rounded hover:bg-gray-100 text-blue-600"
                title="Export to Excel"
             >
                <Download size={18} />
                Download Report
             </button>
          {/* )} */}
        </div>
        
        <div className="stats-content">
          {mode === 'segregation' ? (
             <div className="flex flex-col gap-3">
               <div className="stat-card mb-4" style={{ background: '#eff6ff', border: '1px solid #dbeafe' }}>
                 <div className="stat-title">Total Net Wall Area</div>
                 <div className="stat-value">{getTotalNetWallArea()} m²</div>
               </div>
               {rooms.map(room => (
                   <div key={room.id} className="mini-stat flex justify-between items-center px-4" style={{borderColor: '#e2e8f0'}}>
                     <div className="flex flex-col">
                       <div className="flex items-center gap-2">
                         <div style={{width:12, height:12, borderRadius:'50%', background: room.color}}></div>
                         <span className="font-bold text-gray-700">{room.id}</span>
                       </div>
                       <span className="text-xs text-gray-500">Wall: {getNetRoomWallArea(room)} m²</span>
                       <br></br>
                       <span className="text-xs font-semibold text-blue-600">Perimeter: {room.real_perimeter ? room.real_perimeter.toFixed(2) : 0} m</span>
                     </div>
                     <strong className="text-lg">{room.real_area ? room.real_area.toFixed(2) : 0} m²</strong>
                   </div>
               ))}
             </div>
          ) : (
            <>
              <div className="mb-4 text-sm font-semibold text-gray-600">Wall Height :- {projectData?.wall_height || 0} m</div>
              <div className="stat-card walls mb-4 ring-2 ring-blue-500">
                <div className="stat-title">Total Wall Area</div>
                <div className="stat-value">{getArea('Walls')} m²</div>
              </div>
              <div className="stat-card mb-4" style={{ background: '#faf5ff', border: '1px solid #e9d5ff' }}>
                <div className="stat-title" style={{color: '#9333ea'}}>Total Ceiling Area</div>
                <div className="stat-value" style={{color: '#6b21a8'}}>{getCeilingArea()} m²</div>
              </div>
              <div className="stat-card mb-4" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                <div className="stat-title">Doors Area (Count - {getCount('Doors')})</div>
                <div className="stat-value">{getArea('Doors')} m²</div>
              </div>
              <div className="stat-card mb-4" style={{ background: '#fff7ed', border: '1px solid #fed7aa' }}>
                <div className="stat-title">Windows Area (Count - {getCount('Windows')})</div>
                <div className="stat-value">{getArea('Windows')} m²</div>
              </div>
            </>
          )}
        </div>

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