// import React from 'react';

// const Sidebar = ({ onUpload, projectId, mode, setMode, projectData, loading }) => {
//   const handleFileChange = (e) => {
//     if (e.target.files && e.target.files[0]) onUpload(e.target.files[0]);
//   };

//   return (
//     <div className="w-72 bg-white border-r flex flex-col h-full shadow-lg p-6">
//       <h1 className="text-2xl font-bold text-blue-600 mb-6">SmartPlan</h1>
      
//       <div className="mb-8">
//         <label className="block text-sm font-medium text-gray-700 mb-2">Project File</label>
//         <input type="file" onChange={handleFileChange} className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"/>
//         {loading && <p className="text-xs text-blue-500 mt-2">Uploading...</p>}
//       </div>

//       {projectId && (
//         <div className="flex flex-col gap-2">
//           <button 
//   onClick={() => setMode("calibration")} 
//   className={`mode-toggle px-4 py-2 text-sm font-medium rounded-md ${mode === "calibration" ? "active" : "text-gray-600"}`}>
//   📏 Calibration
// </button>
//           <button 
//   onClick={() => setMode("drawing")} 
//   className={`mode-toggle px-4 py-2 text-sm font-medium rounded-md ${mode === "drawing" ? "active" : "text-gray-600"}`}>
//     🎨 Drawing Mode
//     </button>
          
//           <div className="mt-4 p-4 bg-gray-50 rounded-lg border">
//             <h3 className="text-sm font-medium text-gray-900 mb-2">Status</h3>
//             {projectData?.scale_factor ? (
//               <p className="text-xs text-green-600">Scale: {projectData.scale_factor.toFixed(2)} px/{projectData.unit}</p>
//             ) : (
//               <p className="text-xs text-yellow-600">Not Calibrated</p>
//             )}
//           </div>
//         </div>
//       )}
//     </div>
//   );
// };
// export default Sidebar;


/// part 2

// import React from 'react';
// import { Upload, Info, CheckCircle2 } from 'lucide-react';

// const Sidebar = ({ onUpload, projectData, setProjectId, setProjectData, mode }) => {
  
//   const handleFileUpload = async (e) => {
//     // ... same axios upload logic as before ...
//     if (e.target.files && e.target.files[0]) onUpload(e.target.files[0]);
//   };

//   return (
//     <aside className="sidebar">
//       <div className="flex items-center gap-3 mb-10">
//         <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-xl">S</div>
//         <h1 className="text-xl font-bold tracking-tight">SmartPlan <span className="text-blue-500">Pro</span></h1>
//       </div>

//       <div className="space-y-6 flex-1">
//         {/* File Upload Section */}
//         <section>
//           <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">Project File</h2>
//           <label className="border-2 border-dashed border-white/10 rounded-xl p-6 flex flex-col items-center gap-3 hover:border-blue-500/50 transition-colors cursor-pointer">
//             <Upload className="text-blue-500" />
//             <span className="text-sm text-gray-400">Drag & Drop or Click</span>
//             <input type="file" className="hidden" onChange={handleFileUpload} />
//           </label>
//         </section>

//         {/* Stats Section */}
//         {projectData && (
//           <section className="bg-white/5 rounded-xl p-4 border border-white/10">
//             <h2 className="text-xs font-semibold text-gray-500 uppercase mb-3 flex items-center gap-2">
//               <Info size={14}/> Scale Info
//             </h2>
//             {projectData.scale_factor ? (
//               <div className="flex items-center gap-2 text-green-400">
//                 <CheckCircle2 size={16}/>
//                 <span className="text-sm">1 {projectData.unit} = {projectData.scale_factor.toFixed(1)}px</span>
//               </div>
//             ) : (
//               <p className="text-sm text-yellow-500">Requires Calibration</p>
//             )}
//           </section>
//         )}
//       </div>

//       {/* Footer Branding */}
//       <div className="pt-6 border-t border-white/10 text-xs text-gray-600">
//         v2.0.1 Running on FastAPI & MongoAtlas
//       </div>
//     </aside>
//   );
// };

// export default Sidebar;

import React from 'react';
import { Upload, Ruler, Eraser, Undo2, Trash2, BoxSelect, DoorOpen, LayoutTemplate, Maximize, Split } from 'lucide-react';

