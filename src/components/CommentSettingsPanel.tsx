import type { OverlayModel, OverlaySettings } from "./settings";
import { DockPositionPicker } from "./DockPositionPicker";
import { Kbd } from "./ui/kbd";
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
        <div className="mt-3">
          <SwitchRow
            id="skip-delete-confirmation"
            checked={settings.skipDeleteConfirmation}
            onChange={(v) => onChange({ skipDeleteConfirmation: v })}
            label="Skip delete confirmation"
            hint="Delete hotkey removes comments immediately."
          />
        </div>
      </Section>

      {settings.showFloatingControls ? (
        <Section label="Dock position">
          <DockPositionPicker
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
    <p className="m-0 mt-3 inline-flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-relaxed text-muted-foreground">
      <Kbd>C</Kbd> add comment <span aria-hidden>·</span>
      <Kbd>L</Kbd> list <span aria-hidden>·</span>
      <Kbd>,</Kbd> settings <span aria-hidden>·</span>
      <Kbd>Esc</Kbd> close
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

