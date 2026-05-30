import type {
  OverlayModel,
  OverlayPosition,
  OverlaySettings,
} from "./settings";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
type Props = {
  settings: OverlaySettings;
  onChange: (patch: Partial<OverlaySettings>) => void;
};

export function CommentSettingsPanel({ settings, onChange }: Props) {
  return (
    <div className="px-4 py-4">
      <Section label="Interface">
        <SwitchRow
          id="floating-controls"
          checked={settings.showFloatingControls}
          onChange={(v) => onChange({ showFloatingControls: v })}
          label="Show toolbar"
          hint="The corner dock pill. Hotkeys keep working when it's off."
        />
        <HotkeyCheatSheet />
      </Section>

      <Section label="Comments">
        <SwitchRow
          id="comments-enabled"
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

      {settings.showFloatingControls ? (
        <Section label="Position">
          <PositionGrid
            value={settings.position}
            onChange={(v) => onChange({ position: v })}
          />
        </Section>
      ) : null}

      <Section label="Author">
        <Input
          type="text"
          value={settings.author}
          onChange={(e) => onChange({ author: e.target.value })}
          placeholder="dev@local"
        />
        <p className="m-0 mt-1 text-xs text-muted-foreground">
          Stamps new comments. Leave empty for the default.
        </p>
      </Section>

      <Section label="AI model">
        <select
          value={settings.model}
          onChange={(e) => onChange({ model: e.target.value as OverlayModel })}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
    <p className="m-0 mt-3 text-xs leading-relaxed text-muted-foreground">
      <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">
        C
      </kbd>{" "}
      add comment ·{" "}
      <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">
        L
      </kbd>{" "}
      list ·{" "}
      <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">
        ,
      </kbd>{" "}
      settings ·{" "}
      <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">
        Esc
      </kbd>{" "}
      close
    </p>
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
      <h3 className="m-0 mb-2 text-xs font-medium text-muted-foreground">
        {label}
      </h3>
      {children}
    </section>
  );
}

function SwitchRow({
  id,
  checked,
  onChange,
  label,
  hint,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <div className="min-w-0 flex-1">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        {hint ? (
          <p className="m-0 text-xs text-muted-foreground">{hint}</p>
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
      <Button
        key={p}
        type="button"
        variant={active ? "default" : "outline"}
        className="h-11 text-xs"
        aria-pressed={active}
        onClick={() => onChange(p)}
      >
        {label}
      </Button>
    );
  };
  return (
    <div className="grid grid-cols-2 gap-2">
      {cell("top-left", "Top left")}
      {cell("top-right", "Top right")}
      {cell("bottom-left", "Bottom left")}
      {cell("bottom-right", "Bottom right")}
    </div>
  );
}
