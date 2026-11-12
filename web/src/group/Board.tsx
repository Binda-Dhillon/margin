import { useMemo, useState } from "react";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Calendar, CircleCheck, Ellipsis, ListChecks, MessageSquare, Pencil, Plus, Trash2 } from "lucide-react";
import { Avatar, Menu, MenuContent, MenuItem, MenuLabel, MenuSep, MenuTrigger, Modal, NoteIcon } from "../components/ui";
import type { Board as BoardData, Card } from "../core/types";
import { clock, dayMonth, daysUntil, newId, shortDate } from "../lib/util";
import type { Member } from "../lib/api";
import { addCard, deleteCard, openDialog, openNote, patchCard, saveColumns, useApp } from "../store/app";
import { liveCards } from "../store/select";
import { useDrawingImage } from "../notes/render";

export const LABELS: Record<string, { bg: string; fg: string }> = {
  Ethics: { bg: "#f9dfe0", fg: "#a8323a" },
  Research: { bg: "#fbf0cc", fg: "#7a5a12" },
  Admin: { bg: "#e7e1f5", fg: "#5b3f9e" },
  Writing: { bg: "#dcefe8", fg: "#22604f" },
  Analysis: { bg: "#dbe9fa", fg: "#22548f" },
  Design: { bg: "#ebe3f8", fg: "#6a3fa8" },
};
const EXTRA = [LABELS.Writing, LABELS.Analysis, LABELS.Research, LABELS.Admin, LABELS.Ethics];

export function labelStyle(label: string) {
  const preset = LABELS[label];
  if (preset) return { background: preset.bg, color: preset.fg };
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  const c = EXTRA[h % EXTRA.length];
  return { background: c.bg, color: c.fg };
}

function DueChip({ card, done }: { card: Card; done: boolean }) {
  if (done) {
    return (
      <span className="badge" style={{ background: "transparent", color: "var(--muted)", paddingLeft: 0 }}>
        <CircleCheck size={13} /> Done {dayMonth(card.movedAt)}
      </span>
    );
  }
  if (!card.due) return null;
  const left = daysUntil(card.due);
  const urgent = left <= 2;
  return (
    <span className={`badge ${urgent ? "badge-warn" : "badge-muted"}`} title={left < 0 ? "Overdue" : left === 0 ? "Due today" : `Due in ${left} day${left === 1 ? "" : "s"}`}>
      <Calendar size={12} /> {shortDate(card.due)}
      {left < 0 ? " · overdue" : ""}
    </span>
  );
}

function CardThumb({ uid }: { uid: string }) {
  const note = useApp((s) => s.notes[uid]);
  const image = useDrawingImage(note);
  if (!note || note.meta.type !== "drawing" || !image.url) return null;
  return (
    <div className="rounded-md grid place-items-center overflow-hidden my-2.5" style={{ height: 78, background: "color-mix(in srgb, #8e75cc 14%, var(--surface))" }}>
      <img src={image.url} alt="" style={{ maxHeight: 70, maxWidth: "92%", objectFit: "contain" }} />
    </div>
  );
}

