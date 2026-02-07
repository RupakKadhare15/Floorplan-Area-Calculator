// import React, { useState, useMemo } from 'react';
// import { Stage, Layer, Image as KonvaImage, Line, Circle, Text, Group } from 'react-konva';
// import useImage from 'use-image';
// import axios from 'axios';

// const CanvasBoard = ({ 
//   mode, projectId, projectData, setProjectData, 
//   activeTool, selectedCategory, masks, setMasks,
//   rooms 
// }) => {

//     const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:8000";

//     // --- HELPERS ---
//     const cleanBase64 = (data) => {
//         if (!data) return null;
//         let clean = data.replace(/^data:image\/\w+;base64,/, '').replace(/(\r\n|\n|\r)/gm, "");
//         return `data:image/png;base64,${clean}`;
//     };

//     const imageSrc = useMemo(() => 
//         projectData?.image_data ? cleanBase64(projectData.image_data) : null, 
//     [projectData]);

//     const [image] = useImage(imageSrc);
    
//     // --- STATE ---
//     const [calibrationLine, setCalibrationLine] = useState([]);
//     const [isDrawing, setIsDrawing] = useState(false);
//     const [eraserPath, setEraserPath] = useState([]); 
//     const [openingLine, setOpeningLine] = useState([]); 
//     const [tolerance] = useState(40);

//     const isLinearTool = useMemo(() => {
//         return ['Doors', 'Windows'].includes(selectedCategory) && activeTool === 'wand';
//     }, [selectedCategory, activeTool]);

//     // --- ERASER LOGIC ---
//     const applyEraser = async (pathPoints) => {
//         if (!pathPoints || pathPoints.length < 2) return;

//         const updatedMasks = await Promise.all(masks.map(async (mask) => {
//             if (mask.category !== selectedCategory) return mask;

//             return new Promise((resolve) => {
//                 const img = new Image();
                
//                 img.onload = () => {
//                     const canvas = document.createElement('canvas');
//                     canvas.width = img.naturalWidth || img.width;
//                     canvas.height = img.naturalHeight || img.height;
//                     const ctx = canvas.getContext('2d');

//                     ctx.drawImage(img, 0, 0);
                    
//                     ctx.globalCompositeOperation = 'destination-out';
                    
//                     ctx.beginPath();
//                     ctx.moveTo(pathPoints[0], pathPoints[1]);
//                     for (let i = 2; i < pathPoints.length; i += 2) {
//                         ctx.lineTo(pathPoints[i], pathPoints[i + 1]);
//                     }
//                     ctx.lineCap = 'round';
//                     ctx.lineJoin = 'round';
//                     ctx.lineWidth = 20; 
//                     ctx.stroke();

//                     ctx.globalCompositeOperation = 'source-over'; 
                    
//                     const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
//                     const data = imgData.data;
//                     let pixelCount = 0;

//                     for (let i = 3; i < data.length; i += 4) {
//                         if (data[i] > 0) pixelCount++;
//                     }

//                     let newRealArea = 0;
//                     if (projectData && projectData.scale_factor && projectData.scale_factor > 0) {
//                         newRealArea = pixelCount / Math.pow(projectData.scale_factor, 2);
//                     }
                    
//                     let newRealLength = mask.real_length || 0;
//                     if (mask.area > 0 && newRealArea < mask.area) {
//                         const ratio = newRealArea / mask.area;
//                         newRealLength = newRealLength * ratio;
//                     }

//                     resolve({
//                         ...mask,
//                         src: canvas.toDataURL("image/png"),
//                         area: newRealArea,
//                         real_length: newRealLength,
//                         height: mask.height 
//                     });
//                 };

//                 img.onerror = (err) => {
//                     console.error("Eraser: Image load failed", err);
//                     resolve(mask);
//                 };

//                 img.src = mask.src; 
//             });
//         }));

//         setMasks(updatedMasks);
//     };

