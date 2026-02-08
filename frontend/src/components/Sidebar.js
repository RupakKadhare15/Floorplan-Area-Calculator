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
