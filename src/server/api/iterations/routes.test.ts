import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireIterationSourceLock,
  activeIterationRunVisibleActive,
  finishIterationRun,
  startIterationRun,
  updateIterationRunVisibleActive,
} from "../../iterations/runs.ts";
import {
  createJsonRequest,
  createMockResponse,
} from "../../platform/http-test-helpers.ts";
import {
  handleIterationsActivate,
  handleIterationsDelete,
  handleIterationsList,
} from "./routes.ts";

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

const COMMENT_ID = "comment-route-test";
const ANCHOR_ID = "anchor-route-test";
const ACTIVE_V1_RE = /\bactive=1\b/;

function sourceForVersion(label: string, active: number): string {
  return `export function Page() {
  return (
    <main>
      <button data-comment-anchor="${ANCHOR_ID}">${label}</button>
      {/* @comment id="${COMMENT_ID}" anchor="${ANCHOR_ID}" text="Make CTA stronger" author="dev@local" date="2026-01-01T00:00:00.000Z" active=${active} */}
    </main>
  );
}
`;
}

function seedProject(active: number): {
  iterDir: string;
  projectRoot: string;
  sourcePath: string;
} {
  const projectRoot = mkdtempSync(path.join(tmpdir(), "redline-routes-"));
  const sourcePath = path.join(projectRoot, "src", "Page.tsx");
  const iterDir = path.join(projectRoot, "designs", "iterations", COMMENT_ID);
  mkdirSync(path.dirname(sourcePath), { recursive: true });
  mkdirSync(iterDir, { recursive: true });
  writeFileSync(sourcePath, sourceForVersion(`Version ${active}`, active));

  for (const version of [0, 1, 2]) {
    writeFileSync(
      path.join(iterDir, `v${version}.tsx`),
      sourceForVersion(`Version ${version}`, version)
    );
    writeFileSync(path.join(iterDir, `v${version}.png`), "png");
  }

  return { iterDir, projectRoot, sourcePath };
}

describe("handleIterationsList", () => {
  let projectRoot: string | undefined;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = undefined;
    }
  });

  it("uses the in-flight run visible active version over the marker value", async () => {
    const seeded = seedProject(1);
    projectRoot = seeded.projectRoot;
    const controller = startIterationRun({
      anchor: ANCHOR_ID,
      commentId: COMMENT_ID,
      count: 2,
      model: "composer-2.5-fast",
      startedAt: 123,
    });
    updateIterationRunVisibleActive(COMMENT_ID, 2);

    try {
      const mock = createMockResponse();
      const req = createJsonRequest(undefined, {
        method: "GET",
        url: `/?id=${COMMENT_ID}`,
      });

      await handleIterationsList(req, mock.res, projectRoot, []);

      expect(mock.getStatus()).toBe(200);
      expect(mock.getJson()).toMatchObject({
        active: 2,
        file: "src/Page.tsx",
        id: COMMENT_ID,
        versions: [{ v: 0 }, { v: 1 }, { v: 2 }],
      });
    } finally {
      finishIterationRun(COMMENT_ID, controller);
    }
  });
});

describe("handleIterationsDelete", () => {
  let projectRoot: string | undefined;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = undefined;
    }
  });

  it("activates the newest remaining version before deleting active artifacts", async () => {
    const seeded = seedProject(2);
    projectRoot = seeded.projectRoot;
    let artifactsExistedDuringActivation = false;
    const mock = createMockResponse();
    const req = createJsonRequest({ id: COMMENT_ID, v: 2 });

    await handleIterationsDelete(req, mock.res, projectRoot, [], {
      onSourceApplied: (event) => {
        if (event.active !== 1) {
          return;
        }
        artifactsExistedDuringActivation =
          existsSync(path.join(seeded.iterDir, "v2.tsx")) &&
          existsSync(path.join(seeded.iterDir, "v2.png"));
      },
    });

    expect(mock.getStatus()).toBe(200);
    expect(mock.getJson()).toMatchObject({
      active: 1,
      deleted: 2,
      file: "src/Page.tsx",
      id: COMMENT_ID,
      ok: true,
    });
    expect(artifactsExistedDuringActivation).toBe(true);
    expect(existsSync(path.join(seeded.iterDir, "v2.tsx"))).toBe(false);
    expect(existsSync(path.join(seeded.iterDir, "v2.png"))).toBe(false);

    const source = readFileSync(seeded.sourcePath, "utf8");
    expect(source).toContain("Version 1");
    expect(source).not.toContain("Version 2");
    expect(source).toMatch(ACTIVE_V1_RE);
  });
});

describe("handleIterationsActivate", () => {
  let projectRoot: string | undefined;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = undefined;
    }
  });

  it("switches to a finished version while a run is active (no 409) and tracks visible active", async () => {
    const seeded = seedProject(0);
    projectRoot = seeded.projectRoot;
    const controller = startIterationRun({
      anchor: ANCHOR_ID,
      commentId: COMMENT_ID,
      count: 4,
      model: "composer-2.5-fast",
      startedAt: 123,
    });

    try {
      const mock = createMockResponse();
      const req = createJsonRequest({ id: COMMENT_ID, v: 1 });

      await handleIterationsActivate(req, mock.res, projectRoot, []);

      expect(mock.getStatus()).toBe(200);
      expect(mock.getJson()).toMatchObject({
        active: 1,
        file: "src/Page.tsx",
        id: COMMENT_ID,
        ok: true,
      });
      // The in-flight run now reports the user's choice, not the marker value.
      expect(activeIterationRunVisibleActive(COMMENT_ID)).toBe(1);

      const source = readFileSync(seeded.sourcePath, "utf8");
      expect(source).toContain("Version 1");
      expect(source).toMatch(ACTIVE_V1_RE);
    } finally {
      finishIterationRun(COMMENT_ID, controller);
    }
  });

  it("waits for the source lock before rewriting the live file", async () => {
    const seeded = seedProject(0);
    projectRoot = seeded.projectRoot;
    // Simulate the agent holding the source while it edits the current variant.
    const release = await acquireIterationSourceLock(COMMENT_ID);

    const mock = createMockResponse();
    const req = createJsonRequest({ id: COMMENT_ID, v: 1 });
    let settled = false;
    const activatePromise = handleIterationsActivate(
      req,
      mock.res,
      projectRoot,
      []
    ).then(() => {
      settled = true;
    });

    await flush();
    // Blocked on the lock: the live source must still be the baseline.
    expect(settled).toBe(false);
    expect(readFileSync(seeded.sourcePath, "utf8")).toContain("Version 0");

    release();
    await activatePromise;

    expect(settled).toBe(true);
    expect(mock.getStatus()).toBe(200);
    expect(readFileSync(seeded.sourcePath, "utf8")).toContain("Version 1");
  });
});
