// src/components/SurveyAnnotator.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Box,
  Button,
  ToggleButton,
  ToggleButtonGroup,
  TextField,
  IconButton,
  Paper,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import {
  Stage, Layer, Image as KImage, Rect, Arrow, Text as KText,
  Transformer, Group, Label, Tag, Circle,
} from 'react-konva';
import { v4 as uuid } from 'uuid';

function clientToStagePos(stage, evt) {
  const rect = stage.container().getBoundingClientRect();
  const scaleX = stage.width() / rect.width;
  const scaleY = stage.height() / rect.height;
  return { x: (evt.clientX - rect.left) * scaleX, y: (evt.clientY - rect.top) * scaleY };
}

function useResizeObserverSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const cr = e.contentRect;
        setSize({ width: cr.width, height: cr.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

function useLoadedImage(fileOrUrl) {
  const objectUrl = useMemo(() => {
    if (!fileOrUrl) return null;
    if (typeof fileOrUrl === 'string') return fileOrUrl;
    return URL.createObjectURL(fileOrUrl);
  }, [fileOrUrl]);

  const [img, setImg] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setImg(null); setLoaded(false);
    if (!objectUrl) return;
    const image = new window.Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => { setImg(image); setLoaded(true); };
    image.onerror = () => { setImg(null); setLoaded(false); };
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
  const containerSize = useResizeObserverSize(containerRef);
  const isSmallScreen = typeof window !== 'undefined' ? window.innerWidth <= 600 : false;

  const [tool, setTool] = useState('arrow');
  const [color, setColor] = useState('#ff4d4d');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [fontSize, setFontSize] = useState(18);

  const [shapes, setShapes] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  const [isDrawing, setIsDrawing] = useState(false);
  const [startPt, setStartPt] = useState(null);
  const [stageSize, setStageSize] = useState({ w: 900, h: 600 });

  const [propsOpen, setPropsOpen] = useState(false);
  useEffect(() => { setPropsOpen(!!selectedId); }, [selectedId]);

  // Fit stage
  useEffect(() => {
    if (!imgLoaded || !bgImage || !containerSize.width) return;
    const maxW = containerSize.width;
    const scale = Math.min(1, maxW / bgImage.width);
    setStageSize({
      w: Math.round(bgImage.width * scale),
      h: Math.round(bgImage.height * scale),
    });
  }, [imgLoaded, bgImage, containerSize.width]);

  // Reset when new image chosen
  useEffect(() => { setShapes([]); setSelectedId(null); }, [file]);

  // Delete key
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

  // Transformer for rect/text
  useEffect(() => {
    const tr = trRef.current, stage = stageRef.current;
    if (!tr || !stage) return;
    const sel = shapes.find((x) => x.id === selectedId);
    if (!sel || sel.type === 'arrow') { tr.nodes([]); tr.getLayer()?.batchDraw(); return; }
    const node = stage.findOne(`#${selectedId}`);
    tr.nodes(node ? [node] : []); tr.getLayer()?.batchDraw();
  }, [selectedId, shapes]);

  const startShape = useCallback((pos) => {
    const id = uuid();
    if (tool === 'arrow') {
      return { id, type: 'arrow', points: [pos.x, pos.y, pos.x, pos.y], color, strokeWidth, measure: null };
    }
    if (tool === 'rect') {
      return {
        id, type: 'rect',
        x: pos.x, y: pos.y, width: 0, height: 0,
        color, strokeWidth, draggable: true,
        text: '', fontSize,
        textColor: '#ffffff',
        fill: '#ff4d4d',
        fillOpacity: 0.15,
        cornerRadius: 4,
      };
    }
    if (tool === 'text') {
      return { id, type: 'text', x: pos.x, y: pos.y, text: '', color, fontSize, draggable: true };
    }
    return null;
  }, [tool, color, strokeWidth, fontSize]);

  // Pointer handlers
  const handlePointerDown = (e) => {
    const stage = e.target.getStage();
    const clickedOnEmpty = e.target === stage;

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
      setShapes((s) => [...s, { id, type: 'text', x: pos.x, y: pos.y, text: label, fontSize, color, draggable: true }]);
      setSelectedId(id);
      return;
    }

    setIsDrawing(true);
    setStartPt(pos);
    const newShape = startShape(pos);
    if (newShape) { setShapes((s) => [...s, newShape]); setSelectedId(newShape.id); }
  };

  const handlePointerMove = (e) => {
    if (!isDrawing || !startPt) return;
    const pos = e.target.getStage().getPointerPosition();
    setShapes((prev) => {
      const next = [...prev];
      const curr = next[next.length - 1];
      if (!curr) return next;
      if (curr.type === 'arrow') curr.points = [startPt.x, startPt.y, pos.x, pos.y];
      else if (curr.type === 'rect') { curr.width = pos.x - startPt.x; curr.height = pos.y - startPt.y; }
      return next;
    });
  };

  const handlePointerUp = () => { setIsDrawing(false); setStartPt(null); };

  const updateSelected = (patch) => {
    setShapes((arr) => arr.map((s) => (s.id === selectedId ? { ...s, ...patch } : s)));
  };

  const onTransformEnd = (e, shape) => {
    const node = e.target, scaleX = node.scaleX(), scaleY = node.scaleY();
    if (shape.type === 'rect') {
      const newAttrs = {
        x: node.x(), y: node.y(),
        width: Math.max(1, node.width() * scaleX),
        height: Math.max(1, node.height() * scaleY),
      };
      node.scaleX(1); node.scaleY(1);
      updateSelected(newAttrs);
    } else if (shape.type === 'text') {
      updateSelected({ x: node.x(), y: node.y() });
    }
  };

  const Anchor = ({ x, y, onDragMove, onMouseDown }) => (
    <Circle
      x={x} y={y} radius={isSmallScreen ? 14 : 10}
      fill="#00b7ff" stroke="white" strokeWidth={1} draggable
      onMouseDown={(e) => { e.cancelBubble = true; onMouseDown?.(e); }}
      onDragMove={(e) => {
        e.cancelBubble = true;
        const stage = e.target.getStage();
        const pos = clientToStagePos(stage, e.evt);
        e.target.position(pos);
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
      setShapes((arr) => arr.map((sh) => {
        if (sh.id !== s.id) return sh;
        const pts = [...sh.points];
        if (which === 'start') { pts[0] = nx; pts[1] = ny; }
        else { pts[2] = nx; pts[3] = ny; }
        return { ...sh, points: pts };
      }));
    };

    return (
      <>
        <Arrow
          id={s.id}
          points={s.points}
          stroke={s.color}
          fill={s.color}
          strokeWidth={s.strokeWidth}
          pointerLength={isSmallScreen ? 16 : 12}
          pointerWidth={isSmallScreen ? 16 : 12}
          pointerAtBeginning
          hitStrokeWidth={isSmallScreen ? 30 : 20}
          onMouseDown={(e) => { e.cancelBubble = true; setSelectedId(s.id); }}
          onClick={(e) => { e.cancelBubble = true; setSelectedId(s.id); }}
          onTap={() => setSelectedId(s.id)}
        />

        {/* Measurement bubble — show ONLY when no measurement yet */}
        {s.measure == null && (
          <Group
            x={mid.x}
            y={mid.y}
            onMouseDown={(e) => { e.cancelBubble = true; }}
            onClick={(e) => {
              e.cancelBubble = true;
              const v = window.prompt('Enter measurement (mm):', '');
              if (v == null) return;
              const n = Number(v);
              setShapes((arr) => arr.map((sh) => (
                sh.id === s.id ? { ...sh, measure: Number.isFinite(n) ? n : null } : sh
              )));
            }}
          >
            <Label offsetX={14} offsetY={14}>
              <Tag fill="rgba(0,0,0,0.55)" stroke="#fff" cornerRadius={14} />
              <KText text="?" fontSize={14} fill="#fff" padding={6} />
            </Label>
          </Group>
        )}

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

        {selectedId === s.id && (
          <>
            <Anchor x={x1} y={y1} onMouseDown={() => setSelectedId(s.id)} onDragMove={({ x, y }) => setEnd('start', x, y)} />
            <Anchor x={x2} y={y2} onMouseDown={() => setSelectedId(s.id)} onDragMove={({ x, y }) => setEnd('end', x, y)} />
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
    <Box ref={containerRef} sx={{ position: 'relative', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 4, p: 0.5, display: 'grid', gap: 6, backgroundColor: 'rgba(245, 245, 245, 0.95)', color: '#111' }}>
      {/* Toolbar */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', p: 0.5, border: '1px solid rgba(0,0,0,0.12)', borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.9)', color: '#111' }}>
        <ToggleButtonGroup size="small" exclusive value={tool} onChange={(_, v) => v && setTool(v)} color="primary">
          {tools.includes('text') && <ToggleButton value="text">TEXT</ToggleButton>}
          {tools.includes('rect') && <ToggleButton value="rect">RECT</ToggleButton>}
          {tools.includes('arrow') && <ToggleButton value="arrow">↔ ARROW</ToggleButton>}
        </ToggleButtonGroup>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          New color:
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 28, height: 22, padding: 0, border: 'none', background: 'transparent' }} />
        </label>

        <TextField label="New stroke" type="number" size="small" value={strokeWidth} onChange={(e) => setStrokeWidth(Math.max(1, Number(e.target.value) || 1))} inputProps={{ min: 1, style: { width: 56, color: '#111' } }} InputLabelProps={{ style: { color: '#111' } }} />

        {tool === 'text' && (
          <TextField label="New font" type="number" size="small" value={fontSize} onChange={(e) => setFontSize(Math.max(8, Number(e.target.value) || 12))} inputProps={{ min: 8, style: { width: 64, color: '#111' } }} InputLabelProps={{ style: { color: '#111' } }} />
        )}

        <Button size="small" variant="outlined" onClick={save} sx={{ ml: 'auto' }}>
          Save Annotation
        </Button>
      </Box>

      {/* Canvas */}
      {!imgLoaded && (
        <Box sx={{ width: '100%', minHeight: 180, display: 'grid', placeItems: 'center', border: '1px dashed rgba(0,0,0,0.2)', borderRadius: 4, color: 'rgba(0,0,0,0.6)', fontSize: 14, p: 1.5 }}>
          {file ? 'Loading image…' : 'Upload an image to start annotating'}
        </Box>
      )}

      {imgLoaded && bgImage && (
        <Stage
          ref={stageRef}
          width={stageSize.w}
          height={stageSize.h}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          style={{ width: '100%', height: 'auto', touchAction: 'none', borderRadius: 10, overflow: 'hidden' }}
        >
          <Layer>
            <KImage image={bgImage} width={stageSize.w} height={stageSize.h} listening={false} />

            {shapes.map((s) => {
              if (s.type === 'rect') {
                const rx = s.width >= 0 ? s.x : s.x + s.width;
                const ry = s.height >= 0 ? s.y : s.y + s.height;
                const rw = Math.abs(s.width);
                const rh = Math.abs(s.height);
                const pad = 6;
                return (
                  <React.Fragment key={s.id}>
                    <Rect
                      id={s.id}
                      x={rx} y={ry} width={rw} height={rh}
                      cornerRadius={s.cornerRadius ?? 8}
                      draggable
                      stroke={s.color}
                      strokeWidth={s.strokeWidth}
                      fill={s.color}
                      opacity={s.fillOpacity ?? 0.15}
                      onClick={() => setSelectedId(s.id)}
                      onTap={() => setSelectedId(s.id)}
                      onDragEnd={(e) => updateSelected({ x: e.target.x(), y: e.target.y() })}
                      onTransformEnd={(e) => onTransformEnd(e, s)}
                    />
                    {s.text && (
                      <KText
                        text={s.text}
                        x={rx + pad} y={ry + pad}
                        width={Math.max(1, rw - pad * 2)}
                        fontSize={s.fontSize || fontSize}
                        fill={s.textColor || '#ffffff'}
                        align="center"
                        wrap="word"
                        listening
                        onClick={() => setSelectedId(s.id)}
                      />
                    )}
                  </React.Fragment>
                );
              }

              if (s.type === 'text') {
                return (
                  <KText
                    id={s.id} key={s.id}
                    x={s.x} y={s.y} text={s.text}
                    fontSize={s.fontSize} fill={s.color} draggable
                    onClick={() => setSelectedId(s.id)}
                    onTap={() => setSelectedId(s.id)}
                    onDragEnd={(e) => updateSelected({ x: e.target.x(), y: e.target.y() })}
                    onTransformEnd={(e) => onTransformEnd(e, s)}
                  />
                );
              }

              if (s.type === 'arrow') return <React.Fragment key={s.id}>{renderArrowWithAnchors(s)}</React.Fragment>;
              return null;
            })}

            <Transformer ref={trRef} rotateEnabled />
          </Layer>
        </Stage>
      )}

      {/* Floating properties */}
      {selectedShape && propsOpen && (
        <Paper elevation={6} sx={{ position: 'fixed', right: 16, bottom: 16, maxWidth: 380, p: 1.25, borderRadius: 2, background: 'rgba(245, 245, 245, 0.92)', color: '#111', border: '1px solid rgba(0,0,0,0.1)', boxShadow: '0 6px 24px rgba(0,0,0,0.25)', zIndex: 1400, backdropFilter: 'blur(6px)' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Box sx={{ fontWeight: 600 }}>Selected:</Box>
            <Box sx={{ mr: 1 }}>{selectedShape.type}</Box>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Color:
              <input
                type="color"
                value={selectedShape.color || '#ff4d4d'}
                onChange={(e) => updateSelected({ color: e.target.value })}
                style={{ width: 28, height: 22, padding: 0, border: 'none', background: 'transparent' }}
              />
            </label>

            {selectedShape.type !== 'text' && (
              <TextField
                label="Stroke"
                type="number"
                size="small"
                value={selectedShape.strokeWidth ?? 2}
                onChange={(e) => updateSelected({ strokeWidth: Math.max(1, Number(e.target.value) || 1) })}
                inputProps={{ min: 1, style: { width: 56, color: '#111' } }}
              />
            )}

            {selectedShape.type === 'rect' && (
              <>
                <TextField
                  label="Box Text"
                  size="small"
                  value={selectedShape.text || ''}
                  onChange={(e) => updateSelected({ text: e.target.value })}
                  inputProps={{ style: { width: 180, color: '#111' } }}
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  Text color:
                  <input
                    type="color"
                    value={selectedShape.textColor || '#ffffff'}
                    onChange={(e) => updateSelected({ textColor: e.target.value })}
                    style={{ width: 28, height: 22, padding: 0, border: 'none', background: 'transparent' }}
                  />
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, opacity: 0.8 }}>Opacity</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={selectedShape.fillOpacity ?? 0.15}
                    onChange={(e) => updateSelected({ fillOpacity: Number(e.target.value) })}
                  />
                </div>
              </>
            )}

            <Box sx={{ flex: 1 }} />

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

            <IconButton size="small" onClick={() => setPropsOpen(false)} sx={{ color: '#111' }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        </Paper>
      )}
    </Box>
  );
}
