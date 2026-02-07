// import React, { useState, useEffect } from "react";
// import axios from "axios";
// import Sidebar from "./components/Sidebar";
// import CanvasBoard from "./components/CanvasBoard";
// import { AreaChart, CheckCircle2, LayoutDashboard } from "lucide-react";
// import "./App.css";

// const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:8000";

// function App() {

//   // --- GLOBAL STATE ---
//   const [projectId, setProjectId] = useState(null);
//   const [projectData, setProjectData] = useState(null);
  
//   // Tools & Modes
//   const [mode, setMode] = useState("calibration"); 
//   const [activeTool, setActiveTool] = useState("wand"); 
//   const [selectedCategory, setSelectedCategory] = useState("Walls");
  
//   // Data State
//   const [masks, setMasks] = useState([]);
//   const [rooms, setRooms] = useState([]);

//   // Uploader Logic
//   const handleFileUpload = async (file) => {
//     const formData = new FormData();
//     formData.append("file", file);
//     try {
//       const response = await axios.post(`${API_BASE}/upload`, formData, {
//         headers: { "Content-Type": "multipart/form-data" },
//       });
//       setProjectId(response.data._id);
//       setProjectData(response.data);
//       setMasks(response.data.masks || []); 
//     } catch (error) {
//       console.error("Upload failed", error);
//       alert("Upload failed. Check console.");
//     }
//   };

//   // --- AUTO-SAVE LOGIC ---
//   useEffect(() => {
//     if (!projectId) return;

//     const saveData = async () => {
//       try {
//         await axios.put(`${API_BASE}/project/${projectId}/state`,{ 
//           masks: masks,
//           wall_height: projectData?.wall_height,
//         });
//         console.log("Auto-saved project state");
//       } catch (err) {
//         console.error("Auto-save failed", err);
//       }
//     };

//     const timeoutId = setTimeout(saveData, 1000);
//     return () => clearTimeout(timeoutId);
//   }, [masks, projectData?.wall_height, projectId]);
  
//   // --- ACTIONS ---
//   const handleUndo = () => setMasks((prev) => prev.slice(0, -1));
//   const handleClear = () => setMasks([]);

//   const handleSplitRooms = async () => {
//     if (!projectId) return;
//     if (mode === 'segregation') {
//       setMode('drawing');
//       return;
//     }
//     try {
//       await axios.put(`${API_BASE}/project/${projectId}/state`, { 
//         masks: masks,
//         wall_height: projectData?.wall_height,
//       });

//       const res = await axios.post(`${API_BASE}/project/${projectId}/segregate-rooms`);
//       setRooms(res.data.rooms);
//       setMode('segregation');
//     } catch (err) {
//       console.error("Segregation failed", err);
//       alert("Failed to split rooms. Make sure walls are highlighted.");
//     }
//   };

//   // --- UPDATED AREA CALCULATION HELPER ---
//   const getArea = (cat) => {
//     const catMasks = masks.filter(m => m.category === cat);
    
//     // 1. Walls Calculation
//     if (cat === "Walls") {
//       const wallHeight = parseFloat(projectData?.wall_height) || 0;
      
//       // A. Base Wall Area: (Length of highlighted walls × Wall Height)
//       const baseWallArea = catMasks.reduce((sum, m) => sum + ((m.real_length || 0) * wallHeight), 0);

//       // B. Add Remaining Area from Windows/Doors
//       const openingMasks = masks.filter(m => ['Doors', 'Windows'].includes(m.category));
      
//       const remainingArea = openingMasks.reduce((sum, m) => {
//         const opLength = m.real_length || 0;
//         const opHeight = m.height || 0; 
        
//         // Calculate vertical difference
//         const verticalDiff = Math.max(0, wallHeight - opHeight);
        
//         // Add this strip to the total wall area
//         return sum + (opLength * verticalDiff);
//       }, 0);

//       return (baseWallArea + remainingArea).toFixed(2);
//     }
    
//     // 2. Windows & Doors
//     if (['Windows', 'Doors'].includes(cat)) {
//        return catMasks.reduce((sum, m) => {
//         return sum + ((m.real_length || 0) * (m.height || 0));
//       }, 0).toFixed(2);
//     }

//     return 0;
//   };

//   // --- CEILING AREA HELPER (Sum of Rooms) ---
//   const getCeilingArea = () => {
//     if (!rooms || rooms.length === 0) return "0.00";
//     // Sum real_area if available, otherwise 0
//     const total = rooms.reduce((sum, room) => sum + (room.real_area || 0), 0);
//     return total.toFixed(2);
//   };

//   // Helper to get count of items in a category
//   const getCount = (cat) => masks.filter(m => m.category === cat).length;

//   return (
//     <div className="app-container">
//       {/* 1. LEFT PANEL */}
//       <Sidebar 
//         onUpload={handleFileUpload}
//         mode={mode}
//         setMode={setMode}
//         activeTool={activeTool}
//         setActiveTool={setActiveTool}
//         selectedCategory={selectedCategory}
//         setSelectedCategory={setSelectedCategory}
//         handleUndo={handleUndo}
//         handleClear={handleClear}
//         hasProject={!!projectId}
//         projectData={projectData} 
//         setProjectData={setProjectData}
//         onSplitRooms={handleSplitRooms}
//       />

