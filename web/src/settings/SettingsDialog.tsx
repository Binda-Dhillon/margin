import { useEffect, useMemo, useState } from "react";
import { Dialog as RDialog, Slider } from "radix-ui";
import { Bell, Check, ChevronDown, ChevronUp, Copy, Heart, KeyRound, Keyboard, LogOut, Pipette, Search, Trash2, Type, User, X } from "lucide-react";
import { Avatar, Popover, PopoverContent, PopoverTrigger, Switch } from "../components/ui";
import type { Settings } from "../core/types";
import { api, authClient } from "../lib/api";
import { contrastOnWhite, MOD, stamp } from "../lib/util";
import { openDialog, personalKey, signOut, updateSettings, useApp } from "../store/app";

const SECTIONS = [
  { id: "account", label: "Account", icon: User },
  { id: "display", label: "Display & accessibility", icon: Type },
  { id: "focus", label: "Focus & well-being", icon: Heart },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
] as const;

/** Accent presets all pass 4.5:1 against white, so text on them stays readable. */
const ACCENTS = [
  { value: "#2d6a5f", name: "Teal" },
  { value: "#1f6f9c", name: "Blue" },
  { value: "#7550b8", name: "Purple" },
  { value: "#b0522d", name: "Rust" },
];

const FONTS: { name: string; note?: string; included?: boolean }[] = [
  { name: "Inter", note: "Default", included: true },
  { name: "Lexend", note: "Easier reading", included: true },
  { name: "Atkinson Hyperlegible", note: "Low vision", included: true },
  { name: "OpenDyslexic", note: "Dyslexia", included: true },
  ...["Arial", "Calibri", "Cambria", "Candara", "Century Gothic", "Comic Sans MS", "Courier New", "Georgia", "Gill Sans", "Helvetica Neue", "Lucida Sans", "Optima", "Palatino", "Segoe UI", "Tahoma", "Times New Roman", "Trebuchet MS", "Verdana"].map((name) => ({ name })),
];

function Row({ title, hint, children, n }: { title: string; hint?: string; children: React.ReactNode; n?: string }) {
  return (
    <div className="flex items-center gap-6 border-b border-hair" style={{ minHeight: 68, padding: "12px 0" }} data-setting={n}>
      <div className="flex-1 min-w-0">
        <div className="t15 font-semibold">{title}</div>
        {hint ? <div className="t12 text-muted mt-0.5">{hint}</div> : null}
      </div>
      <div className="flex-none">{children}</div>
    </div>
  );
}

