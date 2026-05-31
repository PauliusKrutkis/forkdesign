import { spawn } from "node:child_process";

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  expiresAt: number;
  models: Set<string>;
  probeFailed: boolean;
}

const cache = new Map<string, CacheEntry>();

/** Reset cached probe results (for tests). */
export function resetCursorModelCache(): void {
  cache.clear();
}

/**
 * List Composer model ids available to the Cursor CLI for this binary.
 * On probe failure, returns a conservative fallback set containing only
 * `composer-2.5` so Fix can still attempt the standard tier.
 */
export async function listAvailableCursorModels(
  agentPath: string
): Promise<Set<string>> {
  const now = Date.now();
  const cached = cache.get(agentPath);
  if (cached && cached.expiresAt > now) {
    return cached.models;
  }

  const result = await probeCursorModels(agentPath);
  cache.set(agentPath, {
    ...result,
    expiresAt: now + CACHE_TTL_MS,
  });
  return result.models;
}

export function isCursorModelAvailable(
  modelId: string,
  available: Set<string>
): boolean {
  return available.has(modelId);
}

async function probeCursorModels(agentPath: string): Promise<{
  models: Set<string>;
  probeFailed: boolean;
}> {
  return new Promise((resolve) => {
    const child = spawn(agentPath, ["models"], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", () => {
      resolve({ models: fallbackComposerModels(), probeFailed: true });
    });

    child.on("close", (code) => {
      if (code !== 0) {
        resolve({ models: fallbackComposerModels(), probeFailed: true });
        return;
      }

      const parsed = parseModelsOutput(stdout || stderr);
      if (parsed.size === 0) {
        resolve({ models: fallbackComposerModels(), probeFailed: true });
        return;
      }

      resolve({ models: parsed, probeFailed: false });
    });
  });
}

function fallbackComposerModels(): Set<string> {
  return new Set(["composer-2.5"]);
}

function parseModelsOutput(output: string): Set<string> {
  const models = new Set<string>();

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    // JSON line: {"id":"composer-2.5-fast",...}
    if (trimmed.startsWith("{")) {
      try {
        const obj = JSON.parse(trimmed) as { id?: string; name?: string };
        const id = obj.id ?? obj.name;
        if (typeof id === "string" && id.includes("composer")) {
          models.add(id);
        }
      } catch {
        // skip malformed JSON lines
      }
      continue;
    }

    // Plain text line — grab composer-like tokens.
    const match = trimmed.match(/\b(composer[\w.-]*)/i);
    if (match?.[1]) {
      models.add(match[1].toLowerCase());
    }
  }

  return models;
}
