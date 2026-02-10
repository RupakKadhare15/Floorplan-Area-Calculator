


import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Circle, Text, Group } from 'react-konva';
import useImage from 'use-image';
import axios from 'axios';

const CanvasBoard = ({ 
  mode, projectId, projectData, setProjectData, 
  activeTool, selectedCategory, masks, setMasks,
  rooms 
}) => {
    const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:8000";
    const stageRef = useRef(null);

    // --- 1. SETUP IMAGE ---
    const cleanBase64 = (data) => {
        if (!data) return null;
        let clean = data.replace(/^data:image\/\w+;base64,/, '').replace(/(\r\n|\n|\r)/gm, "");
        return `data:image/png;base64,${clean}`;
    };

    const imageSrc = useMemo(() => 
        projectData?.image_data ? cleanBase64(projectData.image_data) : null, 
    [projectData]);

    const [image] = useImage(imageSrc);

    // --- 2. ZOOM & PAN STATE ---
    const [stageScale, setStageScale] = useState(1);
    const [stagePos, setStagePos] = useState({ x: 0, y: 0 });

    // --- 3. AUTO-FIT IMAGE ON LOAD ---
    useEffect(() => {
        if (image) {
            const w = window.innerWidth - 300; // Subtract sidebar width
            const h = window.innerHeight - 50;
            
            // Calculate scale to fit image completely in view
            const scaleX = w / image.width;
            const scaleY = h / image.height;
            const fitScale = Math.min(scaleX, scaleY); 

            setStageScale(fitScale);
            setStagePos({ x: 0, y: 0 }); 
        }
    }, [image]);

    // --- 4. MOUSE HANDLERS (ZOOM & PAN) ---
    const handleWheel = (e) => {
        e.evt.preventDefault();
        const scaleBy = 1.1;
        const stage = stageRef.current;
        const oldScale = stage.scaleX();
        const mousePointTo = {
            x: stage.getPointerPosition().x / oldScale - stage.x() / oldScale,
            y: stage.getPointerPosition().y / oldScale - stage.y() / oldScale
        };

        const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
        setStageScale(newScale);

        const newPos = {
            x: -(mousePointTo.x - stage.getPointerPosition().x / newScale) * newScale,
            y: -(mousePointTo.y - stage.getPointerPosition().y / newScale) * newScale
        };
        setStagePos(newPos);
    };

    // --- STATE ---
    const [calibrationLine, setCalibrationLine] = useState([]);
    const [isDrawing, setIsDrawing] = useState(false);
    const [eraserPath, setEraserPath] = useState([]); 
    const [openingLine, setOpeningLine] = useState([]); 
    const [tolerance] = useState(40);

    const isLinearTool = useMemo(() => {
        return ['Doors', 'Windows'].includes(selectedCategory) && activeTool === 'wand';
    }, [selectedCategory, activeTool]);

    // Helper: Get REAL image coordinates (ignoring zoom)
    const getRelativePointerPosition = (node) => {
        const transform = node.getAbsoluteTransform().copy();
        transform.invert();
        const pos = node.getStage().getPointerPosition();
        return transform.point(pos);
    };

    // --- ERASER LOGIC (Unchanged) ---
    const applyEraser = async (pathPoints) => {
        if (!pathPoints || pathPoints.length < 2) return;

        const updatedMasks = await Promise.all(masks.map(async (mask) => {
            if (mask.category !== selectedCategory) return mask;

            return new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth || img.width;
                    canvas.height = img.naturalHeight || img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    ctx.globalCompositeOperation = 'destination-out';
                    ctx.beginPath();
                    ctx.moveTo(pathPoints[0], pathPoints[1]);
                    for (let i = 2; i < pathPoints.length; i += 2) {
                        ctx.lineTo(pathPoints[i], pathPoints[i + 1]);
                    }
                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';
                    ctx.lineWidth = 20; 
                    ctx.stroke();
                    ctx.globalCompositeOperation = 'source-over'; 
                    
                    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const data = imgData.data;
                    let pixelCount = 0;
                    for (let i = 3; i < data.length; i += 4) { if (data[i] > 0) pixelCount++; }

                    let newRealArea = 0;
                    if (projectData && projectData.scale_factor && projectData.scale_factor > 0) {
                        newRealArea = pixelCount / Math.pow(projectData.scale_factor, 2);
                    }
                    let newRealLength = mask.real_length || 0;
                    if (mask.area > 0 && newRealArea < mask.area) {
                        const ratio = newRealArea / mask.area;
                        newRealLength = newRealLength * ratio;
                    }
                    resolve({ ...mask, src: canvas.toDataURL("image/png"), area: newRealArea, real_length: newRealLength, height: mask.height });
                };
                img.onerror = (err) => resolve(mask);
                img.src = mask.src; 
            });
        }));
        setMasks(updatedMasks);
    };

    // --- MOUSE HANDLERS (DRAWING) ---
    const handleMouseDown = (e) => {
        if (mode === 'segregation') return; 

        // CRITICAL CHANGE: Use relative pointer position
        const pos = getRelativePointerPosition(e.target.getStage());
        
        if (mode === 'calibration') {
            setIsDrawing(true);
            setCalibrationLine([pos.x, pos.y, pos.x, pos.y]);
        } 
        else if (mode === 'drawing') {
            if (activeTool === 'eraser') {
                setIsDrawing(true);
                setEraserPath([pos.x, pos.y]);
            } 
            else if (isLinearTool) {
                setIsDrawing(true);
                setOpeningLine([pos.x, pos.y, pos.x, pos.y]);
            }
        }
    };

    const handleMouseMove = (e) => {
        if (mode === 'segregation') return;
        
        // CRITICAL CHANGE: Use relative pointer position
        const pos = getRelativePointerPosition(e.target.getStage());

        if (mode === 'calibration' && isDrawing) {
            setCalibrationLine([calibrationLine[0], calibrationLine[1], pos.x, pos.y]);
        } 
        else if (mode === 'drawing' && isDrawing) {
            if (activeTool === 'eraser') {
                setEraserPath([...eraserPath, pos.x, pos.y]);
            }
            else if (isLinearTool) {
                setOpeningLine([openingLine[0], openingLine[1], pos.x, pos.y]);
            }
        }
    };

    const handleMouseUp = async (e) => {
        if (mode === 'segregation') return;
        setIsDrawing(false);
        const pos = getRelativePointerPosition(e.target.getStage()); // Relative pos

        if (mode === 'calibration') {
            const [x1, y1, x2, y2] = calibrationLine;
            const pxDist = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
            if (pxDist > 5) { // Lower threshold for zoomed out
                const realLen = window.prompt("Enter real length (e.g., 5.0):");
                if (realLen) {
                    try {
                        const res = await axios.post(`${API_BASE}/project/${projectId}/calibrate`, { 
                            px_distance: pxDist, 
                            real_length: parseFloat(realLen) 
                        });
                        setProjectData(prev => ({ ...prev, ...res.data }));
                    } catch (err) { alert("Error calibrating."); }
                }
            }
            setCalibrationLine([]);
        } 
        else if (mode === 'drawing') {
            const getSpecificHeight = () => {
                if (['Windows', 'Doors'].includes(selectedCategory)) {
                    const h = window.prompt(`Enter height for this ${selectedCategory.slice(0, -1)} (m):`, "2.1");
                    return parseFloat(h) || 0;
                }
                return 0; 
            };

            if (activeTool === 'wand') {
                if (isLinearTool) {
                    const [x1, y1, x2, y2] = openingLine;
                    const dist = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
                    if (dist > 5) {
                        try {
                            const res = await axios.post(`${API_BASE}/project/${projectId}/draw-opening`, {
                                p1: [x1, y1],
                                p2: [x2, y2],
                                category: selectedCategory
                            });
                            
                            const itemHeight = getSpecificHeight();

                            setMasks([...masks, { 
                                src: cleanBase64(res.data.mask_image), 
                                category: res.data.category, 
                                area: res.data.real_area,
                                real_length: res.data.real_length,
                                height: itemHeight 
                            }]);
                        } catch (err) { console.error("Line tool failed:", err); }
                    }
                    setOpeningLine([]);
                } 
                else {
                    try {
                        const res = await axios.post(`${API_BASE}/project/${projectId}/magic-wand`, {
                            x: Math.round(pos.x), y: Math.round(pos.y), tolerance, category: selectedCategory
                        });

                        let itemHeight = 0;
                        if (['Windows', 'Doors'].includes(selectedCategory)) {
                             const h = window.prompt(`Enter height for this ${selectedCategory.slice(0, -1)} (m):`, "2.1");
                             itemHeight = parseFloat(h) || 0;
                        }

                        setMasks([...masks, { 
                            src: cleanBase64(res.data.mask_image), 
                            category: res.data.category, 
                            area: res.data.real_area,
                            real_length: res.data.real_length,
                            height: itemHeight 
                        }]);
                    } catch (err) { console.error("Magic Wand failed:", err); }
                }
            } 
            else if (activeTool === 'eraser') {
                await applyEraser(eraserPath);
                setEraserPath([]); 
            }
        }
    };

    // --- RENDER HELPERS ---
    const SimpleMask = ({ src, width, height }) => {
        const [img] = useImage(src);
        return img ? <KonvaImage image={img} width={width} height={height} listening={false} /> : null;
    };

    // --- FIX: RESTORED GRID OVERLAY LOGIC ---
    const GridOverlay = () => {
        const sf = projectData?.scale_factor;
        if (!sf || sf <= 10) return null;

        const width = image.width;
        const height = image.height;
        const lines = [];

        // Vertical lines
        for (let i = 0; i < width / sf; i++) {
            lines.push(<Line key={`v-${i}`} points={[i * sf, 0, i * sf, height]} stroke="rgba(0, 0, 0, 0.15)" strokeWidth={1} />);
        }
        // Horizontal lines
        for (let j = 0; j < height / sf; j++) {
            lines.push(<Line key={`h-${j}`} points={[0, j * sf, width, j * sf]} stroke="rgba(0, 0, 0, 0.15)" strokeWidth={1} />);
        }
        return <Group>{lines}</Group>;
    };

    if (!image) return <div>Loading...</div>;

    return (
        <div className="border shadow-lg bg-gray-100 overflow-hidden" style={{ width: '100%', height: '100vh' }}>
            <Stage 
                width={window.innerWidth} 
                height={window.innerHeight} 
                draggable={activeTool !== 'wand' && activeTool !== 'eraser' && mode !== 'calibration'} 
                onWheel={handleWheel}
                scaleX={stageScale}
                scaleY={stageScale}
                x={stagePos.x}
                y={stagePos.y}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                ref={stageRef}
            >
                <Layer>
                    <KonvaImage image={image} />
                    
                    {mode !== 'calibration' && <GridOverlay />}

                    {/* SEGREGATION MODE */}
                    {mode === 'segregation' && rooms && rooms.map((room) => (
                        <Group key={room.id}>
                            <SimpleMask src={cleanBase64(room.src)} width={image.width} height={image.height} />
                            
                            {/* --- CHANGE START: SMALLER FONT SIZE --- */}
                            <Text 
                                x={room.center.x - 25} 
                                y={room.center.y} 
                                text={`${room.id}\n${room.real_area ? room.real_area.toFixed(1) + ' m²' : ''}\nP: ${room.real_perimeter ? room.real_perimeter.toFixed(1) + ' m' : ''}`}
                                fontSize={14}  // REDUCED FROM 24
                                fontStyle="bold"
                                fill="black"
                                align="center"
                                stroke="white"
                                strokeWidth={2} // REDUCED FROM 4
                            />
                            <Text 
                                x={room.center.x - 25} 
                                y={room.center.y} 
                                text={`${room.id}\n${room.real_area ? room.real_area.toFixed(1) + ' m²' : ''}\nP: ${room.real_perimeter ? room.real_perimeter.toFixed(1) + ' m' : ''}`}
                                fontSize={14}  // REDUCED FROM 24
                                fontStyle="bold"
                                fill="black"
                                align="center"
                            />
                            {/* --- CHANGE END --- */}
                        </Group>
                    ))}

                    {/* DRAWING MODE */}
                    {mode !== 'segregation' && masks.map((mask, i) => (
                        <SimpleMask key={i} src={mask.src} width={image.width} height={image.height} />
                    ))}
                    
                    {/* TOOLS UI */}
                    {mode !== 'segregation' && (
                        <>
                            {mode === 'calibration' && calibrationLine.length > 0 && 
                                <Line points={calibrationLine} stroke="#FF00FF" strokeWidth={5 / stageScale} />
                            }
                            {isDrawing && activeTool === 'eraser' && 
                                <Line points={eraserPath} stroke="rgba(255,0,0,0.5)" strokeWidth={30 / stageScale} lineCap="round" lineJoin="round" />
                            }
                            {isDrawing && isLinearTool && openingLine.length > 0 && (
                                <>
                                    <Line points={openingLine} stroke={selectedCategory === 'Doors' ? '#00FF00' : '#FFA500'} strokeWidth={5 / stageScale} dash={[10, 5]} />
                                    <Circle x={openingLine[0]} y={openingLine[1]} radius={5 / stageScale} fill="white" stroke="black" />
                                    <Circle x={openingLine[2]} y={openingLine[3]} radius={5 / stageScale} fill="white" stroke="black" />
                                </>
                            )}
                        </>
                    )}
                </Layer>
            </Stage>
            
            {/* ZOOM HINT */}
            <div style={{ position: 'absolute', bottom: 20, right: 20, background: 'rgba(0,0,0,0.6)', color: 'white', padding: '10px', borderRadius: '5px', pointerEvents: 'none' }}>
                Mouse Wheel to Zoom • Drag to Pan (when not drawing)
            </div>
        </div>
    );
};

export default CanvasBoard;