function FontPicker({ value, onChange }: { value: string; onChange: (f: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const list = FONTS.filter((f) => f.name.toLowerCase().includes(query.trim().toLowerCase()));
  const mark = (name: string) => {
    const q = query.trim();
    const i = q ? name.toLowerCase().indexOf(q.toLowerCase()) : -1;
    if (i === -1) return name;
    return (
      <>
        {name.slice(0, i)}
        <strong>{name.slice(i, i + q.length)}</strong>
        {name.slice(i + q.length)}
      </>
    );
  };
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button className="btn" style={{ width: 240, justifyContent: "space-between", fontWeight: 500, height: 40, borderColor: open ? "var(--brand)" : undefined, boxShadow: open ? "0 0 0 1px var(--brand)" : undefined }} aria-label={`Font: ${value}`} data-testid="font-picker">
          <span className="flex items-center gap-2">
            <span className="font-semibold">{value}</span>
            {FONTS.find((f) => f.name === value)?.note ? <span className="badge badge-muted" style={{ height: 18 }}>{FONTS.find((f) => f.name === value)?.note}</span> : null}
          </span>
          {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      </PopoverTrigger>
      <PopoverContent width={240} align="end" inline>
        <div className="relative mb-1.5">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input" style={{ height: 34, paddingLeft: 30, paddingRight: 64 }} placeholder="Search fonts" aria-label="Search fonts" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 t11 text-muted">
            {list.length} of {FONTS.length}
          </span>
        </div>
        <div className="scroll" style={{ maxHeight: 230 }} role="listbox" aria-label="Fonts">
          {list.map((f) => (
            <button
              key={f.name}
              role="option"
              aria-selected={value === f.name}
              className="menu-item"
              data-on={value === f.name || undefined}
              style={{ fontFamily: `"${f.name === "Inter" ? "Inter Variable" : f.name}", var(--font)` }}
              onClick={() => {
                onChange(f.name);
                setOpen(false);
              }}
            >
              <span className="flex-1">{mark(f.name)}</span>
              {f.included ? null : <span className="t10 text-muted" style={{ fontFamily: "var(--font)" }}>if installed</span>}
            </button>
          ))}
          {list.length === 0 ? <div className="menu-note">No fonts match.</div> : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Display({ s }: { s: Settings }) {
  const [custom, setCustom] = useState(s.accent);
  const [warn, setWarn] = useState<string | null>(null);
  const isPreset = ACCENTS.some((a) => a.value.toLowerCase() === s.accent.toLowerCase());
  const tryCustom = (hex: string) => {
    setCustom(hex);
    const ratio = contrastOnWhite(hex);
    if (ratio < 4.5) {
      setWarn(`That colour is too light for readable text (contrast ${ratio.toFixed(1)}:1, needs 4.5:1). Pick a darker shade.`);
      return;
    }
    setWarn(null);
    updateSettings({ accent: hex });
  };
  return (
    <div className="flex gap-7 flex-wrap">
      <div className="flex-1" style={{ minWidth: 360 }}>
        <Row title="Text size" n="text-size">
          <div className="flex items-center gap-3">
            <span className="t12 text-muted">A</span>
            <Slider.Root className="relative flex items-center select-none" style={{ width: 150, height: 20, touchAction: "none" }} min={12} max={24} step={1} value={[s.textSize]} onValueChange={([v]) => updateSettings({ textSize: v })} aria-label="Text size">
              <Slider.Track className="relative grow rounded-full" style={{ height: 4, background: "var(--line)" }}>
                <Slider.Range className="absolute rounded-full h-full" style={{ background: "var(--brand)" }} />
              </Slider.Track>
              <Slider.Thumb aria-label="Text size" className="block rounded-full" style={{ width: 18, height: 18, background: "var(--surface)", border: "2px solid var(--brand)", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
            </Slider.Root>
            <span className="t19 text-muted" style={{ fontSize: 20 }}>
              A
            </span>
            <span className="t14 font-semibold whitespace-nowrap" style={{ minWidth: 46, fontVariantNumeric: "tabular-nums" }} data-testid="text-size-value">
              {s.textSize} px
            </span>
          </div>
        </Row>
        <Row title="Primary colour" hint={warn ?? undefined} n="accent">
          <div className="flex items-center gap-2.5">
            {ACCENTS.map((a) => {
              const on = s.accent.toLowerCase() === a.value;
              return (
                <button
                  key={a.value}
                  aria-label={a.name}
                  aria-pressed={on}
                  title={a.name}
                  className="grid place-items-center rounded-full border-0"
                  style={{ width: 30, height: 30, background: a.value, boxShadow: on ? `0 0 0 2px var(--surface), 0 0 0 4px ${a.value}` : "none" }}
                  onClick={() => {
                    setWarn(null);
                    updateSettings({ accent: a.value });
                  }}
                >
                  {on ? <Check size={15} color="#fff" strokeWidth={3} /> : null}
                </button>
              );
            })}
            <label className="btn btn-sm relative" style={{ height: 32, boxShadow: !isPreset ? "0 0 0 2px var(--brand)" : undefined }}>
              <Pipette size={14} /> Custom
              <input type="color" className="absolute inset-0 opacity-0 cursor-pointer" value={custom} onChange={(e) => tryCustom(e.target.value)} aria-label="Custom primary colour" />
            </label>
          </div>
        </Row>
        <Row title="Theme" n="theme">
          <div className="seg" role="radiogroup" aria-label="Theme">
            {(["light", "dark", "system"] as const).map((t) => (
              <button key={t} role="radio" aria-checked={s.theme === t} data-on={s.theme === t} onClick={() => updateSettings({ theme: t })}>
                {t === "light" ? "Light" : t === "dark" ? "Dark" : "Match system"}
              </button>
            ))}
          </div>
        </Row>
        <Row title="High contrast" hint="Makes text and borders darker" n="contrast">
          <Switch checked={s.highContrast} onChange={(v) => updateSettings({ highContrast: v })} label="High contrast" />
        </Row>
        <Row title="Reduce motion" hint="Turn off animations and zoom effects" n="motion">
          <Switch checked={s.reduceMotion} onChange={(v) => updateSettings({ reduceMotion: v })} label="Reduce motion" />
        </Row>
        <Row title="Font" n="font">
          <FontPicker value={s.font} onChange={(font) => updateSettings({ font })} />
        </Row>
      </div>

      <div style={{ width: 280 }}>
        <div className="caps mb-2">Preview</div>
        <div className="border border-line rounded-xl overflow-hidden bg-surface" data-testid="settings-preview">
          <div className="flex items-center gap-2.5 px-3.5 border-b border-hair t14 font-semibold" style={{ height: 40 }}>
            <span className="dot" style={{ background: "#5fa88c" }} /> Lecture 6
          </div>
          <div className="p-3.5">
            <div className="font-bold" style={{ fontSize: "calc(20px * var(--ts))" }}>
              Sampling
            </div>
            <p className="mt-2 mb-3" style={{ fontSize: "calc(15px * var(--ts))", lineHeight: 1.5 }}>
              Simple random: every member has an equal chance of selection.
            </p>
            <div className="flex items-center gap-3">
              <span className="btn btn-primary btn-sm">Open note</span>
              <span className="t13 font-semibold underline" style={{ color: "var(--brand)" }}>
                Linked sketch
              </span>
            </div>
          </div>
        </div>
        <div className="rounded-xl p-3.5 mt-4" style={{ background: "var(--brand-tint)" }}>
          <div className="flex items-center gap-2 t13 font-semibold" style={{ color: "var(--brand)" }}>
            <Heart size={14} /> Focus & well-being
          </div>
          {[
            { label: "Break reminders", hint: `Every ${s.focusMinutes} min in Focus mode`, on: s.breakReminders, set: (v: boolean) => updateSettings({ breakReminders: v }) },
            { label: "Quiet hours", hint: `${s.quietHours.from} to ${s.quietHours.to}`, on: s.quietHours.on, set: (v: boolean) => updateSettings({ quietHours: { ...s.quietHours, on: v } }) },
            { label: "Weekly summary", hint: "From daily check-ins", on: s.weeklySummary, set: (v: boolean) => updateSettings({ weeklySummary: v }) },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-3 mt-3">
              <div className="flex-1">
                <div className="t13 font-semibold">{item.label}</div>
                <div className="t11 text-ink-2">{item.hint}</div>
              </div>
              <Switch checked={item.on} onChange={item.set} label={item.label} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Wellbeing({ s }: { s: Settings }) {
  return (
    <div style={{ maxWidth: 620 }}>
      <Row title="Focus session length" hint="How long one Focus session runs before a break is suggested">
        <select className="input" style={{ width: 150 }} value={s.focusMinutes} onChange={(e) => updateSettings({ focusMinutes: Number(e.target.value) })} aria-label="Focus session length">
          {[1, 15, 20, 25, 30, 45, 50].map((m) => (
            <option key={m} value={m}>
              {m} minute{m === 1 ? "" : "s"}
            </option>
          ))}
        </select>
      </Row>
      <Row title="Break reminders" hint="Suggest a short break when a Focus session ends. You can always skip it.">
        <Switch checked={s.breakReminders} onChange={(v) => updateSettings({ breakReminders: v })} label="Break reminders" />
      </Row>
      <Row title="Break length">
        <select className="input" style={{ width: 150 }} value={s.breakMinutes} onChange={(e) => updateSettings({ breakMinutes: Number(e.target.value) })} aria-label="Break length">
          {[3, 5, 10, 15].map((m) => (
            <option key={m} value={m}>
              {m} minutes
            </option>
          ))}
        </select>
      </Row>
      <Row title="Quiet hours" hint="Hold notifications between these times. They are shown when quiet hours end.">
        <div className="flex items-center gap-2.5">
          <input type="time" className="input" style={{ width: 110 }} value={s.quietHours.from} disabled={!s.quietHours.on} aria-label="Quiet hours start" onChange={(e) => updateSettings({ quietHours: { ...s.quietHours, from: e.target.value } })} />
          <span className="t13 text-muted">to</span>
          <input type="time" className="input" style={{ width: 110 }} value={s.quietHours.to} disabled={!s.quietHours.on} aria-label="Quiet hours end" onChange={(e) => updateSettings({ quietHours: { ...s.quietHours, to: e.target.value } })} />
          <Switch checked={s.quietHours.on} onChange={(v) => updateSettings({ quietHours: { ...s.quietHours, on: v } })} label="Quiet hours" />
        </div>
      </Row>
      <Row title="Weekly summary" hint="Show your week of check-ins, focus time and finished plan items in the daily note. It stays private to you.">
        <Switch checked={s.weeklySummary} onChange={(v) => updateSettings({ weeklySummary: v })} label="Weekly summary" />
      </Row>
    </div>
  );
}

function Notifications({ s }: { s: Settings }) {
  return (
    <div style={{ maxWidth: 620 }}>
      <Row title="Group changes" hint="Tell me when someone else updates notes in one of my groups">
        <Switch checked={s.notifyGroupChanges} onChange={(v) => updateSettings({ notifyGroupChanges: v })} label="Group changes" />
      </Row>
      <Row title="Onboarding tips" hint="Show the short tour of the toolbar again">
        <button className="btn btn-sm" onClick={() => { updateSettings({ tips: { step: 0, done: false }, checklist: { ...s.checklist, dismissed: false } }); openDialog(null); }}>
          Replay tips
        </button>
      </Row>
      <p className="t13 text-muted mt-4">Notifications are held while a Focus session is running and during quiet hours, then shown together afterwards. Clashing edits are always shown straight away.</p>
    </div>
  );
}

function Shortcuts() {
  const rows: [string, string][] = [
    ["New text note", "N"],
    ["New drawing", "D"],
    ["Link the open note", "L"],
    ["Group board", "B"],
    ["Today’s daily note", "T"],
    ["Graph view", "G"],
    ["Focus mode", "Shift F"],
    ["Search all notes (from the main window)", `${MOD} F`],
    ["Find inside the open note (cursor in the note)", `${MOD} F`],
    ["Search all notes (from anywhere)", `${MOD} K`],
    ["Leave focus mode, close a dialog or the find bar", "Esc"],
    ["Bold / italic / underline", `${MOD} B / I / U`],
  ];
  return (
    <div style={{ maxWidth: 620 }}>
      {rows.map(([label, keys]) => (
        <div key={label} className="flex items-center border-b border-hair t14" style={{ minHeight: 46 }}>
          <span className="flex-1">{label}</span>
          <span className="kbd">{keys}</span>
        </div>
      ))}
      <p className="t13 text-muted mt-4">Single-letter shortcuts work when you are not typing in a note or a field. Hover any toolbar button to see its shortcut.</p>
    </div>
  );
}

interface Token {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
}

function Account() {
  const user = useApp((s) => s.user)!;
  const groups = useApp((s) => s.groups);
  const [name, setName] = useState(user.name);
  const [saved, setSaved] = useState(false);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const load = () => api<{ tokens: Token[] }>("GET", "/api/tokens").then((r) => setTokens(r.tokens)).catch(() => undefined);
  useEffect(() => {
    void load();
  }, []);
  const origin = window.location.origin;
  const examples = useMemo(() => [{ label: "My notes", url: `${origin}/git/${personalKey().replace(":", "/")}.git` }, ...groups.map((g) => ({ label: g.name, url: `${origin}/git/g/${g.id}.git` }))], [groups, origin]);

  return (
    <div style={{ maxWidth: 680 }}>
      <label className="field-label" htmlFor="acct-name">
        Name shown to your groups
      </label>
      <div className="flex gap-2">
        <input id="acct-name" className="input" value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} />
        <button
          className="btn"
          style={{ height: 40 }}
          disabled={!name.trim() || name.trim() === user.name}
          onClick={async () => {
            await authClient.updateUser({ name: name.trim() });
            useApp.setState({ user: { ...user, name: name.trim() } });
            setSaved(true);
          }}
        >
          {saved ? "Saved" : "Save"}
        </button>
      </div>
      <label className="field-label mt-4" htmlFor="acct-email">
        Email
      </label>
      <input id="acct-email" className="input" value={user.email} readOnly />

      <div className="flex items-center gap-2 t15 font-semibold mt-8">
        <KeyRound size={16} /> Your folders as plain git
      </div>
      <p className="t13 text-muted mt-1.5">
        Every space is a git repository on this server. To keep a real folder of your notes on a computer, create an access token and clone with any git client. Use any username and the token as the password.
      </p>
      <div className="rounded-lg bg-surface-2 p-3 t12" style={{ fontFamily: "ui-monospace, monospace", overflowX: "auto" }}>
        {examples.map((e) => (
          <div key={e.url} className="whitespace-nowrap">
            <span className="text-muted"># {e.label}</span>
            <br />
            git clone {e.url}
          </div>
        ))}
      </div>
      {fresh ? (
        <div className="rounded-lg p-3 mt-3 t13" style={{ background: "var(--brand-tint)" }} role="status">
          <strong>Copy this token now.</strong> It is not shown again.
          <div className="flex gap-2 mt-2">
            <input className="input" readOnly value={fresh} onFocus={(e) => e.target.select()} style={{ fontFamily: "ui-monospace, monospace" }} aria-label="New access token" />
            <button className="btn" style={{ height: 40 }} onClick={() => void navigator.clipboard.writeText(fresh)}>
              <Copy size={15} /> Copy
            </button>
          </div>
        </div>
      ) : null}
      {tokens.map((t) => (
        <div key={t.id} className="flex items-center gap-3 border-b border-hair t13" style={{ minHeight: 46 }}>
          <span className="font-medium flex-1">{t.name}</span>
          <span className="text-muted t12">{t.lastUsedAt ? `last used ${stamp(t.lastUsedAt)}` : `created ${stamp(t.createdAt)}`}</span>
          <button
            className="icon-btn"
            aria-label={`Delete token ${t.name}`}
            onClick={async () => {
              await api("DELETE", `/api/tokens/${t.id}`);
              void load();
            }}
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      <button
        className="btn mt-3"
        onClick={async () => {
          const r = await api<{ token: string }>("POST", "/api/tokens", { name: `Git access ${new Date().toLocaleDateString()}` });
          setFresh(r.token);
          void load();
        }}
      >
        <KeyRound size={15} /> Create access token
      </button>
    </div>
  );
}

export function SettingsDialog({ section }: { section?: string }) {
  const user = useApp((s) => s.user)!;
  const settings = useApp((s) => s.settings);
  const [current, setCurrent] = useState(section ?? "display");
  const title = SECTIONS.find((s) => s.id === current)?.label ?? "Settings";
  return (
    <RDialog.Root open onOpenChange={(o) => !o && openDialog(null)}>
      <RDialog.Portal>
        <RDialog.Overlay className="overlay" />
        <RDialog.Content className="dialog" style={{ width: 1100, height: 800, flexDirection: "row" }} aria-describedby={undefined} data-testid="settings">
          <nav className="flex flex-col flex-none bg-surface-3 border-r border-hair" style={{ width: 250, padding: "26px 14px 20px" }} aria-label="Settings sections">
            <div className="t19 font-bold px-2.5 mb-5">Settings</div>
            {SECTIONS.map((s) => (
              <button key={s.id} className="side-item" style={{ height: 40, background: current === s.id ? "var(--surface)" : undefined, color: current === s.id ? "var(--brand)" : undefined, boxShadow: current === s.id ? "0 1px 3px rgba(29,35,33,0.1)" : undefined }} aria-current={current === s.id} onClick={() => setCurrent(s.id)}>
                <s.icon size={17} />
                {s.label}
              </button>
            ))}
            <span className="flex-1" />
            <div className="flex items-center gap-2.5 px-2">
              <Avatar name={user.name} id={user.id} size={32} />
              <div className="min-w-0">
                <div className="t13 font-semibold truncate">{user.name}</div>
                <div className="t11 text-muted truncate">{user.email}</div>
              </div>
            </div>
            <button className="flex items-center gap-2.5 t14 font-medium bg-transparent border-0 px-2.5 mt-3.5 rounded-lg hover:bg-surface-2" style={{ color: "var(--danger)", height: 36 }} onClick={() => void signOut()}>
              <LogOut size={16} /> Log out
            </button>
          </nav>
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex items-center" style={{ padding: "24px 28px 8px" }}>
              <RDialog.Title className="font-bold m-0 flex-1" style={{ fontSize: "calc(22px * var(--ts))" }}>
                {title}
              </RDialog.Title>
              <RDialog.Close className="icon-btn" aria-label="Close settings">
                <X size={18} />
              </RDialog.Close>
            </div>
            <div className="scroll flex-1 min-h-0" style={{ padding: "8px 28px 28px" }}>
              {current === "account" ? <Account /> : null}
              {current === "display" ? <Display s={settings} /> : null}
              {current === "focus" ? <Wellbeing s={settings} /> : null}
              {current === "notifications" ? <Notifications s={settings} /> : null}
              {current === "shortcuts" ? <Shortcuts /> : null}
            </div>
          </div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
