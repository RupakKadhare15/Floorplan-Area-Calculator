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
    const [minScale, setMinScale] = useState(0.1);

    // --- 3. AUTO-FIT IMAGE ON LOAD ---
    useEffect(() => {
        if (image) {
            const w = window.innerWidth - 300; // Subtract sidebar width
            const h = window.innerHeight - 50;
            
            // Calculate scale to fit image completely in view
            const fitScale = Math.min(w / image.width, h / image.height); 

            setStageScale(fitScale);
            setMinScale(fitScale * 0.5); // Allow zooming out a bit further
        }
    }, [image]);

    // --- 4. MOUSE HANDLERS (ZOOM) ---
    const handleWheel = (e) => {
        e.evt.preventDefault();
        const scaleBy = 1.1;
        const oldScale = stageScale;
        
        let newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;

        // Zoom Constraints
        const MAX_SCALE = 5; 
        if (newScale > MAX_SCALE) newScale = MAX_SCALE;
        if (newScale < minScale) newScale = minScale;
        
        setStageScale(newScale);
    };

    // Helper: Get REAL image coordinates (ignoring zoom/scroll)
    const getRelativePointerPosition = (node) => {
        const transform = node.getAbsoluteTransform().copy();
        transform.invert();
        const pos = node.getStage().getPointerPosition();
        return transform.point(pos);
    };

    // --- 5. ERASER LOGIC ---
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
                img.onerror = () => resolve(mask);
                img.src = mask.src; 
            });
        }));
        setMasks(updatedMasks);
    };

    // --- 6. MOUSE HANDLERS (DRAWING) ---
    const [calibrationLine, setCalibrationLine] = useState([]);
    const [isDrawing, setIsDrawing] = useState(false);
    const [eraserPath, setEraserPath] = useState([]); 
    const [openingLine, setOpeningLine] = useState([]); 
    const [tolerance] = useState(40);

    const isLinearTool = useMemo(() => {
        return ['Doors', 'Windows'].includes(selectedCategory) && activeTool === 'wand';
    }, [selectedCategory, activeTool]);

    const handleMouseDown = (e) => {
        if (mode === 'segregation') return; 
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
        if (mode === 'segregation' || !isDrawing) return;
        const pos = getRelativePointerPosition(e.target.getStage());

        if (mode === 'calibration') {
            setCalibrationLine([calibrationLine[0], calibrationLine[1], pos.x, pos.y]);
        } 
        else if (mode === 'drawing') {
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

        if (mode === 'calibration') {
            const [x1, y1, x2, y2] = calibrationLine;
            const pxDist = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
            if (pxDist > 10) {
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
            if (activeTool === 'wand') {
                if (isLinearTool) {
                    const [x1, y1, x2, y2] = openingLine;
                    if (Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2)) > 5) {
                        try {
                            const res = await axios.post(`${API_BASE}/project/${projectId}/draw-opening`, {
                                p1: [x1, y1], p2: [x2, y2], category: selectedCategory
                            });
                            const h = parseFloat(window.prompt(`Enter height (m):`, "2.1")) || 0;
                            setMasks([...masks, { 
                                src: cleanBase64(res.data.mask_image), 
                                category: res.data.category, 
                                real_length: res.data.real_length,
                                height: h 
                            }]);
                        } catch (err) { console.error("Line tool failed:", err); }
                    }
                    setOpeningLine([]);
                } 
                else {
                    const pos = getRelativePointerPosition(e.target.getStage());
                    try {
                        const res = await axios.post(`${API_BASE}/project/${projectId}/magic-wand`, {
                            x: Math.round(pos.x), y: Math.round(pos.y), tolerance, category: selectedCategory
                        });
                        let h = (['Windows', 'Doors'].includes(selectedCategory)) ? (parseFloat(window.prompt(`Enter height (m):`, "2.1")) || 0) : 0;
                        setMasks([...masks, { 
                            src: cleanBase64(res.data.mask_image), 
                            category: res.data.category, 
                            real_length: res.data.real_length,
                            area: res.data.real_area,
                            height: h 
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

    // --- 7. RENDER HELPERS ---
    const SimpleMask = ({ src, width, height }) => {
        const [img] = useImage(src);
        return img ? <KonvaImage image={img} width={width} height={height} listening={false} /> : null;
    };

    const GridOverlay = () => {
        const sf = projectData?.scale_factor;
        if (!sf || sf <= 10) return null;
        const width = image.width;
        const height = image.height;
        const lines = [];
        for (let i = 0; i < width / sf; i++) {
            lines.push(<Line key={`v-${i}`} points={[i * sf, 0, i * sf, height]} stroke="rgba(0, 0, 0, 0.15)" strokeWidth={1} />);
        }
        for (let j = 0; j < height / sf; j++) {
            lines.push(<Line key={`h-${j}`} points={[0, j * sf, width, j * sf]} stroke="rgba(0, 0, 0, 0.15)" strokeWidth={1} />);
        }
        return <Group>{lines}</Group>;
    };

    if (!image) return <div>Loading floor plan...</div>;

    // Trigger standard browser scrollbars by making stage size match zoomed image
    const displayWidth = image.width * stageScale;
    const displayHeight = image.height * stageScale;

    return (
        <div className="stage-container">
            <Stage 
                width={displayWidth} 
                height={displayHeight} 
                scaleX={stageScale}
                scaleY={stageScale}
                onWheel={handleWheel}
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
                            {/* UPDATED: Added Walls to the text label */}
                            <Text 
                                x={room.center.x - 25} 
                                y={room.center.y} 
                                text={`${room.id}\n${room.real_area?.toFixed(1)} m²\nP: ${room.real_perimeter?.toFixed(1)} m\nWalls: ${room.wall_count || 0}`}
                                fontSize={14 / stageScale}
                                fontStyle="bold"
                                fill="black"
                                align="center"
                                stroke="black"
                                strokeWidth={1 / stageScale}
                            />
                        </Group>
                    ))}

                    {/* DRAWING MODE */}
                    {mode !== 'segregation' && masks.map((mask, i) => (
                        <SimpleMask key={i} src={mask.src} width={image.width} height={image.height} />
                    ))}
                    
                    {/* HELPERS */}
                    {mode !== 'segregation' && (
                        <>
                            {mode === 'calibration' && calibrationLine.length > 0 && 
                                <Line points={calibrationLine} stroke="#FF00FF" strokeWidth={4 / stageScale} />
                            }
                            {isDrawing && activeTool === 'eraser' && 
                                <Line points={eraserPath} stroke="rgba(255,0,0,0.5)" strokeWidth={25 / stageScale} lineCap="round" lineJoin="round" />
                            }
                            {isDrawing && isLinearTool && (
                                <Line points={openingLine} stroke={selectedCategory === 'Doors' ? '#00FF00' : '#FFA500'} strokeWidth={4 / stageScale} dash={[10, 5]} />
                            )}
                        </>
                    )}
                </Layer>
            </Stage>
        </div>
    );
};

export default CanvasBoard;