//     // --- MOUSE HANDLERS ---
//     const handleMouseDown = (e) => {
//         if (mode === 'segregation') return; 

//         const pos = e.target.getStage().getPointerPosition();
        
//         if (mode === 'calibration') {
//             setIsDrawing(true);
//             setCalibrationLine([pos.x, pos.y, pos.x, pos.y]);
//         } 
//         else if (mode === 'drawing') {
//             if (activeTool === 'eraser') {
//                 setIsDrawing(true);
//                 setEraserPath([pos.x, pos.y]);
//             } 
//             else if (isLinearTool) {
//                 setIsDrawing(true);
//                 setOpeningLine([pos.x, pos.y, pos.x, pos.y]);
//             }
//         }
//     };

//     const handleMouseMove = (e) => {
//         if (mode === 'segregation') return;

//         const pos = e.target.getStage().getPointerPosition();

//         if (mode === 'calibration' && isDrawing) {
//             setCalibrationLine([calibrationLine[0], calibrationLine[1], pos.x, pos.y]);
//         } 
//         else if (mode === 'drawing' && isDrawing) {
//             if (activeTool === 'eraser') {
//                 setEraserPath([...eraserPath, pos.x, pos.y]);
//             }
//             else if (isLinearTool) {
//                 setOpeningLine([openingLine[0], openingLine[1], pos.x, pos.y]);
//             }
//         }
//     };

//     const handleMouseUp = async (e) => {
//         if (mode === 'segregation') return;
//         setIsDrawing(false);

//         if (mode === 'calibration') {
//             const [x1, y1, x2, y2] = calibrationLine;
//             const pxDist = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
//             if (pxDist > 10) {
//                 const realLen = window.prompt("Enter real length (e.g., 5.0):");
//                 if (realLen) {
//                     try {
//                         const res = await axios.post(`${API_BASE}/project/${projectId}/calibrate`, { 
//                             px_distance: pxDist, 
//                             real_length: parseFloat(realLen) 
//                         });
//                         setProjectData(prev => ({ ...prev, ...res.data }));
//                         alert("Calibrated!");
//                     } catch (err) { alert("Error calibrating."); }
//                 }
//             }
//             setCalibrationLine([]);
//         } 
//         else if (mode === 'drawing') {
//             const pos = e.target.getStage().getPointerPosition();
            
//             const getSpecificHeight = () => {
//                 if (['Windows', 'Doors'].includes(selectedCategory)) {
//                     const h = window.prompt(`Enter height for this ${selectedCategory.slice(0, -1)} (m):`, "2.1");
//                     return parseFloat(h) || 0;
//                 }
//                 return 0; 
//             };

//             if (activeTool === 'wand') {
//                 if (isLinearTool) {
//                     const [x1, y1, x2, y2] = openingLine;
//                     const dist = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
//                     if (dist > 5) {
//                         try {
//                             const res = await axios.post(`${API_BASE}/project/${projectId}/draw-opening`, {
//                                 p1: [x1, y1],
//                                 p2: [x2, y2],
//                                 category: selectedCategory
//                             });
                            
//                             const itemHeight = getSpecificHeight();

//                             setMasks([...masks, { 
//                                 src: cleanBase64(res.data.mask_image), 
//                                 category: res.data.category, 
//                                 area: res.data.real_area,
//                                 real_length: res.data.real_length,
//                                 height: itemHeight 
//                             }]);
//                         } catch (err) { console.error("Line tool failed:", err); }
//                     }
//                     setOpeningLine([]);
//                 } 
//                 else {
//                     try {
//                         const res = await axios.post(`${API_BASE}/project/${projectId}/magic-wand`, {
//                             x: Math.round(pos.x), y: Math.round(pos.y), tolerance, category: selectedCategory
//                         });

