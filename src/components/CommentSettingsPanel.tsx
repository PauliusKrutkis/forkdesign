import { useEffect } from "react";
import type {
  OverlayModel,
  OverlayPosition,
  OverlaySettings,
  OverlayTheme,
} from "./settings";

type Props = {
  settings: OverlaySettings;
  /** Patch updater: caller merges into the persisted shape. */
  onChange: (patch: Partial<OverlaySettings>) => void;
  onClose: () => void;
};

/**
 * Compact right-side drawer (~320px) listing user-facing toggles for the
 * comment overlay. Distinct from CommentManagementPanel (360px, content
 * browser) — this one is meta-controls only.
 *
 * Lives on top of the management panel z-stack so the user can pop it while
 * the list is open without losing context. Esc closes; the parent listens
 * for the `,` hotkey to toggle.
 */
export function CommentSettingsPanel({ settings, onChange, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside
      data-comment-overlay="true"
      role="dialog"
      aria-label="Comment settings"
      className="pointer-events-auto fixed inset-y-0 right-0 z-[9300] flex w-[320px] animate-[slideInRight_220ms_ease-out] flex-col border-l border-[var(--co-line-strong)] bg-[var(--co-surface)] shadow-2xl"
      style={{ animationName: "slideInRight" }}
      onClick={(e) => e.stopPropagation()}
    >
      <style>{`@keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>

      <header className="flex shrink-0 items-center justify-between border-b border-[var(--co-line)] bg-[var(--co-surface-2)] px-4 py-3">
        <span className="font-[var(--co-font-mono)] text-[11px] uppercase tracking-[var(--co-tracking-micro)] text-[var(--co-ink-2)]">
          Settings
        </span>
        <button
          type="button"
          aria-label="Close settings"
          onClick={onClose}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-[4px] text-[var(--co-ink-2)] transition-colors hover:bg-[var(--co-surface-3)] hover:text-[var(--co-ink)]"
        >
          <span aria-hidden className="text-[15px] leading-none">
            ×
          </span>
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <Section label="Comments">
          <SwitchRow
            checked={settings.enabled}
            onChange={(v) => onChange({ enabled: v })}
            label={settings.enabled ? "On" : "Off"}
            hint={
              settings.enabled
                ? "Dots, bubbles, and panel are active."
                : "System loaded but hidden. Reopen here."
            }
          />
        </Section>

        <Section label="Position">
          <PositionGrid
            value={settings.position}
            onChange={(v) => onChange({ position: v })}
          />
        </Section>

        <Section label="Theme">
          <ThemeRow
            value={settings.theme}
            onChange={(v) => onChange({ theme: v })}
          />
        </Section>

        <Section label="Author">
          <input
            type="text"
            value={settings.author}
            onChange={(e) => onChange({ author: e.target.value })}
            placeholder="dev@local"
            className="block w-full rounded-[4px] border border-[var(--co-line-strong)] bg-[var(--co-surface)] px-2.5 py-1.5 text-[12.5px] text-[var(--co-ink)] placeholder:text-[var(--co-ink-4)] focus:border-[var(--co-ink)] focus:outline-none"
          />
          <p className="m-0 mt-1 font-[var(--co-font-mono)] text-[10px] uppercase tracking-[0.04em] text-[var(--co-ink-3)]">
            Stamps new comments. Empty = use default.
          </p>
        </Section>

        <Section label="AI model">
          {/*
            Wiring to the server is task #23/future (#28). The composer/bubble
            iterate POST does not yet honour this value — persistence here
            keeps the user-visible setting stable so future plumbing is a
            one-line change.
          */}
          <select
            value={settings.model}
            onChange={(e) =>
              onChange({ model: e.target.value as OverlayModel })
            }
            className="block w-full rounded-[4px] border border-[var(--co-line-strong)] bg-[var(--co-surface)] px-2.5 py-1.5 text-[12.5px] text-[var(--co-ink)] focus:border-[var(--co-ink)] focus:outline-none"
          >
            <option value="default">Default</option>
            <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
            <option value="claude-opus-4-7">claude-opus-4-7</option>
          </select>
        </Section>
      </div>
    </aside>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5 last:mb-0">
      <h3 className="m-0 mb-2 font-[var(--co-font-mono)] text-[10px] uppercase tracking-[var(--co-tracking-micro)] text-[var(--co-ink-3)]">
        {label}
      </h3>
      {children}
    </section>
  );
}

function SwitchRow({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-[var(--co-radius-pill)] border transition-colors ${
          checked
            ? "border-[var(--co-ink)] bg-[var(--co-ink)]"
            : "border-[var(--co-line-strong)] bg-[var(--co-surface-3)]"
        }`}
      >
        <span
          aria-hidden
          className={`block h-3.5 w-3.5 rounded-full bg-[var(--co-surface)] shadow transition-transform ${
            checked ? "translate-x-[18px]" : "translate-x-[2px]"
          }`}
        />
      </button>
      <div className="min-w-0 flex-1">
        <span className="block font-[var(--co-font-mono)] text-[11px] uppercase tracking-[0.06em] text-[var(--co-ink)]">
          {label}
        </span>
        {hint ? (
          <span className="block text-[11.5px] leading-[1.4] text-[var(--co-ink-3)]">
            {hint}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function PositionGrid({
  value,
  onChange,
}: {
  value: OverlayPosition;
  onChange: (v: OverlayPosition) => void;
}) {
  const cell = (p: OverlayPosition, label: string) => {
    const active = value === p;
    return (
      <button
        key={p}
        type="button"
        aria-pressed={active}
        onClick={() => onChange(p)}
        className={`flex h-12 items-center justify-center rounded-[4px] border font-[var(--co-font-mono)] text-[10px] uppercase tracking-[0.06em] transition-colors ${
          active
            ? "border-[var(--co-ink)] bg-[var(--co-ink)] text-[var(--co-page)]"
            : "border-[var(--co-line-strong)] bg-[var(--co-surface)] text-[var(--co-ink-2)] hover:bg-[var(--co-surface-2)]"
        }`}
      >
        {label}
      </button>
    );
  };
  return (
    <div className="grid grid-cols-2 gap-2">
      {cell("top-left", "TL")}
      {cell("top-right", "TR")}
      {cell("bottom-left", "BL")}
      {cell("bottom-right", "BR")}
    </div>
  );
}

function ThemeRow({
  value,
  onChange,
}: {
  value: OverlayTheme;
  onChange: (v: OverlayTheme) => void;
}) {
  const opts: { v: OverlayTheme; label: string }[] = [
    { v: "auto", label: "Auto" },
    { v: "light", label: "Light" },
    { v: "dark", label: "Dark" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="grid grid-cols-3 gap-2"
    >
      {opts.map(({ v, label }) => {
        const active = value === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(v)}
            className={`flex h-9 items-center justify-center rounded-[4px] border font-[var(--co-font-mono)] text-[10px] uppercase tracking-[0.06em] transition-colors ${
              active
                ? "border-[var(--co-ink)] bg-[var(--co-ink)] text-[var(--co-page)]"
                : "border-[var(--co-line-strong)] bg-[var(--co-surface)] text-[var(--co-ink-2)] hover:bg-[var(--co-surface-2)]"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
