import type {
  OverlayModel,
  OverlayPosition,
  OverlaySettings,
  OverlayTheme,
  OverlayUiMode,
} from "./settings";
import { Kbd } from "./Kbd";

type Props = {
  settings: OverlaySettings;
  /** Patch updater: caller merges into the persisted shape. */
  onChange: (patch: Partial<OverlaySettings>) => void;
};

/**
 * Settings form body rendered inside CommentShell. Esc/backdrop close is
 * handled by the shell; the parent toggles visibility via hotkeys.
 */
export function CommentSettingsPanel({ settings, onChange }: Props) {
  return (
    <div className="px-4 py-4">
      <Section label="Interface">
        <UiModeRow
          value={settings.uiMode}
          onChange={(v) => onChange({ uiMode: v })}
        />
        {settings.uiMode === "full" ? (
          <div className="mt-3">
            <SwitchRow
              checked={settings.showFloatingControls}
              onChange={(v) => onChange({ showFloatingControls: v })}
              label="Show floating buttons"
              hint="List and Comment FABs in the corner. Hotkeys always work."
            />
          </div>
        ) : null}
        <HotkeyCheatSheet />
      </Section>

      <Section label="Comments">
        <SwitchRow
          checked={settings.enabled}
          onChange={(v) => onChange({ enabled: v })}
          label={settings.enabled ? "On" : "Off"}
          hint={
            settings.enabled
              ? "Pins, bubbles, and composer are active."
              : "Fully hidden. Open settings with , to turn back on."
          }
        />
      </Section>

      {settings.uiMode === "full" && settings.showFloatingControls ? (
        <Section label="Position">
          <PositionGrid
            value={settings.position}
            onChange={(v) => onChange({ position: v })}
          />
        </Section>
      ) : null}

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
        <select
          value={settings.model}
          onChange={(e) => onChange({ model: e.target.value as OverlayModel })}
          className="block w-full rounded-[4px] border border-[var(--co-line-strong)] bg-[var(--co-surface)] px-2.5 py-1.5 text-[12.5px] text-[var(--co-ink)] focus:border-[var(--co-ink)] focus:outline-none"
        >
          <option value="default">Default</option>
          <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
          <option value="claude-opus-4-7">claude-opus-4-7</option>
        </select>
      </Section>
    </div>
  );
}

function HotkeyCheatSheet() {
  return (
    <p className="m-0 mt-3 font-[var(--co-font-mono)] text-[10px] leading-[1.6] tracking-[0.04em] text-[var(--co-ink-3)]">
      <Kbd className="!ml-0">C</Kbd> comment · <Kbd className="!ml-0">L</Kbd> list ·{" "}
      <Kbd className="!ml-0">,</Kbd> settings · <Kbd className="!ml-0">Esc</Kbd> close
    </p>
  );
}

function UiModeRow({
  value,
  onChange,
}: {
  value: OverlayUiMode;
  onChange: (v: OverlayUiMode) => void;
}) {
  const opts: { v: OverlayUiMode; label: string; hint: string }[] = [
    {
      v: "full",
      label: "Full",
      hint: "Optional floating buttons",
    },
    {
      v: "minimal",
      label: "Minimal",
      hint: "Pins + hotkeys only",
    },
  ];
  return (
    <div className="flex flex-col gap-2">
      {opts.map(({ v, label, hint }) => {
        const active = value === v;
        return (
          <button
            key={v}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(v)}
            className={`flex flex-col items-start rounded-[4px] border px-3 py-2 text-left transition-colors ${
              active
                ? "border-[var(--co-ink)] bg-[var(--co-surface-2)]"
                : "border-[var(--co-line-strong)] bg-[var(--co-surface)] hover:bg-[var(--co-surface-2)]"
            }`}
          >
            <span className="font-[var(--co-font-mono)] text-[11px] uppercase tracking-[0.06em] text-[var(--co-ink)]">
              {label}
            </span>
            <span className="text-[11px] leading-[1.4] text-[var(--co-ink-3)]">
              {hint}
            </span>
          </button>
        );
      })}
    </div>
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
