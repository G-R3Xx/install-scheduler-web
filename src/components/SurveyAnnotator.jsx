import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Box, Button, ToggleButton, ToggleButtonGroup, TextField } from '@mui/material';
import {
  Stage,
  Layer,
  Image as KImage,
  Rect,
  Arrow,
  Text,
  Transformer,
  Group,
  Label,
  Tag,
  Circle,
} from 'react-konva';
import { v4 as uuid } from 'uuid';

// Load image as HTMLImageElement
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

// midpoint between arrow endpoints
const midPoint = (pts) => ({ x: (pts[0] + pts[2]) / 2, y: (pts[1] + pts[3]) / 2 });

export default function SurveyAnnotator({ file, tools = [], onSave }) {
  const stageRef = useRef(null);
  const trRef = useRef(null);
  const containerRef = useRef(null);

  const { img: bgImage, loaded: imgLoaded } = useLoadedImage(file);

  const [tool, setTool] = useState('rect');
  const [color, setColor] = useState('#ff0000');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [fontSize, setFontSize] = useState(18);

  // shapes: { id, type: 'rect'|'text'|'arrow', ... , measure?: number }
  const [shapes, setShapes] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  const [isDrawing, setIsDrawing] = useState(false);
  const [startPt, setStartPt] = useState(null);
  const [stageSize, setStageSize] = useState({ w: 900, h: 600 });

  // recompute size when image loads
  useEffect(() => {
    if (!imgLoaded || !bgImage || !containerRef.current) return;
    const maxW = containerRef.current.clientWidth || 1000;
    const scale = Math.min(1, maxW / bgImage.width);
    setStageSize({
      w: Math.round(bgImage.width * scale),
      h: Math.round(bgImage.height * scale),
    });
  }, [imgLoaded, bgImage]);

  // clear shapes when new file selected
  useEffect(() => {
    setShapes([]);
    setSelectedId(null);
  }, [file]);

  // delete key
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

  // transformer only for rect/text
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
        };
      }
      return null;
    },
    [tool, color, strokeWidth]
  );

  // ---------- Mouse handlers ----------
  const handleMouseDown = (e) => {
    const stage = e.target.getStage();
    const clickedOnEmpty = e.target === stage;

    // select shape if clicked
    if (!clickedOnEmpty) {
      const id = e.target.id?.();
      if (id) setSelectedId(id);
      return;
    }

    if (!bgImage) return;
    const pos = stage.getPointerPosition();

    if (tool === 'text') {
      const label = prompt('Enter text:');
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
    setIsDrawing(false);
    setStartPt(null);
  };

  // ---------- Helpers ----------
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
  const Anchor = ({ x, y, onDragMove }) => (
    <Circle
      x={x}
      y={y}
      radius={6}
      fill="#00b7ff"
      stroke="white"
      strokeWidth={1}
      draggable
      onDragMove={onDragMove}
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
            pts[0] = nx;
            pts[1] = ny;
          } else {
            pts[2] = nx;
            pts[3] = ny;
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
          pointerLength={10}
          pointerWidth={10}
          pointerAtBeginning
          onClick={() => setSelectedId(s.id)}
          onTap={() => setSelectedId(s.id)}
        />

        {/* Center measurement bubble */}
        <Group
          x={mid.x}
          y={mid.y}
          onClick={() => {
            const v = prompt(
              'Enter measurement (mm):',
              s.measure != null ? String(s.measure) : ''
            );
            if (v == null) return;
            const n = Number(v);
            setShapes((arr) =>
              arr.map((sh) =>
                sh.id === s.id
                  ? { ...sh, measure: Number.isFinite(n) ? n : null }
                  : sh
              )
            );
          }}
        >
          {(selectedId === s.id || s.measure == null) && (
            <Label offsetX={14} offsetY={14}>
              <Tag fill="rgba(0,0,0,0.55)" stroke="#fff" cornerRadius={14} />
              <Text text="?" fontSize={14} fill="#fff" padding={6} />
            </Label>
          )}
        </Group>

        {s.measure != null && (
          <Text
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
              onDragMove={(e) => {
                const p = e.target.position();
                setEnd('start', p.x, p.y);
              }}
            />
            <Anchor
              x={x2}
              y={y2}
              onDragMove={(e) => {
                const p = e.target.position();
                setEnd('end', p.x, p.y);
              }}
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
    const blob = await new Promise((res) =>
      stage.toCanvas().toBlob(res, 'image/png')
    );
    onSave?.({ stageJSON: JSON.parse(stageJSON), annotatedBlob: blob });
    alert('Annotation saved for this sign.');
  };

  const selectedShape = shapes.find((s) => s.id === selectedId);

  return (
    <Box
      ref={containerRef}
      sx={{ border: '1px solid #555', borderRadius: 1, p: 1, display: 'grid', gap: 8 }}
    >
      {/* Toolbar */}
      <Box
        sx={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
      >
        <ToggleButtonGroup
          size="small"
          exclusive
          value={tool}
          onChange={(_, v) => v && setTool(v)}
        >
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
            style={{
              width: 32,
              height: 24,
              padding: 0,
              border: 'none',
              background: 'transparent',
            }}
          />
        </label>
        <TextField
          label="New stroke"
          type="number"
          size="small"
          value={strokeWidth}
          onChange={(e) =>
            setStrokeWidth(Math.max(1, Number(e.target.value) || 1))
          }
          inputProps={{ min: 1, style: { width: 60 } }}
        />
        {tool === 'text' && (
          <TextField
            label="New font"
            type="number"
            size="small"
            value={fontSize}
            onChange={(e) =>
              setFontSize(Math.max(8, Number(e.target.value) || 12))
            }
            inputProps={{ min: 8, style: { width: 70 } }}
          />
        )}

        <Button size="small" variant="outlined" onClick={save}>
          Save Annotation
        </Button>
      </Box>

      {/* Selected-shape property panel */}
      {selectedShape && (
        <Box
          sx={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
        >
          <strong>Selected:</strong> {selectedShape.type}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            Color:
            <input
              type="color"
              value={selectedShape.color || '#ff0000'}
              onChange={(e) => updateSelected({ color: e.target.value })}
              style={{
                width: 32,
                height: 24,
                padding: 0,
                border: 'none',
                background: 'transparent',
              }}
            />
          </label>
          {selectedShape.type !== 'text' && (
            <TextField
              label="Stroke"
              type="number"
              size="small"
              value={selectedShape.strokeWidth ?? 2}
              onChange={(e) =>
                updateSelected({
                  strokeWidth: Math.max(1, Number(e.target.value) || 1),
                })
              }
              inputProps={{ min: 1, style: { width: 60 } }}
            />
          )}
          {selectedShape.type === 'text' && (
            <TextField
              label="Font"
              type="number"
              size="small"
              value={selectedShape.fontSize ?? 18}
              onChange={(e) =>
                updateSelected({
                  fontSize: Math.max(8, Number(e.target.value) || 12),
                })
              }
              inputProps={{ min: 8, style: { width: 70 } }}
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

      {/* Canvas */}
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
            {/* Background photo */}
            <KImage
              image={bgImage}
              width={stageSize.w}
              height={stageSize.h}
              listening={false}
            />

            {shapes.map((s) => {
              if (s.type === 'rect') {
                return (
                  <Rect
                    id={s.id}
                    key={s.id}
                    x={s.x}
                    y={s.y}
                    width={s.width}
                    height={s.height}
                    draggable
                    stroke={s.color}
                    strokeWidth={s.strokeWidth}
                    onClick={() => setSelectedId(s.id)}
                    onTap={() => setSelectedId(s.id)}
                    onDragEnd={(e) =>
                      updateSelected({ x: e.target.x(), y: e.target.y() })
                    }
                    onTransformEnd={(e) => onTransformEnd(e, s)}
                  />
                );
              }
              if (s.type === 'text') {
                return (
                  <Text
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
                    onDragEnd={(e) =>
                      updateSelected({ x: e.target.x(), y: e.target.y() })
                    }
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
