import {
  DEFAULT_AGENT_VERSION_COUNT,
  MAX_AGENT_VERSION_COUNT,
} from "../../../shared/agent-version-count.ts";
import { type AgentModel, parseAgentModel } from "../../agent/models.ts";
import { type AgentSkill, parseAgentSkill } from "../../agent/skills.ts";
import { isSafePathSegment } from "../../platform/path-safety.ts";
import {
  type ParseResult,
  requireInt,
  requireNonEmptyString,
  requireObject,
} from "../../platform/validation.ts";

export interface ScreenshotBody {
  id: string;
  screenshotPng: string;
  v: number;
}

export interface ActivateBody {
  /** When true, apply live for screenshot capture without recording a user pick. */
  forCapture?: boolean;
  id: string;
  v: number;
}

export interface NewIterationBody {
  count: number;
  id: string;
  model?: AgentModel;
  skills?: AgentSkill[];
}

function parseAgentSkills(value: unknown): ParseResult<AgentSkill[]> {
  if (!Array.isArray(value)) {
    return { ok: false, reason: "field `skills` must be an array" };
  }
  const skills: AgentSkill[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return { ok: false, reason: "field `skills` entries must be strings" };
    }
    const skill = parseAgentSkill(item);
    if (!skill) {
      return { ok: false, reason: `unknown agent skill: ${item}` };
    }
    if (!skills.includes(skill)) {
      skills.push(skill);
    }
  }
  return { ok: true, value: skills };
}

function parseIdVersionBody(
  value: unknown,
  vMin: number,
  vMinReason: string
): ParseResult<ActivateBody> {
  const objResult = requireObject(value);
  if (!objResult.ok) {
    return objResult;
  }
  const obj = objResult.value;
  const id = requireNonEmptyString(obj, "id");
  if (!id.ok) {
    return id;
  }
  if (!isSafePathSegment(id.value)) {
    return { ok: false, reason: "field `id` contains unsafe path characters" };
  }
  const v = requireInt(obj, "v", { min: vMin });
  if (!v.ok) {
    return { ok: false, reason: vMinReason };
  }
  return { ok: true, value: { id: id.value, v: v.value } };
}

export function parseScreenshotBody(
  value: unknown
): ParseResult<ScreenshotBody> {
  const base = parseIdVersionBody(
    value,
    0,
    "field `v` must be a non-negative integer"
  );
  if (!base.ok) {
    return base;
  }
  const objResult = requireObject(value);
  if (!objResult.ok) {
    return objResult;
  }
  const screenshotPng = requireNonEmptyString(objResult.value, "screenshotPng");
  if (!screenshotPng.ok) {
    return {
      ok: false,
      reason: "field `screenshotPng` must be a non-empty string",
    };
  }
  return {
    ok: true,
    value: {
      ...base.value,
      screenshotPng: screenshotPng.value,
    },
  };
}

export function parseActivateBody(value: unknown): ParseResult<ActivateBody> {
  const base = parseIdVersionBody(
    value,
    0,
    "field `v` must be a non-negative integer"
  );
  if (!base.ok) {
    return base;
  }
  const objResult = requireObject(value);
  if (!objResult.ok) {
    return objResult;
  }
  const rawForCapture = objResult.value.forCapture;
  if (rawForCapture === undefined) {
    return base;
  }
  if (typeof rawForCapture !== "boolean") {
    return { ok: false, reason: "field `forCapture` must be a boolean" };
  }
  return {
    ok: true,
    value: { ...base.value, forCapture: rawForCapture },
  };
}

export function parseDeleteVersionBody(
  value: unknown
): ParseResult<ActivateBody> {
  return parseIdVersionBody(
    value,
    1,
    "field `v` must be an integer >= 1 (baseline v0 cannot be deleted)"
  );
}

export function parseNewIterationBody(
  value: unknown
): ParseResult<NewIterationBody> {
  const objResult = requireObject(value);
  if (!objResult.ok) {
    return objResult;
  }
  const obj = objResult.value;
  const id = requireNonEmptyString(obj, "id");
  if (!id.ok) {
    return id;
  }
  if (!isSafePathSegment(id.value)) {
    return { ok: false, reason: "field `id` contains unsafe path characters" };
  }
  const countRaw = obj.count;
  let count = DEFAULT_AGENT_VERSION_COUNT;
  if (countRaw !== undefined) {
    const parsedCount = requireInt(obj, "count", {
      min: DEFAULT_AGENT_VERSION_COUNT,
      max: MAX_AGENT_VERSION_COUNT,
    });
    if (!parsedCount.ok) {
      return parsedCount;
    }
    count = parsedCount.value;
  }

  const body: NewIterationBody = { id: id.value, count };

  const modelRaw = obj.model;
  if (modelRaw !== undefined) {
    if (typeof modelRaw !== "string") {
      return { ok: false, reason: "field `model` must be a string" };
    }
    const model = parseAgentModel(modelRaw);
    if (!model) {
      return { ok: false, reason: `unknown agent model: ${modelRaw}` };
    }
    body.model = model;
  }

  if (obj.skills !== undefined) {
    const skills = parseAgentSkills(obj.skills);
    if (!skills.ok) {
      return skills;
    }
    body.skills = skills.value;
  }

  return { ok: true, value: body };
}