//                         let itemHeight = 0;
//                         if (['Windows', 'Doors'].includes(selectedCategory)) {
//                              const h = window.prompt(`Enter height for this ${selectedCategory.slice(0, -1)} (m):`, "2.1");
//                              itemHeight = parseFloat(h) || 0;
//                         }

//                         setMasks([...masks, { 
//                             src: cleanBase64(res.data.mask_image), 
//                             category: res.data.category, 
//                             area: res.data.real_area,
//                             real_length: res.data.real_length,
//                             height: itemHeight 
//                         }]);
//                     } catch (err) { console.error("Magic Wand failed:", err); }
//                 }
//             } 
//             else if (activeTool === 'eraser') {
//                 await applyEraser(eraserPath);
//                 setEraserPath([]); 
//             }
//         }
//     };

//     // --- RENDER HELPERS ---
//     const SimpleMask = ({ src, width, height }) => {
//         const [img] = useImage(src);
//         return img ? <KonvaImage image={img} width={width} height={height} listening={false} /> : null;
//     };

//     const stageWidth = image ? image.width : 800;
//     const stageHeight = image ? image.height : 600;

//     // --- IMPROVEMENT: GRID RENDERER ---
//     const GridOverlay = () => {
//         // Only render if we have a valid scale factor (pixels per meter)
//         const sf = projectData?.scale_factor;
//         if (!sf || sf <= 10) return null; // Avoid crashing with too many lines if SF is tiny

//         const width = stageWidth;
//         const height = stageHeight;
//         const lines = [];

//         // Vertical lines
//         for (let i = 0; i < width / sf; i++) {
//             lines.push(
//                 <Line 
//                     key={`v-${i}`}
//                     points={[i * sf, 0, i * sf, height]}
//                     stroke="rgba(0, 0, 0, 0.15)"
//                     strokeWidth={1}
//                 />
//             );
//         }

//         // Horizontal lines
//         for (let j = 0; j < height / sf; j++) {
//             lines.push(
//                 <Line 
//                     key={`h-${j}`}
//                     points={[0, j * sf, width, j * sf]}
//                     stroke="rgba(0, 0, 0, 0.15)"
//                     strokeWidth={1}
//                 />
//             );
//         }

//         return <Group>{lines}</Group>;
//     };

//     return (
//         <div className="border shadow-lg bg-white inline-block">
//             <Stage width={stageWidth} height={stageHeight} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}>
//                 <Layer>
//                     {image && <KonvaImage image={image} />}
                    
//                     {/* --- RENDER GRID IF CALIBRATED --- */}
//                     {mode !== 'calibration' && <GridOverlay />}

//                     {/* MODE 1: SEGREGATION (SHOW ROOMS) */}
//                     {mode === 'segregation' && rooms && rooms.map((room) => (
//                         <Group key={room.id}>
//                             <SimpleMask src={cleanBase64(room.src)} width={stageWidth} height={stageHeight} />
//                             <Text 
//                                 x={room.center.x - 25} 
//                                 y={room.center.y} 
//                                 text={`${room.id}\n${room.real_area ? room.real_area.toFixed(1) + ' m²' : ''}`}
//                                 fontSize={18}
//                                 fontStyle="bold"
//                                 fill="black"
//                                 align="center"
//                                 stroke="white"
//                                 strokeWidth={2}
//                             />
//                             <Text 
//                                 x={room.center.x - 25} 
//                                 y={room.center.y} 
//                                 text={`${room.id}\n${room.real_area ? room.real_area.toFixed(1) + ' m²' : ''}`}
//                                 fontSize={18}
//                                 fontStyle="bold"
//                                 fill="black"
//                                 align="center"
//                             />
//                         </Group>
//                     ))}

//                     {/* MODE 2: STANDARD DRAWING (SHOW MASKS) */}
//                     {mode !== 'segregation' && masks.map((mask, i) => (
//                         <SimpleMask key={i} src={mask.src} width={stageWidth} height={stageHeight} />
//                     ))}
                    
