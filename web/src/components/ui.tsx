import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Dialog as RDialog, DropdownMenu as RMenu, Popover as RPopover, Switch as RSwitch, Tooltip as RTooltip } from "radix-ui";
import { FileText, Lock, PenLine, X, CalendarDays } from "lucide-react";
import { NOTE_COLORS, type Note } from "../core/types";
import { avatarColor, initials } from "../lib/util";

export function Tip({ label, keys, children, side = "bottom" }: { label: string; keys?: string; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <RTooltip.Root delayDuration={350}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content className="tooltip" side={side} sideOffset={6}>
          {label}
          {keys ? <span className="kbd">{keys}</span> : null}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export function Avatar({ name, size = 28, title, style }: { name: string; id?: string; size?: number; title?: string; style?: CSSProperties }) {
  return (
    <span
      className="avatar"
      title={title ?? name}
      aria-label={name}
      style={{ width: size, height: size, background: avatarColor(name), fontSize: Math.max(9, Math.round(size * 0.38)), ...style }}
    >
      {initials(name)}
    </span>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <RSwitch.Root className="switch" checked={checked} onCheckedChange={onChange} aria-label={label} disabled={disabled} />;
}

export function Dot({ note, size = 10 }: { note: Pick<Note, "meta">; size?: number }) {
  return <span className="dot" style={{ width: size, height: size, background: NOTE_COLORS[note.meta.color] ?? NOTE_COLORS.green }} />;
}

export function NoteIcon({ note, size = 14 }: { note: Pick<Note, "meta">; size?: number }) {
  if (note.meta.sharedAccess === "private") return <Lock size={size} />;
  if (note.meta.type === "drawing") return <PenLine size={size} />;
  if (note.meta.type === "daily") return <CalendarDays size={size} />;
  return <FileText size={size} />;
}

export function Modal({
  open,
  onClose,
  title,
  icon,
  width = 480,
  children,
  footer,
  hideTitle,
  padded = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: ReactNode;
  width?: number;
  children: ReactNode;
  footer?: ReactNode;
  hideTitle?: boolean;
  padded?: boolean;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <RDialog.Portal>
        <RDialog.Overlay className="overlay" />
        <RDialog.Content className="dialog" style={{ width }} aria-describedby={undefined}>
          {hideTitle ? (
            <RDialog.Title className="sr-only">{title}</RDialog.Title>
          ) : (
            <div className="flex items-center gap-2.5 px-5 pt-5 pb-3">
              {icon ? <span className="text-brand flex">{icon}</span> : null}
              <RDialog.Title className="t19 font-bold flex-1 min-w-0 truncate m-0">{title}</RDialog.Title>
              <RDialog.Close className="icon-btn" aria-label="Close">
                <X size={18} />
              </RDialog.Close>
            </div>
          )}
          <div className={`scroll flex-1 min-h-0 ${padded ? "px-5 pb-5" : ""}`}>{children}</div>
          {footer ? <div className="flex items-center gap-3 px-5 py-4 border-t border-hair">{footer}</div> : null}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export const Menu = RMenu.Root;
export const MenuTrigger = RMenu.Trigger;

export function MenuContent({ children, align = "start", side = "bottom", width }: { children: ReactNode; align?: "start" | "end" | "center"; side?: "top" | "bottom" | "left" | "right"; width?: number }) {
  return (
    <RMenu.Portal>
      <RMenu.Content className="menu" align={align} side={side} sideOffset={6} style={width ? { width } : undefined} collisionPadding={8}>
        {children}
      </RMenu.Content>
    </RMenu.Portal>
  );
}

export function MenuItem({ icon, children, onSelect, danger, on, disabled, keep }: { icon?: ReactNode; children: ReactNode; onSelect?: () => void; danger?: boolean; on?: boolean; disabled?: boolean; keep?: boolean }) {
  return (
    <RMenu.Item
      className="menu-item"
      data-danger={danger || undefined}
      data-on={on || undefined}
      disabled={disabled}
      onSelect={(e) => {
        if (keep) e.preventDefault();
        onSelect?.();
      }}
    >
      {icon ? <span className="flex w-4 justify-center">{icon}</span> : null}
      {children}
    </RMenu.Item>
  );
}

export const MenuSep = () => <RMenu.Separator className="menu-sep" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => <RMenu.Label className="caps px-2.5 pt-2 pb-1">{children}</RMenu.Label>;

export const Popover = RPopover.Root;
export const PopoverTrigger = RPopover.Trigger;
export const PopoverAnchor = RPopover.Anchor;
export function PopoverContent({
  children,
  align = "start",
  side = "bottom",
  width,
  className = "",
  inline,
}: {
  children: ReactNode;
  align?: "start" | "end" | "center";
  side?: "top" | "bottom" | "left" | "right";
  width?: number;
  className?: string;
  /** Render inside the parent instead of a portal. Needed inside dialogs, whose focus trap ignores portalled fields. */
  inline?: boolean;
}) {
  const content = (
    <RPopover.Content className={`menu ${className}`} align={align} side={side} sideOffset={6} style={width ? { width } : undefined} collisionPadding={8}>
      {children}
    </RPopover.Content>
  );
  return inline ? content : <RPopover.Portal>{content}</RPopover.Portal>;
}

/** A small text prompt used for naming folders, groups and cards. */
export function Prompt({
  open,
  title,
  label,
  initial = "",
  placeholder,
  confirmLabel,
  onClose,
  onSubmit,
  hint,
}: {
  open: boolean;
  title: string;
  label: string;
  initial?: string;
  placeholder?: string;
  confirmLabel: string;
  onClose: () => void;
  onSubmit: (value: string) => void | Promise<void>;
  hint?: string;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setValue(initial);
      setError(null);
    }
  }, [open, initial]);
  const submit = async () => {
    if (!value.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit(value.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={420}
      footer={
        <>
          <span className="flex-1" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!value.trim() || busy}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <label className="field-label" htmlFor="prompt-input">
        {label}
      </label>
      <input
        id="prompt-input"
        ref={ref}
        className="input"
        value={value}
        placeholder={placeholder}
        autoFocus
        onFocus={(e) => e.target.select()}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      {hint ? <p className="t12 text-muted mt-2 mb-0">{hint}</p> : null}
      {error ? (
        <p className="t12 text-danger mt-2 mb-0" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}

export function Empty({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-2 py-14 px-6">
      {icon ? <div className="text-muted mb-1">{icon}</div> : null}
      <div className="t15 font-semibold">{title}</div>
      {body ? <div className="t13 text-muted max-w-[360px]">{body}</div> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
