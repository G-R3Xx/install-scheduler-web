// src/components/SurveyAnnotator.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Box, Button, ToggleButton, ToggleButtonGroup, TextField } from '@mui/material';
import {
  Stage,
  Layer,
  Image as KImage,
  Rect,
  Arrow,
  Text as KText,   // alias to avoid collisions
  Transformer,
  Group,
  Label,
  Tag,
  Circle,
} from 'react-konva';
import { v4 as uuid } from 'uuid';

// Load image as HTMLImageElement with "loaded" flag
function useLoadedImage(fileOrUrl) {
  const objectUrl = useMemo(() => {
    if (!fileOrUrl) return null;
    if (typeof fileOrUrl === 'string') return fileOrUrl;
    return URL.createObjectURL(fileOrUrl);
  }, [fileOrUrl]);

  const [img, setImg] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setImg(null);
    setLoaded(false);
    if (!objectUrl) return;

    const image = new window.Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      setImg(image);
      setLoaded(true);
    };
    image.onerror = () => {
      setImg(null);
      setLoaded(false);
    };
    image.src = objectUrl;

    return () => {
      if (fileOrUrl && typeof fileOrUrl !== 'string') URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl, fileOrUrl]);

  return { img, loaded };
}

const midPoint = (pts) => ({ x: (pts[0] + pts[2]) / 2, y: (pts[1] + pts[3]) / 2 });

