import { useEffect, useRef, useState } from "react";
import { useStore, TableSchema } from "../store";

interface BoxPos {
  x: number;
  y: number;
}

const BOX_W = 220;
const ROW_H = 20;
const HEAD_H = 26;

/** Schema Designer — canvas visual tabel + garis relasi FK antar tabel. */
export default function SchemaDesigner({
  connId,
  database,
  onClose,
}: {
  connId: string;
  database: string;
  onClose: () => void;
}) {
  const conn = useStore((s) => s.connections.find((c) => c.id === connId));
  const schema = conn?.schema ?? null;
  const canvasRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Record<string, BoxPos>>({});
  const [drag, setDrag] = useState<{ table: string; dx: number; dy: number } | null>(null);
  const [pan, setPan] = useState<null | { x: number; y: number; px: number; py: number }>(null);
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);

  // layout awal: grid otomatis
  useEffect(() => {
    if (!schema) return;
    setPos((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      const p: Record<string, BoxPos> = {};
      const perRow = Math.max(2, Math.ceil(Math.sqrt(schema.length)));
      schema.forEach((t, i) => {
        p[t.table] = {
          x: 40 + (i % perRow) * (BOX_W + 60),
          y: 40 + Math.floor(i / perRow) * 320,
        };
      });
      return p;
    });
  }, [schema]);

  if (!schema) return <div className="table-designer"><div className="muted">Memuat schema…</div></div>;

  const find = (t: string): TableSchema | undefined =>
    schema.find((s) => s.table.toLowerCase() === t.toLowerCase());

  const zoomTo = (z: number) => setZoom(Math.min(3, Math.max(0.25, Math.round(z * 20) / 20)));

  const onMouseDown = (e: React.MouseEvent, table: string) => {
    const p = pos[table];
    setSelected(table);
    // dx/dy disimpan di ruang layar (posisi world × zoom)
    setDrag({ table, dx: e.clientX - p.x * zoom, dy: e.clientY - p.y * zoom });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (drag) {
      setPos((p) => ({
        ...p,
        [drag.table]: { x: (e.clientX - drag.dx) / zoom, y: (e.clientY - drag.dy) / zoom },
      }));
    } else if (pan) {
      setPan({ ...pan, x: pan.x + (e.clientX - pan.px), y: pan.y + (e.clientY - pan.py) });
    }
  };

  const endDrag = () => {
    setDrag(null);
    setPan(null);
  };

  // hitung garis relasi (koordinat relatif canvas, dgn offset pan)
  const lines: { x1: number; y1: number; x2: number; y2: number; ok: boolean }[] = [];
  for (const ts of schema) {
    for (const fk of ts.foreign_keys) {
      const from = pos[ts.table];
      const refTs = find(fk.ref_table);
      const to = refTs ? pos[refTs.table] : undefined;
      if (!from || !to) continue;
      const colIdx = Math.max(0, ts.columns.findIndex((c) => c.name === fk.column));
      const refColIdx = Math.max(0, refTs!.columns.findIndex((c) => c.name === fk.ref_column));
      lines.push({
        x1: from.x + BOX_W,
        y1: from.y + HEAD_H + colIdx * ROW_H + ROW_H / 2,
        x2: to.x,
        y2: to.y + HEAD_H + refColIdx * ROW_H + ROW_H / 2,
        ok: true,
      });
    }
  }

  const bounds = {
    w: Math.max(...Object.values(pos).map((p) => p.x + BOX_W + 200), 800),
    h: Math.max(...Object.values(pos).map((p) => p.y + 340), 600),
  };

  return (
    <div className="table-designer schema-designer">
      <div className="td-toolbar">
        <h2>Schema Designer — {database}</h2>
        <span className="muted">{conn?.name} · {schema.length} tabel · {lines.length} relasi</span>
        <span className="spacer" />
        <div className="sd-zoom">
          <button title="Zoom out (-)" onClick={() => zoomTo(zoom - 0.1)}>−</button>
          <span className="sd-zoom-val">{Math.round(zoom * 100)}%</span>
          <button title="Zoom in (+)" onClick={() => zoomTo(zoom + 0.1)}>+</button>
          <button title="Reset zoom (Ctrl+0)" onClick={() => { setZoom(1); setPan(null); }}>⤢</button>
        </div>
        <button onClick={onClose}>Tutup</button>
      </div>
      <div
        className="sd-canvas"
        ref={canvasRef}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            zoomTo(zoom + (e.deltaY < 0 ? 0.1 : -0.1));
          }
        }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("sd-world")) {
            setSelected(null);
            setPan({ x: 0, y: 0, px: e.clientX, py: e.clientY });
          }
        }}
      >
        <div
          className="sd-world"
          style={{
            width: bounds.w * zoom,
            height: bounds.h * zoom,
            transform: `scale(${zoom})${pan ? ` translate(${pan.x / zoom}px, ${pan.y / zoom}px)` : ""}`,
            transformOrigin: "0 0",
          }}
        >
          <svg className="sd-lines" width={bounds.w} height={bounds.h}>
            {lines.map((l, i) => (
              <path
                key={i}
                d={`M ${l.x1} ${l.y1} C ${l.x1 + 50} ${l.y1}, ${l.x2 - 50} ${l.y2}, ${l.x2} ${l.y2}`}
                stroke="#4a90d9"
                strokeWidth={2}
                fill="none"
              />
            ))}
          </svg>
          {schema.map((ts) => {
            const p = pos[ts.table] ?? { x: 0, y: 0 };
            return (
              <div
                key={ts.table}
                className={"sd-table" + (selected === ts.table ? " selected" : "")}
                style={{ left: p.x, top: p.y, width: BOX_W }}
                onMouseDown={(e) => onMouseDown(e, ts.table)}
              >
                <div className="sd-head">
                  <span className="sd-icon">▤</span> {ts.table}
                </div>
                <div className="sd-rows">
                  {ts.columns.map((c) => {
                    const isFk = ts.foreign_keys.some((f) => f.column === c.name);
                    const isPk = c.key === "PRI" || c.key === "PRIMARY KEY";
                    return (
                      <div
                        key={c.name}
                        className={"sd-row" + (isFk ? " fk-col" : "")}
                        title={`${c.name} ${c.data_type}${c.comment ? ` — ${c.comment}` : ""}`}
                      >
                        <span className="sd-key">{isPk ? "🔑" : isFk ? "🔗" : ""}</span>
                        <span className="sd-name">{c.name}</span>
                        <span className="sd-type">{c.data_type.split("(")[0]}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="sd-hint">
          Drag tabel untuk memindahkan · Drag area kosong untuk pan · 🔑=PK 🔗=FK
        </div>
      </div>
    </div>
  );
}
