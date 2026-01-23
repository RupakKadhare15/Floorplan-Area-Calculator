// import React, { useState, useMemo } from 'react';
// import { Stage, Layer, Image as KonvaImage, Line, Circle, Text, Group } from 'react-konva';
// import useImage from 'use-image';
// import axios from 'axios';

// const CanvasBoard = ({ 
//   mode, projectId, projectData, setProjectData, 
//   activeTool, selectedCategory, masks, setMasks,
//   rooms 
// }) => {
    
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
//                     // Use natural dimensions to ensure 1:1 mapping with the data
//                     canvas.width = img.naturalWidth || img.width;
//                     canvas.height = img.naturalHeight || img.height;
//                     const ctx = canvas.getContext('2d');

//                     // A. Draw the original mask
//                     ctx.drawImage(img, 0, 0);
                    
//                     // B. Set Composite Mode to "Destination-Out" (Erase)
//                     ctx.globalCompositeOperation = 'destination-out';
                    
//                     // C. Draw the Eraser Path
//                     ctx.beginPath();
//                     ctx.moveTo(pathPoints[0], pathPoints[1]);
//                     for (let i = 2; i < pathPoints.length; i += 2) {
//                         ctx.lineTo(pathPoints[i], pathPoints[i + 1]);
//                     }
//                     ctx.lineCap = 'round';
//                     ctx.lineJoin = 'round';
//                     ctx.lineWidth = 20; 
//                     ctx.stroke();

//                     // D. Reset Composite Mode
//                     ctx.globalCompositeOperation = 'source-over'; 
                    
//                     // E. Recalculate Area (Count remaining pixels)
//                     const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
//                     const data = imgData.data;
//                     let pixelCount = 0;

//                     for (let i = 3; i < data.length; i += 4) {
//                         if (data[i] > 0) pixelCount++;
//                     }

//                     // F. Calculate New Real Area
//                     let newRealArea = 0;
//                     if (projectData && projectData.scale_factor && projectData.scale_factor > 0) {
//                         newRealArea = pixelCount / Math.pow(projectData.scale_factor, 2);
//                     }
                    
//                     // --- FIX: Update Real Length Proportionally ---
//                     // Since Walls use Length for calculation, we must reduce length if area is reduced.
//                     let newRealLength = mask.real_length || 0;
//                     if (mask.area > 0 && newRealArea < mask.area) {
//                         const ratio = newRealArea / mask.area;
//                         newRealLength = newRealLength * ratio;
//                     }

//                     // G. Resolve
//                     resolve({
//                         ...mask,
//                         src: canvas.toDataURL("image/png"),
//                         area: newRealArea,
//                         real_length: newRealLength 
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
//                         const res = await axios.post(`http://localhost:8000/project/${projectId}/calibrate`, { 
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
            
//             if (activeTool === 'wand') {
//                 if (isLinearTool) {
//                     const [x1, y1, x2, y2] = openingLine;
//                     const dist = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
//                     if (dist > 5) {
//                         try {
//                             const res = await axios.post(`http://localhost:8000/project/${projectId}/draw-opening`, {
//                                 p1: [x1, y1],
//                                 p2: [x2, y2],
//                                 category: selectedCategory
//                             });
//                             setMasks([...masks, { 
//                                 src: cleanBase64(res.data.mask_image), 
//                                 category: res.data.category, 
//                                 area: res.data.real_area,
//                                 real_length: res.data.real_length
//                             }]);
//                         } catch (err) { console.error("Line tool failed:", err); }
//                     }
//                     setOpeningLine([]);
//                 } 
//                 else {
//                     try {
//                         const res = await axios.post(`http://localhost:8000/project/${projectId}/magic-wand`, {
//                             x: Math.round(pos.x), y: Math.round(pos.y), tolerance, category: selectedCategory
//                         });
//                         setMasks([...masks, { 
//                             src: cleanBase64(res.data.mask_image), 
//                             category: res.data.category, 
//                             area: res.data.real_area,
//                             real_length: res.data.real_length
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

//     return (
//         <div className="border shadow-lg bg-white inline-block">
//             <Stage width={stageWidth} height={stageHeight} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}>
//                 <Layer>
//                     {image && <KonvaImage image={image} />}
                    
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
  rooms,
  // 👇 Receive defaults for the prompt
  defaultDoorHeight,
  defaultWindowHeight
}) => {
    
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
                    // Use natural dimensions to ensure 1:1 mapping
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
                    let pixelCount = 0;
                    for (let i = 3; i < imgData.data.length; i += 4) {
                        if (imgData.data[i] > 0) pixelCount++;
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
                        height: mask.height // Preserve specific height
                    });
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
                        const res = await axios.post(`http://localhost:8000/project/${projectId}/calibrate`, { 
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
            
            if (activeTool === 'wand') {
                if (isLinearTool) {
                    // --- DOORS & WINDOWS ---
                    const [x1, y1, x2, y2] = openingLine;
                    const dist = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
                    
                    if (dist > 5) {
                        try {
                            const res = await axios.post(`http://localhost:8000/project/${projectId}/draw-opening`, {
                                p1: [x1, y1], 
                                p2: [x2, y2],
                                category: selectedCategory,
                                masks: masks // Send masks for width calculation
                            });

                            // 👇 PROMPT FOR HEIGHT
                            const defaultH = selectedCategory === 'Doors' ? defaultDoorHeight : defaultWindowHeight;
                            const userHeight = window.prompt(
                                `Enter height for this ${selectedCategory} (meters):`, 
                                defaultH
                            );
                            const finalHeight = userHeight ? parseFloat(userHeight) : defaultH;

                            setMasks([...masks, { 
                                src: cleanBase64(res.data.mask_image), 
                                category: res.data.category, 
                                area: res.data.real_area,
                                real_length: res.data.real_length,
                                height: finalHeight // Save specific height
                            }]);
                        } catch (err) { console.error("Line tool failed:", err); }
                    }
                    setOpeningLine([]);
                } 
                else {
                    // --- MAGIC WAND ---
                    try {
                        const res = await axios.post(`http://localhost:8000/project/${projectId}/magic-wand`, {
                            x: Math.round(pos.x), y: Math.round(pos.y), tolerance, category: selectedCategory
                        });
                        setMasks([...masks, { 
                            src: cleanBase64(res.data.mask_image), 
                            category: res.data.category, 
                            area: res.data.real_area,
                            real_length: res.data.real_length
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

    // 👇 RESTORED: Use original image dimensions (No Max Width Scaling)
    const stageWidth = image ? image.width : 800;
    const stageHeight = image ? image.height : 600;

    return (
        <div className="border shadow-lg bg-white inline-block">
            <Stage width={stageWidth} height={stageHeight} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}>
                <Layer>
                    {image && <KonvaImage image={image} />}
                    
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