const Sidebar = ({ 
  onUpload, mode, setMode, 
  activeTool, setActiveTool, 
  selectedCategory, setSelectedCategory, 
  handleUndo, handleClear, hasProject,
  projectData, setProjectData,
  onSplitRooms
}) => {

  const handleFileChange = (e) => {
    if (e.target.files[0]) onUpload(e.target.files[0]);
  };

  const selectCat = (cat) => {
    setMode('drawing');
    setSelectedCategory(cat);
    setActiveTool('wand');
  };

  const handleHeightChange = (e) => {
    const val = e.target.value;
    setProjectData(prev => ({ ...prev, wall_height: val }));
  };

  return (
    <aside className="left-sidebar">
      <div className="brand">
        <h1>SmartPlan <span className="text-light">Pro</span></h1>
      </div>

      <div className="scroll-content">
        
        {/* 1. UPLOAD */}
        <div className="sidebar-group">
          <label className="section-label">Project File</label>
          <label className="upload-btn">
            <Upload size={18} />
            <span>Upload Plan</span>
            <input type="file" hidden onChange={handleFileChange} />
          </label>
        </div>

        {/* CALIBRATION & HEIGHT SETTINGS */}
        {hasProject && mode === 'calibration' && (
          <div className="sidebar-group">
            <label className="section-label">Calibration Settings</label>
            <div className="vertical-stack">
              <label style={{ fontSize: '12px', fontWeight: 500, color: '#64748b' }}>
                Wall Height (meters)
              </label>
              <input 
                type="number" 
                step="0.1" 
                placeholder="e.g. 2.4"
                value={projectData?.wall_height || ''} 
                onChange={handleHeightChange}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  fontSize: '14px',
                  outline: 'none',
                  marginTop: '4px',
                  boxSizing: 'border-box'
                }}
              />
            </div>
          </div>
        )}

        {/* 2. MAIN TOOLS */}
        <div className={`sidebar-group ${!hasProject ? "disabled" : ""}`}>
          <label className="section-label">Tools & Categories</label>
          
          <div className="vertical-stack">
            {/* Calibrate */}
            <button 
              className={`main-btn ${mode === 'calibration' ? 'active' : ''}`}
              onClick={() => setMode('calibration')}
            >
              <Ruler size={18} />
              <span>Calibrate Scale</span>
            </button>

            {/* Walls */}
            <button 
              className={`main-btn ${selectedCategory === 'Walls' && mode === 'drawing' ? 'active-wall' : ''}`}
              onClick={() => selectCat('Walls')}
            >
              <BoxSelect size={18} />
              <span>Highlight Walls</span>
            </button>

            {/* Ceiling */}
            <button 
              className={`main-btn ${selectedCategory === 'Ceiling' && mode === 'drawing' ? 'active-ceiling' : ''}`}
              onClick={() => selectCat('Ceiling')}
            >
              <Maximize size={18} />
              <span>Highlight Ceiling</span>
            </button>

            {/* Doors */}
            <button 
              className={`main-btn ${selectedCategory === 'Doors' && mode === 'drawing' ? 'active-door' : ''}`}
              onClick={() => selectCat('Doors')}
            >
              <DoorOpen size={18} />
              <span>Highlight Doors</span>
            </button>

            {/* Windows */}
            <button 
              className={`main-btn ${selectedCategory === 'Windows' && mode === 'drawing' ? 'active-window' : ''}`}
              onClick={() => selectCat('Windows')}
            >
              <LayoutTemplate size={18} />
              <span>Highlight Windows</span>
            </button>

            {/* SPLIT ROOMS (New) */}
            <button 
              className={`main-btn ${mode === 'segregation' ? 'active' : ''}`}
              onClick={onSplitRooms}
              style={{ marginTop: '12px', borderColor: mode === 'segregation' ? '#8b5cf6' : 'transparent', color: mode === 'segregation' ? '#7c3aed' : '#64748b' }}
            >
              <Split size={18} />
              <span>{mode === 'segregation' ? 'Back to Drawing' : 'Split Rooms'}</span>
            </button>

          </div>
        </div>

        {/* 3. ACTIONS */}
        {mode !== 'segregation' && (
          <div className={`sidebar-group mt-auto ${!hasProject ? "disabled" : ""}`}>
            <label className="section-label">Actions</label>
            <div className="tools-row">
              <button 
                className={`icon-btn ${activeTool === 'eraser' ? 'active' : ''}`} 
                onClick={() => { setMode('drawing'); setActiveTool('eraser'); }} 
                title="Eraser"
              >
                <Eraser size={20} />
              </button>
              <button className="icon-btn" onClick={handleUndo} title="Undo">
                <Undo2 size={20} />
              </button>
              <button className="icon-btn danger" onClick={handleClear} title="Clear All">
                <Trash2 size={20} />
              </button>
            </div>
          </div>
        )}

      </div>
    </aside>
  );
};

export default Sidebar;