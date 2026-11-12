import { useEffect, useMemo, useRef, useState } from "react";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { Check, Link as LinkIcon, Minus, Plus, Scan, Search, X } from "lucide-react";
import { Dot, Switch } from "../components/ui";
import type { Note } from "../core/types";
import { clamp } from "../lib/util";
import { openDialog, openNote, useApp } from "../store/app";
import { folderName, isOwnSharedCopy, isPrivateStub, linksOf, resolveRef, spaceLabel, textOf } from "../store/select";
import { useDrawingImage } from "../notes/render";

const PALETTE = ["#5fa88c", "#5b8fd0", "#d9ae2e", "#8e75cc", "#d9705f", "#4aa3a8", "#b0577c", "#7f8f3a"];

interface GNode extends SimulationNodeDatum {
  uid: string;
  note: Note;
  category: string;
  degree: number;
}
type GLink = SimulationLinkDatum<GNode> & { a: string; b: string };

function categoryOf(note: Note): string {
  if (note.space.startsWith("g:")) return spaceLabel(note.space);
  return folderName(note) ?? "My notes";
}

function tagsOf(note: Note): string[] {
  const found = new Set(note.meta.tags.map((t) => t.toLowerCase()));
  if (note.meta.type !== "drawing") for (const m of textOf(note).matchAll(/(^|\s)#([a-z][\w-]{1,24})/gi)) found.add(m[2].toLowerCase());
  return [...found];
}

function PreviewPanel({ uid, onClose }: { uid: string; onClose: () => void }) {
  const notes = useApp((s) => s.notes);
  const userId = useApp((s) => s.user?.id);
  const note = notes[uid];
  const previewUid = note?.meta.preview ? resolveRef(note.space, note.meta.preview) : null;
  const sketch = note?.meta.type === "drawing" ? note : previewUid ? notes[previewUid] : null;
  const image = useDrawingImage(sketch?.meta.type === "drawing" ? sketch : null);
  if (!note) return null;
  const links = linksOf(uid, notes, userId);
  return (
    <aside className="absolute bg-surface border border-line rounded-xl" style={{ right: 20, top: 20, width: 290, padding: 18, boxShadow: "var(--shadow)", zIndex: 5 }} data-testid="graph-preview">
      <div className="flex items-start">
        <span className="badge badge-brand">{categoryOf(note)}</span>
        <span className="flex-1" />
        <button className="icon-btn" style={{ width: 26, height: 26, marginTop: -4, marginRight: -6 }} aria-label="Close preview" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      <div className="t16 font-bold mt-2.5">{note.meta.title}</div>
      <div className="t12 text-muted mt-0.5">
        {note.meta.type === "drawing" ? "Drawing" : "Note"} · {note.meta.updatedByName || "you"}
      </div>
      {image.url ? (
        <div className="rounded-lg grid place-items-center mt-3 overflow-hidden" style={{ height: 110, background: "color-mix(in srgb, #8e75cc 14%, var(--surface))" }}>
          <img src={image.url} alt="" style={{ maxHeight: 100, maxWidth: "92%" }} />
        </div>
      ) : note.meta.type !== "drawing" && textOf(note) ? (
        <div className="t12 text-ink-2 mt-3" style={{ display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {textOf(note).slice(0, 240)}
        </div>
      ) : null}
      <div className="caps mt-4 mb-2">{links.length === 0 ? "Not linked to anything yet" : `Linked with ${links.length} note${links.length === 1 ? "" : "s"}`}</div>
      <div className="scroll" style={{ maxHeight: 150 }}>
        {links.map((l) => (
          <div key={l.uid} className="flex items-center gap-2 t13 py-1">
            <Dot note={l.note} size={8} />
            <span className="truncate">{l.note.meta.title}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-4">
        <button className="btn btn-primary flex-1" onClick={() => openNote(uid)}>
          Open note
        </button>
        <button className="btn flex-1" onClick={() => openDialog({ kind: "link", uid })}>
          <LinkIcon size={14} /> Link to…
        </button>
      </div>
    </aside>
  );
}

export function GraphView() {
  const notes = useApp((s) => s.notes);
  const userId = useApp((s) => s.user?.id);
  const now = useApp((s) => s.now);
  const [hiddenCats, setHiddenCats] = useState<Set<string>>(new Set());
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [depth, setDepth] = useState<1 | 2 | 3 | 0>(2);
  const [showUnlinked, setShowUnlinked] = useState(true);
  const [recentOnly, setRecentOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [size, setSize] = useState({ w: 1000, h: 700 });
  const wrap = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const positions = useRef(new Map<string, { x: number; y: number }>());

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const base = useMemo(() => {
    const list = Object.entries(notes)
      .filter(([, n]) => n.meta.type !== "daily" && !isOwnSharedCopy(n, userId) && !isPrivateStub(n, userId))
      .map(([uid, note]) => ({ uid, note, category: categoryOf(note), tags: tagsOf(note) }));
    const categories = [...new Set(list.map((n) => n.category))].sort();
    const allTags = [...new Set(list.flatMap((n) => n.tags))].sort().slice(0, 14);
    return { list, categories, allTags };
  }, [notes, userId]);

  const colorOf = (category: string) => PALETTE[Math.max(0, base.categories.indexOf(category)) % PALETTE.length];

  const graph = useMemo(() => {
    const weekAgo = now - 7 * 86_400_000;
    const visible = base.list.filter((n) => {
      if (hiddenCats.has(n.category)) return false;
      if (tags.size && !n.tags.some((t) => tags.has(t))) return false;
      if (recentOnly && (Date.parse(n.note.meta.updated) || 0) < weekAgo) return false;
      return true;
    });
    const ids = new Set(visible.map((n) => n.uid));
    const links: GLink[] = [];
    const seen = new Set<string>();
    const degree = new Map<string, number>();
    for (const n of visible) {
      for (const l of linksOf(n.uid, notes, userId)) {
        if (!ids.has(l.uid)) continue;
        const key = [n.uid, l.uid].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({ source: n.uid, target: l.uid, a: n.uid, b: l.uid });
        degree.set(n.uid, (degree.get(n.uid) ?? 0) + 1);
        degree.set(l.uid, (degree.get(l.uid) ?? 0) + 1);
      }
    }
    const nodes: GNode[] = visible
      .filter((n) => showUnlinked || (degree.get(n.uid) ?? 0) > 0)
      .map((n, i) => {
        const prev = positions.current.get(n.uid);
        const angle = i * 2.399963;
        const r = 40 + 26 * Math.sqrt(i);
        return { uid: n.uid, note: n.note, category: n.category, degree: degree.get(n.uid) ?? 0, x: prev?.x ?? Math.cos(angle) * r, y: prev?.y ?? Math.sin(angle) * r };
      });
    const sim = forceSimulation(nodes)
      .force("link", forceLink<GNode, GLink>(links).id((d) => d.uid).distance(130).strength(0.5))
      .force("charge", forceManyBody().strength(-520))
      .force("center", forceCenter(0, 0))
      .force("x", forceX(0).strength(0.05))
      .force("y", forceY(0).strength(0.07))
      .force("collide", forceCollide<GNode>().radius((d) => 34 + d.degree * 2))
      .stop();
    for (let i = 0; i < 260; i++) sim.tick();
    for (const n of nodes) positions.current.set(n.uid, { x: n.x ?? 0, y: n.y ?? 0 });
    return { nodes, links };
  }, [base, notes, userId, hiddenCats, tags, recentOnly, showUnlinked, now]);

  // Which notes are within the chosen number of links of the selected one.
  const near = useMemo(() => {
    if (!selected || depth === 0) return null;
    const dist = new Map<string, number>([[selected, 0]]);
    let frontier = [selected];
    for (let d = 1; d <= depth; d++) {
      const next: string[] = [];
      for (const uid of frontier) {
        for (const l of graph.links) {
          const other = l.a === uid ? l.b : l.b === uid ? l.a : null;
          if (other && !dist.has(other)) {
            dist.set(other, d);
            next.push(other);
          }
        }
      }
      frontier = next;
    }
    return dist;
  }, [selected, depth, graph.links]);

  const fit = () => {
    if (graph.nodes.length === 0) return setView({ x: size.w / 2, y: size.h / 2, k: 1 });
    const xs = graph.nodes.map((n) => n.x ?? 0);
    const ys = graph.nodes.map((n) => n.y ?? 0);
    const minX = Math.min(...xs) - 90;
    const maxX = Math.max(...xs) + 90;
    const minY = Math.min(...ys) - 60;
    const maxY = Math.max(...ys) + 80;
    const k = clamp(Math.min(size.w / (maxX - minX), size.h / (maxY - minY)), 0.3, 1.4);
    setView({ k, x: size.w / 2 - ((minX + maxX) / 2) * k, y: size.h / 2 - ((minY + maxY) / 2) * k });
  };

  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && size.w > 0 && graph.nodes.length > 0) {
      fitted.current = true;
      fit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h, graph.nodes.length]);

  const zoomBy = (factor: number, cx = size.w / 2, cy = size.h / 2) => {
    setView((v) => {
      const k = clamp(v.k * factor, 0.25, 2.5);
      return { k, x: cx - ((cx - v.x) / v.k) * k, y: cy - ((cy - v.y) / v.k) * k };
    });
  };

  const q = query.trim().toLowerCase();
  const matches = q ? graph.nodes.filter((n) => n.note.meta.title.toLowerCase().includes(q)) : [];
  const pos = (uid: string) => graph.nodes.find((n) => n.uid === uid);
  const selectedVisible = selected && pos(selected) ? selected : null;

  return (
    <div className="flex flex-1 min-w-0" data-testid="graph-view">
      <aside className="scroll bg-surface border-r border-line flex-none" style={{ width: 280, padding: "24px 20px" }} aria-label="Graph filters">
        <h1 className="t19 font-bold m-0 mb-5">Graph view</h1>
        <div className="caps mb-2">Folders</div>
        {base.categories.map((c) => {
          const on = !hiddenCats.has(c);
          return (
            <label key={c} className="flex items-center gap-2.5 t14 py-1.5 cursor-pointer select-none">
              <span className="grid place-items-center rounded-[5px] flex-none" style={{ width: 18, height: 18, background: on ? "var(--brand)" : "var(--surface)", border: `1.5px solid ${on ? "var(--brand)" : "var(--line)"}` }}>
                {on ? <Check size={13} color="var(--brand-ink)" strokeWidth={3} /> : null}
              </span>
              <input
                type="checkbox"
                className="sr-only"
                checked={on}
                onChange={() =>
                  setHiddenCats((prev) => {
                    const next = new Set(prev);
                    if (next.has(c)) next.delete(c);
                    else next.add(c);
                    return next;
                  })
                }
              />
              <span className="dot" style={{ background: colorOf(c) }} />
              <span className="truncate">{c}</span>
            </label>
          );
        })}
        {base.allTags.length > 0 ? (
          <>
            <div className="caps mt-6 mb-2">Tags</div>
            <div className="flex flex-wrap gap-2">
              {base.allTags.map((t) => (
                <button
                  key={t}
                  className="chip"
                  data-on={tags.has(t) || undefined}
                  aria-pressed={tags.has(t)}
                  onClick={() =>
                    setTags((prev) => {
                      const next = new Set(prev);
                      if (next.has(t)) next.delete(t);
                      else next.add(t);
                      return next;
                    })
                  }
                >
                  #{t}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="t12 text-muted mt-6 mb-0">Type #tags in your notes to filter the graph by them.</p>
        )}
        <div className="caps mt-6 mb-2">Depth from selected note</div>
        <div className="seg w-full" role="radiogroup" aria-label="Depth from selected note">
          {([1, 2, 3, 0] as const).map((d) => (
            <button key={d} className="flex-1" role="radio" aria-checked={depth === d} data-on={depth === d} onClick={() => setDepth(d)}>
              {d === 0 ? "All" : d}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-3 t14 mt-6 cursor-pointer">
          <Switch checked={showUnlinked} onChange={setShowUnlinked} label="Show unlinked notes" />
          Show unlinked notes
        </label>
        <label className="flex items-center gap-3 t14 mt-3.5 cursor-pointer">
          <Switch checked={recentOnly} onChange={setRecentOnly} label="Only notes edited this week" />
          Only notes edited this week
        </label>
      </aside>

      <div ref={wrap} className="relative flex-1 min-w-0 bg-canvas overflow-hidden">
        <div className="absolute" style={{ left: 20, top: 20, width: 300, zIndex: 5 }}>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input" style={{ paddingLeft: 36 }} placeholder="Find a note in the graph" aria-label="Find a note in the graph" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && matches[0] && setSelected(matches[0].uid)} />
          </div>
          {q && matches.length > 0 ? (
            <div className="menu mt-1.5">
              {matches.slice(0, 6).map((m) => (
                <button
                  key={m.uid}
                  className="menu-item"
                  onClick={() => {
                    setSelected(m.uid);
                    setQuery("");
                    setView((v) => ({ ...v, x: size.w / 2 - (m.x ?? 0) * v.k, y: size.h / 2 - (m.y ?? 0) * v.k }));
                  }}
                >
                  <span className="dot" style={{ background: colorOf(m.category) }} />
                  <span className="truncate">{m.note.meta.title}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <svg
          width={size.w}
          height={size.h}
          role="img"
          aria-label={`Graph of ${graph.nodes.length} notes and ${graph.links.length} links`}
          style={{ display: "block", cursor: pan.current ? "grabbing" : "grab", touchAction: "none" }}
          onWheel={(e) => {
            const r = wrap.current!.getBoundingClientRect();
            zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
          }}
          onPointerDown={(e) => {
            if ((e.target as Element).closest("[data-node]")) return;
            (e.currentTarget as Element).setPointerCapture(e.pointerId);
            pan.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
          }}
          onPointerMove={(e) => {
            const p = pan.current;
            if (p) setView((v) => ({ ...v, x: p.vx + e.clientX - p.x, y: p.vy + e.clientY - p.y }));
          }}
          onPointerUp={(e) => {
            const p = pan.current;
            pan.current = null;
            if (p && Math.abs(e.clientX - p.x) < 4 && Math.abs(e.clientY - p.y) < 4) setSelected(null);
          }}
        >
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            {graph.links.map((l) => {
              const a = pos(l.a);
              const b = pos(l.b);
              if (!a || !b) return null;
              const direct = selectedVisible && (l.a === selectedVisible || l.b === selectedVisible);
              const dim = near && !(near.has(l.a) && near.has(l.b));
              return <line key={`${l.a}|${l.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={direct ? "var(--brand)" : "var(--muted)"} strokeWidth={direct ? 2.4 : 1.2} strokeOpacity={direct ? 1 : dim ? 0.18 : 0.5} />;
            })}
            {graph.nodes.map((n) => {
              const r = 9 + Math.min(12, n.degree * 2.2);
              const isSel = n.uid === selectedVisible;
              const dim = near ? !near.has(n.uid) : false;
              const hit = q && n.note.meta.title.toLowerCase().includes(q);
              const color = colorOf(n.category);
              return (
                <g
                  key={n.uid}
                  data-node={n.uid}
                  transform={`translate(${n.x},${n.y})`}
                  opacity={dim ? 0.38 : 1}
                  style={{ cursor: "pointer" }}
                  tabIndex={0}
                  role="button"
                  aria-label={`${n.note.meta.title}, ${n.degree} link${n.degree === 1 ? "" : "s"}`}
                  onClick={() => setSelected(n.uid)}
                  onDoubleClick={() => openNote(n.uid)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setSelected(n.uid);
                  }}
                >
                  {isSel ? <circle r={r + 7} fill="none" stroke={color} strokeWidth={2} strokeOpacity={0.55} /> : null}
                  {hit ? <circle r={r + 5} fill="none" stroke="#f2a23a" strokeWidth={2.5} /> : null}
                  <circle r={r} fill={n.degree === 0 ? "color-mix(in srgb, " + color + " 55%, var(--canvas))" : color} stroke="var(--surface)" strokeWidth={2.5} />
                  <text y={r + 17} textAnchor="middle" style={{ fontSize: 12, fontWeight: isSel ? 700 : 500, fill: "var(--ink-2)", paintOrder: "stroke", stroke: "var(--canvas)", strokeWidth: 4, strokeLinejoin: "round" }}>
                    {n.note.meta.title.length > 26 ? n.note.meta.title.slice(0, 25) + "…" : n.note.meta.title}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {graph.nodes.length === 0 ? <div className="absolute inset-0 grid place-items-center t14 text-muted pointer-events-none">No notes match these filters.</div> : null}
        {selectedVisible ? <PreviewPanel uid={selectedVisible} onClose={() => setSelected(null)} /> : null}

        <div className="absolute flex items-center gap-4 t12 text-ink-2 flex-wrap" style={{ left: 20, bottom: 22, right: 230 }} data-testid="graph-legend">
          {base.categories
            .filter((c) => !hiddenCats.has(c))
            .map((c) => (
              <span key={c} className="flex items-center gap-1.5">
                <span className="dot" style={{ width: 8, height: 8, background: colorOf(c) }} /> {c}
              </span>
            ))}
          <span className="text-muted">Size = number of links</span>
        </div>
        <div className="absolute flex items-center bg-surface border border-line rounded-[9px]" style={{ right: 20, bottom: 16, height: 40, padding: "0 4px" }}>
          <button className="icon-btn" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
            <Minus size={16} />
          </button>
          <span className="t12 font-medium text-center" style={{ width: 44 }} aria-live="polite">
            {Math.round(view.k * 100)}%
          </span>
          <button className="icon-btn" aria-label="Zoom in" onClick={() => zoomBy(1.2)}>
            <Plus size={16} />
          </button>
          <span className="mx-1" style={{ width: 1, height: 20, background: "var(--line)" }} />
          <button className="btn btn-ghost btn-sm" onClick={fit}>
            <Scan size={14} /> Fit
          </button>
        </div>
      </div>
    </div>
  );
}