//       {/* 2. CENTER PANEL */}
//       <main className="main-canvas-area">
//         {projectData ? (
//           <CanvasBoard 
//             projectId={projectId}
//             projectData={projectData}
//             setProjectData={setProjectData}
//             mode={mode}
//             activeTool={activeTool}
//             selectedCategory={selectedCategory}
//             masks={masks}
//             setMasks={setMasks}
//             rooms={rooms}
//           />
//         ) : (
//           <div className="empty-state">
//             <p>Please upload a floor plan to start</p>
//           </div>
//         )}
//       </main>

//       {/* 3. RIGHT PANEL */}
//       <aside className="right-panel">
//         <div className="panel-header">
//           {mode === 'segregation' ? (
//              <h2><LayoutDashboard size={18}/> Room List</h2>
//           ) : (
//              <h2><AreaChart size={18}/> Area Report</h2>
//           )}
//         </div>
        
//         <div className="stats-content">
          
//           {/* VIEW 1: ROOM LIST */}
//           {mode === 'segregation' ? (
//              <div className="flex flex-col gap-3">
//                {rooms.length === 0 ? (
//                  <p className="text-gray-400 text-sm text-center">No rooms detected yet.</p>
//                ) : (
//                  rooms.map(room => (
//                    <div key={room.id} className="mini-stat flex justify-between items-center px-4" style={{borderColor: '#e2e8f0'}}>
//                      <div className="flex items-center gap-2">
//                        <div style={{width:12, height:12, borderRadius:'50%', background: room.color, border: '1px solid rgba(0,0,0,0.1)'}}></div>
//                        <span className="font-bold text-gray-700">{room.id}</span>
//                      </div>
//                      <strong className="text-lg">{room.real_area ? room.real_area.toFixed(2) : room.pixel_area} m²</strong>
//                    </div>
//                  ))
//                )}
//              </div>
//           ) : (
//             /* VIEW 2: STANDARD REPORT */
//             <>
//               {/* --- STATIC WALL HEIGHT LABEL --- */}
//               <div className="mb-4 text-sm font-semibold text-gray-600">
//                 Wall Height :- {projectData?.wall_height || 0} m
//               </div>

//               {/* Walls Card */}
//               <div className="stat-card walls mb-4 ring-2 ring-blue-500">
//                 <div className="stat-title">Total Wall Area</div>
//                 <div className="stat-value">{getArea('Walls')} m²</div>
//               </div>

//               {/* Ceiling Card (New) - Purple Style */}
//               <div 
//                 className="stat-card mb-4"
//                 style={{ background: '#faf5ff', border: '1px solid #e9d5ff' }}
//               >
//                 <div className="stat-title" style={{color: '#9333ea'}}>Total Ceiling Area</div>
//                 <div className="stat-value" style={{color: '#6b21a8'}}>{getCeilingArea()} m²</div>
//               </div>

//               {/* Doors Card - Green Style */}
//               <div 
//                 className="stat-card mb-4" 
//                 style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}
//               >
//                 <div className="stat-title">Doors Area (Count - {getCount('Doors')})</div>
//                 <div className="stat-value">{getArea('Doors')} m²</div>
//               </div>

//               {/* Windows Card - Orange Style */}
//               <div 
//                 className="stat-card mb-4"
//                 style={{ background: '#fff7ed', border: '1px solid #fed7aa' }}
//               >
//                 <div className="stat-title">Windows Area (Count - {getCount('Windows')})</div>
//                 <div className="stat-value">{getArea('Windows')} m²</div>
//               </div>
//             </>
//           )}

//         </div>

//         {/* Footer Info */}
//         {projectData && (
//           <div className="project-meta">
//             <div className="meta-item">
//               <CheckCircle2 size={14} className={projectData.scale_factor ? "text-green-500" : "text-yellow-500"}/>
//               <span>{projectData.scale_factor ? "Calibrated" : "Calibration Required"}</span>
//             </div>
//           </div>
//         )}
//       </aside>
//     </div>
//   );
// }

// export default App;


import React, { useState, useEffect } from "react";
import axios from "axios";
import Sidebar from "./components/Sidebar";
import CanvasBoard from "./components/CanvasBoard";
import { AreaChart, CheckCircle2, LayoutDashboard } from "lucide-react";
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
    } catch (error) {
      console.error("Upload failed", error);
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

  return (
    <div className="app-container">
      <Sidebar 
        onUpload={handleFileUpload} mode={mode} setMode={setMode} activeTool={activeTool}
        setActiveTool={setActiveTool} selectedCategory={selectedCategory} setSelectedCategory={setSelectedCategory}
        handleUndo={handleUndo} handleClear={handleClear} hasProject={!!projectId}
        projectData={projectData} setProjectData={setProjectData} onSplitRooms={handleSplitRooms}
      />

      <main className="main-canvas-area">
        {projectData ? (
          <CanvasBoard 
            projectId={projectId} projectData={projectData} setProjectData={setProjectData}
            mode={mode} activeTool={activeTool} selectedCategory={selectedCategory}
            masks={masks} setMasks={setMasks} rooms={rooms}
          />
        ) : (
          <div className="empty-state">
            <p>Please upload a floor plan to start</p>
          </div>
        )}
      </main>

      <aside className="right-panel">
        <div className="panel-header">
          {mode === 'segregation' ? (
             <h2><LayoutDashboard size={18}/> Room List</h2>
          ) : (
             <h2><AreaChart size={18}/> Area Report</h2>
          )}
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
                         <div style={{width:12, height:12, borderRadius:'50%', background: room.color, border: '1px solid rgba(0,0,0,0.1)'}}></div>
                         <span className="font-bold text-gray-700">{room.id}</span>
                       </div>
                       <span className="text-xs text-gray-500">Wall: {getNetRoomWallArea(room)} m²</span>
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