//                     {/* HELPER LINES */}
//                     {mode !== 'segregation' && (
//                         <>
//                             {mode === 'calibration' && calibrationLine.length > 0 && 
//                                 <Line points={calibrationLine} stroke="#FF00FF" strokeWidth={4} />
//                             }
//                             {isDrawing && activeTool === 'eraser' && 
//                                 <Line points={eraserPath} stroke="rgba(255,0,0,0.5)" strokeWidth={20} lineCap="round" lineJoin="round" />
//                             }
//                             {isDrawing && isLinearTool && openingLine.length > 0 && (
//                                 <>
//                                     <Line points={openingLine} stroke={selectedCategory === 'Doors' ? '#00FF00' : '#FFA500'} strokeWidth={4} dash={[10, 5]} />
//                                     <Circle x={openingLine[0]} y={openingLine[1]} radius={4} fill="white" stroke="black" />
//                                     <Circle x={openingLine[2]} y={openingLine[3]} radius={4} fill="white" stroke="black" />
//                                 </>
//                             )}
//                         </>
//                     )}
//                 </Layer>
//             </Stage>
//         </div>
//     );
// };

// export default CanvasBoard;

import React, { useState, useMemo } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Circle, Text, Group } from 'react-konva';
import useImage from 'use-image';
import axios from 'axios';

