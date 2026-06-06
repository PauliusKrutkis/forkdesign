import {
  DEFAULT_FIX_VERSION_COUNT,
  MAX_FIX_VERSION_COUNT,
} from "../../../shared/fix-version-count.ts";
import { type FixModel, parseFixModel } from "../../fix/models.ts";
import { type FixSkill, parseFixSkill } from "../../fix/skills.ts";
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
  id: string;
  v: number;
}

export interface NewIterationBody {
  count: number;
  id: string;
  model?: FixModel;
  skills?: FixSkill[];
}

function parseFixSkills(value: unknown): ParseResult<FixSkill[]> {
  if (!Array.isArray(value)) {
    return { ok: false, reason: "field `skills` must be an array" };
  }
  const skills: FixSkill[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return { ok: false, reason: "field `skills` entries must be strings" };
    }
    const skill = parseFixSkill(item);
    if (!skill) {
      return { ok: false, reason: `unknown fix skill: ${item}` };
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
  return parseIdVersionBody(
    value,
    0,
    "field `v` must be a non-negative integer"
  );
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
  const countRaw = obj.count;
  let count = DEFAULT_FIX_VERSION_COUNT;
  if (countRaw !== undefined) {
    const parsedCount = requireInt(obj, "count", {
      min: DEFAULT_FIX_VERSION_COUNT,
      max: MAX_FIX_VERSION_COUNT,
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
    const model = parseFixModel(modelRaw);
    if (!model) {
      return { ok: false, reason: `unknown fix model: ${modelRaw}` };
    }
    body.model = model;
  }

  if (obj.skills !== undefined) {
    const skills = parseFixSkills(obj.skills);
    if (!skills.ok) {
      return skills;
    }
    body.skills = skills.value;
  }

  return { ok: true, value: body };
}