export default function SurveyAnnotator({ file, tools = [], onSave }) {
  const stageRef = useRef(null);
  const trRef = useRef(null);
  const containerRef = useRef(null);

  const { img: bgImage, loaded: imgLoaded } = useLoadedImage(file);

  // Default tool → 'arrow'
  const [tool, setTool] = useState('arrow');
  const [color, setColor] = useState('#ff0000');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [fontSize, setFontSize] = useState(18);

  // shapes: { id, type: 'rect'|'text'|'arrow', ... , measure?: number, text?: string }
  const [shapes, setShapes] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  const [isDrawing, setIsDrawing] = useState(false);
  const [startPt, setStartPt] = useState(null);
  const [stageSize, setStageSize] = useState({ w: 900, h: 600 });

  // Resize stage to container when image loads
  useEffect(() => {
    if (!imgLoaded || !bgImage || !containerRef.current) return;
    const maxW = containerRef.current.clientWidth || 1000;
    const scale = Math.min(1, maxW / bgImage.width);
    setStageSize({
      w: Math.round(bgImage.width * scale),
      h: Math.round(bgImage.height * scale),
    });
  }, [imgLoaded, bgImage]);

  // Clear shapes when a new file is chosen
  useEffect(() => {
    setShapes([]);
    setSelectedId(null);
  }, [file]);

  // Delete key for selected
  useEffect(() => {
    const onKey = (e) => {
      if (!selectedId) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        setShapes((s) => s.filter((x) => x.id !== selectedId));
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  // Transformer only for rect/text (arrows use anchors)
  useEffect(() => {
    const tr = trRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    const sel = shapes.find((x) => x.id === selectedId);
    if (!sel || sel.type === 'arrow') {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
      return;
    }
    const node = stage.findOne(`#${selectedId}`);
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, shapes]);

  // Start a new shape based on current tool
  const startShape = useCallback(
    (pos) => {
      const id = uuid();
      if (tool === 'arrow') {
        return {
          id,
          type: 'arrow',
          points: [pos.x, pos.y, pos.x, pos.y],
          color,
          strokeWidth,
          measure: null,
        };
      }
      if (tool === 'rect') {
        return {
          id,
          type: 'rect',
          x: pos.x,
          y: pos.y,
          width: 0,
          height: 0,
          color,
          strokeWidth,
          draggable: true,
          text: '',      // text box content
          fontSize,      // text size for box label
        };
      }
      if (tool === 'text') {
        return {
          id,
          type: 'text',
          x: pos.x,
          y: pos.y,
          text: '',
          color,
          fontSize,
          draggable: true,
        };
      }
      return null;
    },
    [tool, color, strokeWidth, fontSize]
  );

  // Helper: prompt to set/edit text for a rectangle
  const promptRectText = (shape) => {
    const current = shape.text || '';
    const label = window.prompt('Enter text for this box:', current);
    if (label === null) return; // cancelled
    setShapes((arr) => arr.map((s) => (s.id === shape.id ? { ...s, text: label } : s)));
  };

  // ------- Mouse handlers -------
  const handleMouseDown = (e) => {
    const stage = e.target.getStage();
    const clickedOnEmpty = e.target === stage;

    // Click on shape: select it (do not start a new one)
    if (!clickedOnEmpty) {
      const id = e.target.id?.();
      if (id) setSelectedId(id);
      return;
    }

    if (!bgImage) return;
    const pos = stage.getPointerPosition();

    if (tool === 'text') {
      const label = window.prompt('Enter text:');
      if (!label) return;
      const id = uuid();
      setShapes((s) => [
        ...s,
        { id, type: 'text', x: pos.x, y: pos.y, text: label, fontSize, color, draggable: true },
      ]);
      setSelectedId(id);
      return;
    }

    setIsDrawing(true);
    setStartPt(pos);
    const newShape = startShape(pos);
    if (newShape) {
      setShapes((s) => [...s, newShape]);
      setSelectedId(newShape.id);
    }
  };

  const handleMouseMove = (e) => {
    if (!isDrawing || !startPt) return;
    const pos = e.target.getStage().getPointerPosition();
    setShapes((prev) => {
      const next = [...prev];
      const curr = next[next.length - 1];
      if (!curr) return next;

      if (curr.type === 'arrow') {
        curr.points = [startPt.x, startPt.y, pos.x, pos.y];
      } else if (curr.type === 'rect') {
        curr.width = pos.x - startPt.x;
        curr.height = pos.y - startPt.y;
      }
      return next;
    });
  };

  const handleMouseUp = () => {
    // If we've just drawn a rect, prompt to add text immediately
    if (isDrawing && tool === 'rect') {
      setShapes((arr) =>
        arr.map((s) => {
          if (s.id !== selectedId || s.type !== 'rect') return s;
          if (Math.abs(s.width) < 2 && Math.abs(s.height) < 2) return s;
          const current = s.text || '';
          const label = window.prompt('Enter text for this box:', current);
          return { ...s, text: label ?? current };
        })
      );
    }
    setIsDrawing(false);
    setStartPt(null);
  };

  // ------- Helpers -------
  const updateSelected = (patch) => {
    setShapes((arr) => arr.map((s) => (s.id === selectedId ? { ...s, ...patch } : s)));
  };

  const onTransformEnd = (e, shape) => {
    const node = e.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    if (shape.type === 'rect') {
      const newAttrs = {
        x: node.x(),
        y: node.y(),
        width: Math.max(1, node.width() * scaleX),
        height: Math.max(1, node.height() * scaleY),
      };
      node.scaleX(1);
      node.scaleY(1);
      updateSelected(newAttrs);
    } else if (shape.type === 'text') {
      updateSelected({ x: node.x(), y: node.y() });
    }
  };

  // --- Endpoint anchors for ARROW ---
  const Anchor = ({ x, y, onDragMove, onMouseDown }) => (
  <Circle
    x={x}
    y={y}
    radius={10}                 // nice big hit area
    fill="#00b7ff"
    stroke="white"
    strokeWidth={1}
    draggable
    onMouseDown={(e) => { e.cancelBubble = true; onMouseDown?.(e); }}
    onDragMove={(e) => {
      e.cancelBubble = true;
      const stage = e.target.getStage();
      const pos = stage.getPointerPosition();   // <-- always accurate
      // keep the handle exactly under the cursor
      e.target.position(pos);
      // notify parent with true stage coords
      onDragMove({ x: pos.x, y: pos.y });
    }}
    onDragStart={(e) => { e.cancelBubble = true; }}
    onDragEnd={(e) => { e.cancelBubble = true; }}
  />
);


  const renderArrowWithAnchors = (s) => {
    const [x1, y1, x2, y2] = s.points;
    const mid = midPoint(s.points);

    const setEnd = (which, nx, ny) => {
      setShapes((arr) =>
        arr.map((sh) => {
          if (sh.id !== s.id) return sh;
          const pts = [...sh.points];
          if (which === 'start') {
            pts[0] = nx; pts[1] = ny;
          } else {
            pts[2] = nx; pts[3] = ny;
          }
          return { ...sh, points: pts };
        })
      );
    };

    return (
      <>
        <Arrow
          id={s.id}
          key={s.id}
          points={s.points}
          stroke={s.color}
          fill={s.color}
          strokeWidth={s.strokeWidth}
          pointerLength={12}
          pointerWidth={12}
          pointerAtBeginning
          hitStrokeWidth={20}                 // easier to select
          onMouseDown={(e) => { e.cancelBubble = true; setSelectedId(s.id); }}
          onClick={(e) => { e.cancelBubble = true; setSelectedId(s.id); }}
          onTap={() => setSelectedId(s.id)}
        />

        {/* Center measurement bubble */}
        <Group
          x={mid.x}
          y={mid.y}
          onMouseDown={(e) => { e.cancelBubble = true; }}
          onClick={(e) => {
            e.cancelBubble = true;
            const v = window.prompt('Enter measurement (mm):', s.measure != null ? String(s.measure) : '');
            if (v == null) return;
            const n = Number(v);
            setShapes((arr) =>
              arr.map((sh) => (sh.id === s.id ? { ...sh, measure: Number.isFinite(n) ? n : null } : sh))
            );
          }}
        >
          {(selectedId === s.id || s.measure == null) && (
            <Label offsetX={14} offsetY={14}>
              <Tag fill="rgba(0,0,0,0.55)" stroke="#fff" cornerRadius={14} />
              <KText text="?" fontSize={14} fill="#fff" padding={6} />
            </Label>
          )}
        </Group>

        {s.measure != null && (
          <KText
            text={`${s.measure} mm`}
            x={mid.x}
            y={mid.y - (fontSize + 6)}
            offsetX={`${s.measure} mm`.length * (fontSize * 0.25)}
            fontSize={fontSize}
            fill={s.color}
            listening={false}
          />
        )}

        {/* End anchors */}
        {selectedId === s.id && (
          <>
            <Anchor
  x={x1}
  y={y1}
  onMouseDown={() => setSelectedId(s.id)}
  onDragMove={({ x, y }) => setEnd('start', x, y)}
/>
<Anchor
  x={x2}
  y={y2}
  onMouseDown={() => setSelectedId(s.id)}
  onDragMove={({ x, y }) => setEnd('end', x, y)}
/>
          </>
        )}
      </>
    );
  };

  const save = async () => {
    const stage = stageRef.current;
    if (!stage) return;
    const stageJSON = stage.toJSON();
    const blob = await new Promise((res) => stage.toCanvas().toBlob(res, 'image/png'));
    onSave?.({ stageJSON: JSON.parse(stageJSON), annotatedBlob: blob });
    alert('Annotation saved for this sign.');
  };

  const selectedShape = shapes.find((s) => s.id === selectedId);

  return (
    <Box ref={containerRef} sx={{ border: '1px solid #555', borderRadius: 1, p: 1, display: 'grid', gap: 8 }}>
      {/* Toolbar */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <ToggleButtonGroup size="small" exclusive value={tool} onChange={(_, v) => v && setTool(v)}>
          {tools.includes('text') && <ToggleButton value="text">Text</ToggleButton>}
          {tools.includes('rect') && <ToggleButton value="rect">Rect</ToggleButton>}
          {tools.includes('arrow') && <ToggleButton value="arrow">↔︎ Arrow</ToggleButton>}
        </ToggleButtonGroup>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          New color:
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            style={{ width: 32, height: 24, padding: 0, border: 'none', background: 'transparent' }}
          />
        </label>
        <TextField
          label="New stroke"
          type="number"
          size="small"
          value={strokeWidth}
          onChange={(e) => setStrokeWidth(Math.max(1, Number(e.target.value) || 1))}
          inputProps={{ min: 1, style: { width: 60 } }}
        />
        {tool === 'text' && (
          <TextField
            label="New font"
            type="number"
            size="small"
            value={fontSize}
            onChange={(e) => setFontSize(Math.max(8, Number(e.target.value) || 12))}
            inputProps={{ min: 8, style: { width: 70 } }}
          />
        )}

        <Button size="small" variant="outlined" onClick={save}>Save Annotation</Button>
      </Box>

      {/* Selected shape property panel */}
      {selectedShape && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <strong>Selected:</strong> {selectedShape.type}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            Color:
            <input
              type="color"
              value={selectedShape.color || '#ff0000'}
              onChange={(e) => updateSelected({ color: e.target.value })}
              style={{ width: 32, height: 24, padding: 0, border: 'none', background: 'transparent' }}
            />
          </label>

          {selectedShape.type !== 'text' && (
            <TextField
              label="Stroke"
              type="number"
              size="small"
              value={selectedShape.strokeWidth ?? 2}
              onChange={(e) => updateSelected({ strokeWidth: Math.max(1, Number(e.target.value) || 1) })}
              inputProps={{ min: 1, style: { width: 60 } }}
            />
          )}

          {selectedShape.type === 'text' && (
            <TextField
              label="Font"
              type="number"
              size="small"
              value={selectedShape.fontSize ?? 18}
              onChange={(e) => updateSelected({ fontSize: Math.max(8, Number(e.target.value) || 12) })}
              inputProps={{ min: 8, style: { width: 70 } }}
            />
          )}

          {/* Rect text editing field */}
          {selectedShape.type === 'rect' && (
            <TextField
              label="Box Text"
              size="small"
              value={selectedShape.text || ''}
              onChange={(e) => updateSelected({ text: e.target.value })}
              inputProps={{ style: { width: 240 } }}
            />
          )}

          <Button
            size="small"
            color="error"
            variant="outlined"
            onClick={() => {
              setShapes((s) => s.filter((x) => x.id !== selectedId));
              setSelectedId(null);
            }}
          >
            Delete
          </Button>
        </Box>
      )}

      {/* Canvas area */}
      {!imgLoaded && (
        <Box
          sx={{
            width: '100%',
            minHeight: 240,
            display: 'grid',
            placeItems: 'center',
            border: '1px dashed #888',
            borderRadius: 1,
            color: '#888',
            fontSize: 14,
            p: 2,
          }}
        >
          {file ? 'Loading image…' : 'Upload an image to start annotating'}
        </Box>
      )}

      {imgLoaded && bgImage && (
        <Stage
          ref={stageRef}
          width={stageSize.w}
          height={stageSize.h}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          style={{ maxWidth: '100%' }}
        >
          <Layer>
            {/* Background image */}
            <KImage image={bgImage} width={stageSize.w} height={stageSize.h} listening={false} />

            {shapes.map((s) => {
              if (s.type === 'rect') {
                // Handle negative width/height by normalizing for text layout
                const rx = s.width >= 0 ? s.x : s.x + s.width;
                const ry = s.height >= 0 ? s.y : s.y + s.height;
                const rw = Math.abs(s.width);
                const rh = Math.abs(s.height);
                const pad = 8; // padding for text inside
                return (
                  <React.Fragment key={s.id}>
                    <Rect
                      id={s.id}
                      x={rx}
                      y={ry}
                      width={rw}
                      height={rh}
                      draggable
                      stroke={s.color}
                      strokeWidth={s.strokeWidth}
                      onClick={() => {
                        setSelectedId(s.id);
                        if (!s.text) promptRectText(s); // single-click empty -> prompt
                      }}
                      onDblClick={() => promptRectText(s)} // double-click to edit
                      onTap={() => {
                        setSelectedId(s.id);
                        if (!s.text) promptRectText(s);
                      }}
                      onDragEnd={(e) => updateSelected({ x: e.target.x(), y: e.target.y() })}
                      onTransformEnd={(e) => onTransformEnd(e, s)}
                    />
                    {s.text && (
                      <KText
                        text={s.text}
                        x={rx + pad}
                        y={ry + pad}
                        width={Math.max(1, rw - pad * 2)} // confine to box
                        // no offset: we want top-left origin inside the rect
                        fontSize={s.fontSize || fontSize}
                        fill={s.color}
                        align="center"
                        wrap="word"
                        listening
                        onClick={() => setSelectedId(s.id)}
                        onDblClick={() => promptRectText(s)}
                      />
                    )}
                  </React.Fragment>
                );
              }

              if (s.type === 'text') {
                return (
                  <KText
                    id={s.id}
                    key={s.id}
                    x={s.x}
                    y={s.y}
                    text={s.text}
                    fontSize={s.fontSize}
                    fill={s.color}
                    draggable
                    onClick={() => setSelectedId(s.id)}
                    onTap={() => setSelectedId(s.id)}
                    onDragEnd={(e) => updateSelected({ x: e.target.x(), y: e.target.y() })}
                    onTransformEnd={(e) => onTransformEnd(e, s)}
                  />
                );
              }

              if (s.type === 'arrow') {
                return <React.Fragment key={s.id}>{renderArrowWithAnchors(s)}</React.Fragment>;
              }
              return null;
            })}

            {/* Transformer for rect/text */}
            <Transformer ref={trRef} rotateEnabled />
          </Layer>
        </Stage>
      )}
    </Box>
  );
}
