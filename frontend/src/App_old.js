import React, { useState } from "react";
import Sidebar from "./components/Sidebar";
import CanvasBoard from "./components/CanvasBoard";
import { Layers, MousePointer2, Ruler, Download, Trash2 } from "lucide-react";
import "./App.css";

function App() {
  const [projectId, setProjectId] = useState(null);
  const [mode, setMode] = useState("calibration"); 
  const [projectData, setProjectData] = useState(null);

  return (
    <div className="app-viewport">
      {/* 1. Sidebar */}
      <Sidebar 
        projectData={projectData} 
        setProjectId={setProjectId}
        setProjectData={setProjectData}
        mode={mode}
        setMode={setMode}
      />

      {/* 2. Main Workspace */}
      <main className="workspace">
        {/* Floating Top Header */}
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

        {/* The Actual Canvas Component */}
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

export default App;