function CardFace({ card, space, members, done, overlay }: { card: Card; space: string; members: Member[]; done: boolean; overlay?: boolean }) {
  const notes = useApp((s) => s.notes);
  const now = useApp((s) => s.now);
  const assignee = members.find((m) => m.id === card.assignee);
  const linked = card.notes.map((id) => ({ uid: `${space}/${id}`, note: notes[`${space}/${id}`] })).filter((x) => x.note);
  const sketch = linked.find((x) => x.note.meta.type === "drawing");
  const checkDone = card.checklist.filter((c) => c.done).length;
  const moved = card.movedAt !== card.created && now - Date.parse(card.movedAt) < 48 * 3600_000 && !done;
  return (
    <div style={overlay ? { boxShadow: "var(--shadow-lg)", borderRadius: 10 } : undefined}>
      {card.label ? (
        <span className="label mb-2" style={labelStyle(card.label)}>
          {card.label}
        </span>
      ) : null}
      <div className="t14 font-semibold" style={{ color: "var(--ink)" }}>
        {card.title}
      </div>
      {card.checklist.length > 0 && !done ? (
        <div className="rounded-full overflow-hidden mt-2" style={{ height: 4, background: "var(--hair)" }}>
          <div style={{ width: `${(checkDone / card.checklist.length) * 100}%`, height: "100%", background: "var(--brand)" }} />
        </div>
      ) : null}
      {sketch ? <CardThumb uid={sketch.uid} /> : null}
      {linked.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {linked.map(({ uid, note }) => (
            <span key={uid} className="chip" style={{ height: 24, borderRadius: 6 }}>
              <NoteIcon note={note} size={12} />
              <span className="truncate" style={{ maxWidth: 170 }}>
                {note.meta.title}
              </span>
            </span>
          ))}
        </div>
      ) : null}
      {moved ? (
        <div className="t11 text-muted mt-2.5">
          Moved here by {card.movedByName} · {clock(card.movedAt)}
        </div>
      ) : null}
      <div className="flex items-center gap-2.5 mt-2.5" style={{ minHeight: 24 }}>
        <DueChip card={card} done={done} />
        {card.checklist.length > 0 ? (
          <span className="flex items-center gap-1 t11 text-muted">
            <ListChecks size={13} /> {checkDone}/{card.checklist.length}
          </span>
        ) : null}
        {card.comments.length > 0 ? (
          <span className="flex items-center gap-1 t11 text-muted">
            <MessageSquare size={13} /> {card.comments.length}
          </span>
        ) : null}
        <span className="flex-1" />
        {assignee ? <Avatar name={assignee.name} id={assignee.id} size={24} /> : null}
      </div>
    </div>
  );
}

