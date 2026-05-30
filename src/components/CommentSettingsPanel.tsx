import { DockPositionPicker } from "./DockPositionPicker";
import type { OverlayModel, OverlaySettings } from "./settings";
import { Input } from "./ui/input";
import { Kbd } from "./ui/kbd";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";

interface Props {
  onChange: (patch: Partial<OverlaySettings>) => void;
  settings: OverlaySettings;
}

export function CommentSettingsPanel({ settings, onChange }: Props) {
  return (
    <div className="px-4 py-4">
      <Section label="Interface">
        <SwitchRow
          checked={settings.showFloatingControls}
          hint="The corner dock pill. Hotkeys keep working when it's off."
          id="floating-controls"
          label="Show toolbar"
          onChange={(v) => onChange({ showFloatingControls: v })}
        />
        <HotkeyCheatSheet />
      </Section>

      <Section label="Comments">
        <SwitchRow
          checked={settings.enabled}
          hint={
            settings.enabled
              ? "Pins, bubbles, and composer are active."
              : "Fully hidden. Open settings with , to turn back on."
          }
          id="comments-enabled"
          label={settings.enabled ? "On" : "Off"}
          onChange={(v) => onChange({ enabled: v })}
        />
        <div className="mt-3">
          <SwitchRow
            checked={settings.skipDeleteConfirmation}
            hint="Delete hotkey removes comments immediately."
            id="skip-delete-confirmation"
            label="Skip delete confirmation"
            onChange={(v) => onChange({ skipDeleteConfirmation: v })}
          />
        </div>
      </Section>

      {settings.showFloatingControls ? (
        <Section label="Dock position">
          <DockPositionPicker
            onChange={(v) => onChange({ position: v })}
            value={settings.position}
          />
        </Section>
      ) : null}

      <Section label="Author">
        <Input
          onChange={(e) => onChange({ author: e.target.value })}
          placeholder="dev@local"
          type="text"
          value={settings.author}
        />
        <p className="m-0 mt-1 text-muted-foreground text-xs">
          Stamps new comments. Leave empty for the default.
        </p>
      </Section>

      <Section label="AI model">
        <select
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onChange={(e) => onChange({ model: e.target.value as OverlayModel })}
          value={settings.model}
        >
          <option value="default">Default (Claude)</option>
          <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
          <option value="claude-opus-4-7">claude-opus-4-7</option>
          <option value="composer-2.5">composer-2.5 (Cursor CLI)</option>
        </select>
        <p className="m-0 mt-1 text-muted-foreground text-xs">
          Composer requires the Cursor CLI (`agent login` or `CURSOR_API_KEY`).
        </p>
      </Section>
    </div>
  );
}

function HotkeyCheatSheet() {
  return (
    <p className="m-0 mt-3 inline-flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground text-xs leading-relaxed">
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
      <h3 className="m-0 mb-2 font-medium text-muted-foreground text-xs">
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
      <Switch checked={checked} id={id} onCheckedChange={onChange} />
      <div className="min-w-0 flex-1">
        <Label className="font-medium text-sm" htmlFor={id}>
          {label}
        </Label>
        {hint ? (
          <p className="m-0 text-muted-foreground text-xs">{hint}</p>
        ) : null}
      </div>
    </div>
  );
}