const CanvasBoard = ({ 
  mode, projectId, projectData, setProjectData, 
  activeTool, selectedCategory, masks, setMasks,
  rooms 
}) => {

    const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:8000";

    // --- HELPERS ---
    const cleanBase64 = (data) => {
        if (!data) return null;
        let clean = data.replace(/^data:image\/\w+;base64,/, '').replace(/(\r\n|\n|\r)/gm, "");
        return `data:image/png;base64,${clean}`;
    };

    const imageSrc = useMemo(() => 
        projectData?.image_data ? cleanBase64(projectData.image_data) : null, 
    [projectData]);

    const [image] = useImage(imageSrc);
    
    // --- STATE ---
    const [calibrationLine, setCalibrationLine] = useState([]);
    const [isDrawing, setIsDrawing] = useState(false);
    const [eraserPath, setEraserPath] = useState([]); 
    const [openingLine, setOpeningLine] = useState([]); 
    const [tolerance] = useState(40);

    const isLinearTool = useMemo(() => {
        return ['Doors', 'Windows'].includes(selectedCategory) && activeTool === 'wand';
    }, [selectedCategory, activeTool]);

    // --- ERASER LOGIC ---
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

                    for (let i = 3; i < data.length; i += 4) {
                        if (data[i] > 0) pixelCount++;
                    }

                    let newRealArea = 0;
                    if (projectData && projectData.scale_factor && projectData.scale_factor > 0) {
                        newRealArea = pixelCount / Math.pow(projectData.scale_factor, 2);
                    }
                    
                    let newRealLength = mask.real_length || 0;
                    if (mask.area > 0 && newRealArea < mask.area) {
                        const ratio = newRealArea / mask.area;
                        newRealLength = newRealLength * ratio;
                    }

                    resolve({
                        ...mask,
                        src: canvas.toDataURL("image/png"),
                        area: newRealArea,
                        real_length: newRealLength,
                        height: mask.height 
                    });
                };

                img.onerror = (err) => {
                    console.error("Eraser: Image load failed", err);
                    resolve(mask);
                };

                img.src = mask.src; 
            });
        }));

        setMasks(updatedMasks);
    };

    // --- MOUSE HANDLERS ---
    const handleMouseDown = (e) => {
        if (mode === 'segregation') return; 

        const pos = e.target.getStage().getPointerPosition();
        
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

        const pos = e.target.getStage().getPointerPosition();

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
                        alert("Calibrated!");
                    } catch (err) { alert("Error calibrating."); }
                }
            }
            setCalibrationLine([]);
        } 
        else if (mode === 'drawing') {
            const pos = e.target.getStage().getPointerPosition();
            
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

    const stageWidth = image ? image.width : 800;
    const stageHeight = image ? image.height : 600;

    // --- IMPROVEMENT: GRID RENDERER ---
    const GridOverlay = () => {
        // Only render if we have a valid scale factor (pixels per meter)
        const sf = projectData?.scale_factor;
        if (!sf || sf <= 10) return null; // Avoid crashing with too many lines if SF is tiny

        const width = stageWidth;
        const height = stageHeight;
        const lines = [];

        // Vertical lines
        for (let i = 0; i < width / sf; i++) {
            lines.push(
                <Line 
                    key={`v-${i}`}
                    points={[i * sf, 0, i * sf, height]}
                    stroke="rgba(0, 0, 0, 0.15)"
                    strokeWidth={1}
                />
            );
        }

        // Horizontal lines
        for (let j = 0; j < height / sf; j++) {
            lines.push(
                <Line 
                    key={`h-${j}`}
                    points={[0, j * sf, width, j * sf]}
                    stroke="rgba(0, 0, 0, 0.15)"
                    strokeWidth={1}
                />
            );
        }

        return <Group>{lines}</Group>;
    };

    return (
        <div className="border shadow-lg bg-white inline-block">
            <Stage width={stageWidth} height={stageHeight} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}>
                <Layer>
                    {image && <KonvaImage image={image} />}
                    
                    {/* --- RENDER GRID IF CALIBRATED --- */}
                    {mode !== 'calibration' && <GridOverlay />}

                    {/* MODE 1: SEGREGATION (SHOW ROOMS) */}
                    {mode === 'segregation' && rooms && rooms.map((room) => (
                        <Group key={room.id}>
                            <SimpleMask src={cleanBase64(room.src)} width={stageWidth} height={stageHeight} />
                            <Text 
                                x={room.center.x - 25} 
                                y={room.center.y} 
                                text={`${room.id}\n${room.real_area ? room.real_area.toFixed(1) + ' m²' : ''}`}
                                fontSize={18}
                                fontStyle="bold"
                                fill="black"
                                align="center"
                                stroke="white"
                                strokeWidth={2}
                            />
                            <Text 
                                x={room.center.x - 25} 
                                y={room.center.y} 
                                text={`${room.id}\n${room.real_area ? room.real_area.toFixed(1) + ' m²' : ''}`}
                                fontSize={18}
                                fontStyle="bold"
                                fill="black"
                                align="center"
                            />
                        </Group>
                    ))}

                    {/* MODE 2: STANDARD DRAWING (SHOW MASKS) */}
                    {mode !== 'segregation' && masks.map((mask, i) => (
                        <SimpleMask key={i} src={mask.src} width={stageWidth} height={stageHeight} />
                    ))}
                    
                    {/* HELPER LINES */}
                    {mode !== 'segregation' && (
                        <>
                            {mode === 'calibration' && calibrationLine.length > 0 && 
                                <Line points={calibrationLine} stroke="#FF00FF" strokeWidth={4} />
                            }
                            {isDrawing && activeTool === 'eraser' && 
                                <Line points={eraserPath} stroke="rgba(255,0,0,0.5)" strokeWidth={20} lineCap="round" lineJoin="round" />
                            }
                            {isDrawing && isLinearTool && openingLine.length > 0 && (
                                <>
                                    <Line points={openingLine} stroke={selectedCategory === 'Doors' ? '#00FF00' : '#FFA500'} strokeWidth={4} dash={[10, 5]} />
                                    <Circle x={openingLine[0]} y={openingLine[1]} radius={4} fill="white" stroke="black" />
                                    <Circle x={openingLine[2]} y={openingLine[3]} radius={4} fill="white" stroke="black" />
                                </>
                            )}
                        </>
                    )}
                </Layer>
            </Stage>
        </div>
    );
};

export default CanvasBoard;