function SortableCard({ card, space, members, done }: { card: Card; space: string; members: Member[]; done: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className="card"
      role="button"
      aria-label={`${card.title}. Press Enter to open, Space to move.`}
      data-card={card.id}
      style={{ transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
      onClick={() => openDialog({ kind: "card", space, cardId: card.id })}
      onKeyDown={(e) => {
        if (e.key === "Enter") openDialog({ kind: "card", space, cardId: card.id });
        else listeners?.onKeyDown?.(e);
      }}
    >
      <CardFace card={card} space={space} members={members} done={done} />
    </div>
  );
}

function Column({ space, column, cards, members, isDone, index, total }: { space: string; column: BoardData["columns"][number]; cards: Card[]; members: Member[]; isDone: boolean; index: number; total: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column.id}` });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(column.name);
  const board = useApp((s) => s.boards[space]);
  const submit = () => {
    if (title.trim()) addCard(space, column.id, title.trim());
    setTitle("");
  };
  const move = (dir: -1 | 1) => {
    if (!board) return;
    const cols = [...board.columns];
    const j = index + dir;
    if (j < 0 || j >= cols.length) return;
    [cols[index], cols[j]] = [cols[j], cols[index]];
    saveColumns(space, cols);
  };
  return (
    <section className="column" aria-label={`${column.name}, ${cards.length} cards`} data-column={column.id} style={isOver ? { outline: "2px solid var(--brand)", outlineOffset: -2 } : undefined}>
      <header className="flex items-center gap-2 px-3.5 pt-3.5 pb-2">
        {renaming ? (
          <input
            className="input"
            style={{ height: 28 }}
            value={name}
            autoFocus
            aria-label="Column name"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              setRenaming(false);
              if (board && name.trim() && name.trim() !== column.name) saveColumns(space, board.columns.map((c) => (c.id === column.id ? { ...c, name: name.trim() } : c)));
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <>
            <h3 className="t14 font-semibold m-0">{column.name}</h3>
            <span className="t13 text-muted">{cards.length}</span>
          </>
        )}
        <span className="flex-1" />
        <Menu>
          <MenuTrigger asChild>
            <button className="icon-btn" style={{ width: 28, height: 28 }} aria-label={`Options for ${column.name}`}>
              <Ellipsis size={16} />
            </button>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem icon={<Plus size={14} />} onSelect={() => setAdding(true)}>
              Add card
            </MenuItem>
            <MenuItem icon={<Pencil size={14} />} onSelect={() => setRenaming(true)}>
              Rename column
            </MenuItem>
            <MenuItem disabled={index === 0} onSelect={() => move(-1)}>
              Move left
            </MenuItem>
            <MenuItem disabled={index === total - 1} onSelect={() => move(1)}>
              Move right
            </MenuItem>
            <MenuSep />
            <MenuItem
              icon={<Trash2 size={14} />}
              danger
              disabled={cards.length > 0 || total <= 1}
              onSelect={() => board && saveColumns(space, board.columns.filter((c) => c.id !== column.id))}
            >
              {cards.length > 0 ? "Empty the column to remove it" : "Remove column"}
            </MenuItem>
          </MenuContent>
        </Menu>
      </header>
      <div ref={setNodeRef} className="scroll flex flex-col gap-2.5 px-2.5 pb-2.5 flex-1" style={{ minHeight: 60 }}>
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {cards.map((card) => (
            <SortableCard key={card.id} card={card} space={space} members={members} done={isDone} />
          ))}
        </SortableContext>
        {adding ? (
          <div className="card" style={{ cursor: "default" }}>
            <input
              className="input"
              style={{ height: 34 }}
              placeholder="What needs doing?"
              aria-label={`New card in ${column.name}`}
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
                if (e.key === "Escape") {
                  setAdding(false);
                  setTitle("");
                }
              }}
              onBlur={() => {
                submit();
                setAdding(false);
              }}
            />
          </div>
        ) : (
          <button className="flex items-center justify-center gap-2 t13 font-medium text-ink-2 bg-transparent rounded-[10px]" style={{ height: 40, border: "1px dashed var(--line)", flex: "none" }} onClick={() => setAdding(true)} data-add-card={column.id}>
            <Plus size={15} /> Add card
          </button>
        )}
      </div>
    </section>
  );
}

export function Board({ space, members, filter }: { space: string; members: Member[]; filter: string | null }) {
  const board = useApp((s) => s.boards[space]);
  const [dragging, setDragging] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const byColumn = useMemo(() => {
    const map = new Map<string, Card[]>();
    for (const col of board?.columns ?? []) map.set(col.id, []);
    for (const card of liveCards(board)) {
      if (filter && card.assignee !== filter) continue;
      const list = map.get(card.column) ?? map.get(board!.columns[0]?.id);
      list?.push(card);
    }
    for (const list of map.values()) list.sort((a, b) => a.order - b.order);
    return map;
  }, [board, filter]);

  if (!board) return null;
  const doneId = board.columns[board.columns.length - 1]?.id;

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const { active, over } = e;
    if (!over) return;
    const card = board.cards[String(active.id)];
    if (!card) return;
    const overId = String(over.id);
    const targetCol = overId.startsWith("col:") ? overId.slice(4) : board.cards[overId]?.column;
    if (!targetCol) return;
    const list = (byColumn.get(targetCol) ?? []).filter((c) => c.id !== card.id);
    let index = list.length;
    if (!overId.startsWith("col:")) {
      index = list.findIndex((c) => c.id === overId);
      if (index === -1) index = list.length;
      else if (card.column === targetCol) {
        const original = byColumn.get(targetCol) ?? [];
        if (original.findIndex((c) => c.id === card.id) < original.findIndex((c) => c.id === overId)) index += 1;
      }
    }
    const before = list[index - 1]?.order;
    const after = list[index]?.order;
    const order = before === undefined && after === undefined ? 1 : before === undefined ? after! - 1 : after === undefined ? before + 1 : (before + after) / 2;
    if (card.column === targetCol && card.order === order) return;
    patchCard(space, card.id, { column: targetCol, order });
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={(e: DragStartEvent) => setDragging(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div className="scroll flex gap-4 flex-1 min-h-0 pb-4 items-start" style={{ paddingRight: 8 }} data-testid="board">
        {board.columns.map((col, i) => (
          <Column key={col.id} space={space} column={col} cards={byColumn.get(col.id) ?? []} members={members} isDone={col.id === doneId && board.columns.length > 1} index={i} total={board.columns.length} />
        ))}
        <button
          className="flex items-center justify-center gap-2 t13 font-medium text-ink-2 bg-transparent rounded-xl flex-none"
          style={{ width: 180, height: 46, border: "1px dashed var(--line)" }}
          onClick={() => saveColumns(space, [...board.columns.slice(0, -1), { id: newId("col"), name: "New column" }, ...board.columns.slice(-1)])}
        >
          <Plus size={15} /> Add column
        </button>
      </div>
      <DragOverlay>
        {dragging && board.cards[dragging] ? (
          <div className="card" style={{ width: 280, cursor: "grabbing", boxShadow: "var(--shadow-lg)" }}>
            <CardFace card={board.cards[dragging]} space={space} members={members} done={false} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// ---------------------------------------------------------- card dialog --

export function CardDialog({ space, cardId }: { space: string; cardId: string }) {
  const board = useApp((s) => s.boards[space]);
  const notes = useApp((s) => s.notes);
  const user = useApp((s) => s.user)!;
  const group = useApp((s) => s.groups.find((g) => `g:${g.id}` === space));
  const card = board?.cards[cardId];
  const [item, setItem] = useState("");
  const [comment, setComment] = useState("");
  const [customLabel, setCustomLabel] = useState(false);
  if (!board || !card || card.deleted) return null;
  const members = group?.members ?? [];
  const spaceNotes = Object.values(notes).filter((n) => n.space === space && n.meta.sharedAccess !== "private" && n.meta.type !== "daily");
  const update = (patch: Partial<Card>) => patchCard(space, cardId, patch);

  return (
    <Modal
      open
      onClose={() => openDialog(null)}
      title="Card"
      hideTitle
      width={640}
      footer={
        <>
          <button
            className="btn btn-danger btn-ghost"
            onClick={() => {
              deleteCard(space, cardId);
              openDialog(null);
            }}
          >
            <Trash2 size={15} /> Delete card
          </button>
          <span className="flex-1 t11 text-muted text-right">
            Moved to {board.columns.find((c) => c.id === card.column)?.name} by {card.movedByName} · {shortDate(card.movedAt)}, {clock(card.movedAt)}
          </span>
          <button className="btn btn-primary" onClick={() => openDialog(null)}>
            Done
          </button>
        </>
      }
    >
      <div className="pt-5">
        <input className="input t16 font-semibold" style={{ height: 44 }} value={card.title} aria-label="Card title" onChange={(e) => update({ title: e.target.value })} />
        <div className="grid gap-4 mt-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label className="field-label" htmlFor="card-col">
              Column
            </label>
            <select id="card-col" className="input" value={card.column} onChange={(e) => update({ column: e.target.value })}>
              {board.columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="card-who">
              Assigned to
            </label>
            <select id="card-who" className="input" value={card.assignee ?? ""} onChange={(e) => update({ assignee: e.target.value || null })}>
              <option value="">Nobody yet</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.id === user.id ? " (you)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="card-due">
              Due date
            </label>
            <input id="card-due" type="date" className="input" value={card.due ?? ""} onChange={(e) => update({ due: e.target.value || null })} />
          </div>
          <div>
            <label className="field-label" htmlFor="card-label">
              Category
            </label>
            {customLabel || (card.label && !LABELS[card.label]) ? (
              <input id="card-label" className="input" value={card.label} placeholder="Type a category" autoFocus={customLabel} onChange={(e) => update({ label: e.target.value.slice(0, 24) })} />
            ) : (
              <select
                id="card-label"
                className="input"
                value={card.label}
                onChange={(e) => {
                  if (e.target.value === "__custom") {
                    setCustomLabel(true);
                    update({ label: "" });
                  } else update({ label: e.target.value });
                }}
              >
                <option value="">None</option>
                {Object.keys(LABELS).map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
                <option value="__custom">Other…</option>
              </select>
            )}
          </div>
        </div>

        <label className="field-label mt-4" htmlFor="card-desc">
          Details
        </label>
        <textarea id="card-desc" className="input" rows={3} value={card.description} placeholder="Anything the group should know" onChange={(e) => update({ description: e.target.value })} />

        <div className="caps mt-5 mb-2">Linked notes</div>
        <div className="flex flex-wrap gap-2 items-center">
          {card.notes.map((id) => {
            const note = notes[`${space}/${id}`];
            if (!note) return null;
            return (
              <span key={id} className="chip" style={{ paddingRight: 4 }}>
                <NoteIcon note={note} size={12} />
                <button
                  className="bg-transparent border-0 p-0 font-medium truncate"
                  style={{ maxWidth: 200, color: "inherit" }}
                  onClick={() => {
                    openDialog(null);
                    openNote(`${space}/${id}`);
                  }}
                >
                  {note.meta.title}
                </button>
                <button className="icon-btn" style={{ width: 20, height: 20 }} aria-label={`Remove ${note.meta.title}`} onClick={() => update({ notes: card.notes.filter((n) => n !== id) })}>
                  ×
                </button>
              </span>
            );
          })}
          <Menu>
            <MenuTrigger asChild>
              <button className="chip" style={{ background: "transparent", boxShadow: "inset 0 0 0 1px var(--line)" }}>
                <Plus size={12} /> Link a note
              </button>
            </MenuTrigger>
            <MenuContent width={280}>
              <MenuLabel>Notes in this group</MenuLabel>
              <div className="scroll" style={{ maxHeight: 240 }}>
                {spaceNotes.filter((n) => !card.notes.includes(n.meta.id)).length === 0 ? <div className="menu-note">No more notes to link.</div> : null}
                {spaceNotes
                  .filter((n) => !card.notes.includes(n.meta.id))
                  .map((n) => (
                    <MenuItem key={n.meta.id} icon={<NoteIcon note={n} size={14} />} onSelect={() => update({ notes: [...card.notes, n.meta.id] })}>
                      <span className="truncate">{n.meta.title}</span>
                    </MenuItem>
                  ))}
              </div>
            </MenuContent>
          </Menu>
        </div>

        <div className="caps mt-5 mb-2">Checklist</div>
        {card.checklist.map((c) => (
          <div key={c.id} className="flex items-center gap-2.5 py-1 prose" style={{ fontSize: "calc(14px * var(--ts))" }}>
            <input type="checkbox" checked={c.done} aria-label={c.text} onChange={(e) => update({ checklist: card.checklist.map((x) => (x.id === c.id ? { ...x, done: e.target.checked } : x)) })} />
            <span className="flex-1" style={c.done ? { textDecoration: "line-through", color: "var(--muted)" } : undefined}>
              {c.text}
            </span>
            <button className="icon-btn" style={{ width: 24, height: 24 }} aria-label={`Remove ${c.text}`} onClick={() => update({ checklist: card.checklist.filter((x) => x.id !== c.id) })}>
              ×
            </button>
          </div>
        ))}
        <input
          className="input mt-1.5"
          style={{ height: 34 }}
          placeholder="Add a step and press Enter"
          aria-label="Add a checklist step"
          value={item}
          onChange={(e) => setItem(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && item.trim()) {
              update({ checklist: [...card.checklist, { id: newId("i"), text: item.trim(), done: false }] });
              setItem("");
            }
          }}
        />

        <div className="caps mt-5 mb-2">Comments</div>
        {card.comments.map((c) => (
          <div key={c.id} className="flex gap-2.5 py-1.5">
            <Avatar name={c.byName} id={c.byId} size={26} />
            <div className="min-w-0">
              <div className="t12">
                <strong>{c.byName}</strong> <span className="text-muted">· {shortDate(c.at)}, {clock(c.at)}</span>
              </div>
              <div className="t13">{c.text}</div>
            </div>
          </div>
        ))}
        <input
          className="input mt-1.5"
          style={{ height: 34 }}
          placeholder="Write a comment and press Enter"
          aria-label="Write a comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && comment.trim()) {
              update({ comments: [...card.comments, { id: newId("m"), byId: user.id, byName: user.name, text: comment.trim(), at: new Date().toISOString() }] });
              setComment("");
            }
          }}
        />
      </div>
    </Modal>
  );
}
