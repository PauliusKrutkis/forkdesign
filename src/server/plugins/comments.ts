import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Plugin, searchForWorkspaceRoot, type ViteDevServer } from "vite";
import { configureAgentRuntime } from "../agent/config.ts";
import type { AgentModel } from "../agent/models.ts";
import type { AgentSkill } from "../agent/skills.ts";
import { isScriptedAgentEnabled } from "../agent/strategies/scripted.ts";
import {
  handleDelete,
  handleGet,
  handlePatch,
  handlePost,
} from "../api/comments/routes.ts";
import { handleE2eControl } from "../api/iterations/e2e-control.ts";
import {
  handleIterationsActivate,
  handleIterationsCancel,
  handleIterationsDelete,
  handleIterationsList,
  handleIterationsNew,
  handleIterationsRuns,
  handleIterationsScreenshot,
  type IterationSourceAppliedEvent,
  iterationsSubpath,
} from "../api/iterations/routes.ts";
import { errorMessage, sendError, wrapApiHandler } from "../platform/http.ts";
import { sourceLoc as createSourceLocPlugin } from "./source-loc.ts";

const INJECT_MARKER = "<!-- vite-plugin-comments injected -->";
const AUTO_MOUNT_MARKER = "<!-- comment-overlay auto-mount -->";
const VIRTUAL_CLIENT_ID = "virtual:comment-overlay/client";
const RESOLVED_VIRTUAL_CLIENT_ID = `\0${VIRTUAL_CLIENT_ID}`;
const LOOPBACK_IPV6 = new Set(["::1", "0:0:0:0:0:0:0:1"]);

/** Public package name; matches `package.json#name`. */
const PACKAGE_NAME = "forkdesign";
/** Bare specifiers the auto-mounted virtual client module imports. */
const CLIENT_BARE_IMPORTS = new Set([
  PACKAGE_NAME,
  `${PACKAGE_NAME}/styles.css`,
]);
/**
 * A real file inside this package, used to anchor resolution of the virtual
 * client module's bare imports. Vite can't resolve bare specifiers when the
 * importer is a virtual (`\0`-prefixed) id, so we re-resolve them as if they
 * were imported from here — node self-reference resolution (or a consumer's
 * `forkdesign` alias) then has a real directory to work from.
 */
const SELF_MODULE_PATH = fileURLToPath(import.meta.url);

/**
 * Walk up from a file inside this package to its root (the directory whose
 * `package.json` is named `forkdesign`). Returns null if not found within a
 * few levels — e.g. an unusual install layout — so callers can fall back.
 */
function findPackageRoot(fromFile: string): string | null {
  let dir = dirname(fromFile);
  for (let depth = 0; depth < 10; depth++) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
          name?: string;
          exports?: Record<string, { source?: string } | string>;
        };
        if (pkg.name === PACKAGE_NAME) {
          return dir;
        }
      } catch {
        // Unreadable/invalid package.json — keep walking up.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

/** This package's root directory, or null if it can't be located. */
const PACKAGE_ROOT = findPackageRoot(SELF_MODULE_PATH);

/**
 * Absolute path to the overlay's TypeScript entry (`exports["."].source`) when
 * this package is consumed from a linked checkout that ships `src/` — i.e. the
 * common "develop the overlay against a real app" setup (`link:../redline`).
 *
 * Resolving the overlay to source here lets the consumer's Vite serve it with
 * live HMR, so overlay edits show up without a `pnpm build`. A published
 * install ships only `dist/`, so `src/index.ts` is absent and this returns
 * null — callers then fall back to the built entry. Computed once: the package
 * layout can't change within a dev session.
 */
const clientSourceEntry: string | null = (() => {
  if (!PACKAGE_ROOT) {
    return null;
  }
  let sourceRel = "./src/index.ts";
  try {
    const pkg = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")
    ) as {
      exports?: Record<string, { source?: string } | string>;
    };
    const entry = pkg.exports?.["."];
    if (entry && typeof entry === "object" && entry.source) {
      sourceRel = entry.source;
    }
  } catch {
    // Fall back to the conventional path below.
  }
  const abs = resolve(PACKAGE_ROOT, sourceRel);
  return existsSync(abs) ? abs : null;
})();

interface SourceChangeController {
  onInternalSourceWorkFinish: (event: IterationSourceAppliedEvent) => void;
  onInternalSourceWorkStart: (event: IterationSourceAppliedEvent) => void;
  onSourceApplied: (event: IterationSourceAppliedEvent) => void;
}

const sourceChangeControllers = new WeakMap<
  ViteDevServer,
  SourceChangeController
>();

export function isLoopbackRemoteAddress(
  remoteAddress: string | undefined
): boolean {
  if (!remoteAddress) {
    return false;
  }
  const address = remoteAddress.startsWith("::ffff:")
    ? remoteAddress.slice("::ffff:".length)
    : remoteAddress;
  return address.startsWith("127.") || LOOPBACK_IPV6.has(address);
}

function rejectRemoteApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  allowRemoteAccess: boolean
): boolean {
  if (allowRemoteAccess || isLoopbackRemoteAddress(req.socket.remoteAddress)) {
    return false;
  }
  sendError(
    res,
    403,
    "forkdesign API is local-only; pass allowRemoteAccess: true only on trusted networks"
  );
  return true;
}

function forkDesignClientModule(overlayImport: string): string {
  return `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { CommentOverlay } from "${overlayImport}";
import "forkdesign/styles.css";

const ROOT_ID = "overlay-root";

function mountForkDesignOverlay() {
  if (!import.meta.env.DEV || typeof document === "undefined") {
    return;
  }
  if (document.getElementById(ROOT_ID)) {
    return;
  }
  const host = document.body;
  if (!host) {
    return;
  }
  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.setAttribute("data-comment-overlay", "true");
  host.appendChild(root);
  createRoot(root).render(createElement(CommentOverlay));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountForkDesignOverlay, { once: true });
} else {
  mountForkDesignOverlay();
}
`;
}

function handleIterationsMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string,
  excludeSrcPrefixes: string[],
  server: ViteDevServer,
  next: () => void
): void {
  const sub = iterationsSubpath(req.url ?? "");
  const sourceChanges = sourceChangeController(server);

  // Test-only control plane for the scripted agent — gated so it never exists
  // in a real dev server. See api/iterations/e2e-control.ts.
  if (
    req.method === "POST" &&
    isScriptedAgentEnabled() &&
    sub.startsWith("/__e2e__/")
  ) {
    wrapApiHandler((r, s) => handleE2eControl(r, s, sub))(req, res);
    return;
  }

  if (req.method === "GET" && (sub === "" || sub === "/")) {
    wrapApiHandler((r, s) =>
      handleIterationsList(r, s, projectRoot, excludeSrcPrefixes)
    )(req, res);
    return;
  }
  if (req.method === "GET" && sub === "/runs") {
    wrapApiHandler(handleIterationsRuns)(req, res);
    return;
  }
  if (req.method === "POST" && sub === "/activate") {
    wrapApiHandler((r, s) =>
      handleIterationsActivate(r, s, projectRoot, excludeSrcPrefixes, {
        onSourceApplied: sourceChanges.onSourceApplied,
      })
    )(req, res);
    return;
  }
  if (req.method === "POST" && sub === "/new") {
    handleIterationsNew(req, res, projectRoot, excludeSrcPrefixes, {
      onInternalSourceWorkFinish: sourceChanges.onInternalSourceWorkFinish,
      onInternalSourceWorkStart: sourceChanges.onInternalSourceWorkStart,
      onSourceApplied: sourceChanges.onSourceApplied,
    }).catch((err: unknown) => {
      sendIterationsStreamError(res, err);
    });
    return;
  }
  if (req.method === "POST" && sub === "/cancel") {
    wrapApiHandler(handleIterationsCancel)(req, res);
    return;
  }
  if (req.method === "POST" && sub === "/screenshot") {
    wrapApiHandler((r, s) =>
      handleIterationsScreenshot(r, s, projectRoot, excludeSrcPrefixes)
    )(req, res);
    return;
  }
  if (req.method === "POST" && sub === "/delete") {
    wrapApiHandler((r, s) =>
      handleIterationsDelete(r, s, projectRoot, excludeSrcPrefixes, {
        onSourceApplied: sourceChanges.onSourceApplied,
      })
    )(req, res);
    return;
  }
  next();
}

function sourceChangeController(server: ViteDevServer): SourceChangeController {
  const existing = sourceChangeControllers.get(server);
  if (existing) {
    return existing;
  }

  const suppressed = new Set<string>();
  const originalEmit = server.watcher.emit.bind(server.watcher);
  server.watcher.emit = ((eventName: string | symbol, ...args: unknown[]) => {
    const file = args[0];
    if (
      (eventName === "add" ||
        eventName === "change" ||
        eventName === "unlink") &&
      typeof file === "string" &&
      suppressed.has(file)
    ) {
      return false;
    }
    return originalEmit(eventName, ...args);
  }) as typeof server.watcher.emit;

  const controller: SourceChangeController = {
    onInternalSourceWorkFinish: (event) => {
      suppressed.delete(event.absolutePath);
    },
    onInternalSourceWorkStart: (event) => {
      suppressed.add(event.absolutePath);
    },
    onSourceApplied: (event) => {
      suppressed.delete(event.absolutePath);
      // The source file is rewritten from an API request, and watcher delivery can
      // be flaky with atomic renames. Emit the change explicitly so Vite runs HMR.
      server.watcher.emit("change", event.absolutePath);
    },
  };
  sourceChangeControllers.set(server, controller);
  return controller;
}

function sendIterationsStreamError(res: ServerResponse, err: unknown): void {
  const message = errorMessage(err);
  if (res.headersSent) {
    try {
      res.write(
        `${JSON.stringify({ type: "done", ok: false, error: message })}\n`
      );
    } catch {
      /* socket already gone */
    }
    try {
      res.end();
    } catch {
      /* already closed */
    }
    return;
  }
  sendError(res, 500, message);
}

/**
 * Directories under src/ that may NOT receive comment markers. These are the
 * comment overlay's own infrastructure — writing markers into them would
 * either recurse (comments commenting on the comment system) or affect the
 * dev server pipeline itself.
 */
export interface CommentsPluginOptions {
  /** Override the default Agent model priority order. */
  agentModelPriority?: AgentModel[];
  /**
   * Skill guidance injected into generated agent prompts.
   * Defaults to `["frontend-design"]`; pass `[]` to disable.
   */
  agentSkills?: AgentSkill[];
  /**
   * Allow API requests from non-loopback clients. Keep false unless the Vite
   * dev server is on a trusted network.
   */
  allowRemoteAccess?: boolean;
  /** Path to the Cursor CLI `agent` binary. Default: `"agent"` (must be on PATH). */
  cursorAgentPath?: string;
  /**
   * Project-relative `src/` prefixes to skip when reading/writing comments
   * (e.g. overlay infrastructure or dev-only routes in your app).
   */
  excludeSrcPrefixes?: string[];
  /**
   * Inject and mount `<CommentOverlay />` automatically in dev. The low-level
   * `comments()` middleware keeps this off by default; use `forkDesign()` for the
   * streamlined setup.
   */
  mountOverlay?: boolean;
}

export function comments(options: CommentsPluginOptions = {}): Plugin {
  const excludeSrcPrefixes = options.excludeSrcPrefixes ?? [];
  const allowRemoteAccess = options.allowRemoteAccess ?? false;
  const cursorAgentPath = options.cursorAgentPath;
  const agentModelPriority = options.agentModelPriority;
  const agentSkills = options.agentSkills;
  const mountOverlay = options.mountOverlay ?? false;
  let projectRoot = process.cwd();

  // When the overlay is served from this package's TypeScript source (a linked
  // checkout — see `clientSourceEntry`), the consumer's Vite must (a) dedupe
  // React so the overlay shares the app's single copy rather than resolving its
  // own through the symlink — two copies break hooks — and (b) be allowed to
  // read files from this package's root, which lives outside the consumer's
  // project. Both are no-ops for a built/published install.
  const serveFromSource = mountOverlay && clientSourceEntry !== null;

  // The auto-mounted client imports the overlay from this specifier. From a
  // linked checkout we point straight at the TypeScript source via Vite's
  // `/@fs/` path so edits HMR live; otherwise the bare package name resolves to
  // the built `dist` entry. (Resolving the bare name to source via `resolveId`
  // isn't reliable — Vite's core resolver claims that import before our hook
  // sees it — so we pick the specifier here, where we fully control it.)
  const overlayImport =
    serveFromSource && clientSourceEntry
      ? `/@fs${clientSourceEntry}`
      : PACKAGE_NAME;

  return {
    name: "vite-plugin-comments",
    apply: "serve",

    config(userConfig) {
      if (!(serveFromSource && PACKAGE_ROOT)) {
        return;
      }
      // Specifying `fs.allow` at all suppresses Vite's default entry (the
      // consumer's workspace root), which would block the consumer from
      // serving its own files (e.g. index.html). So restore that default
      // explicitly alongside PACKAGE_ROOT, which lives outside the consumer's
      // project and must also be readable when serving the overlay from source.
      const consumerRoot = userConfig.root
        ? resolve(userConfig.root)
        : process.cwd();
      return {
        resolve: { dedupe: ["react", "react-dom"] },
        server: {
          fs: { allow: [searchForWorkspaceRoot(consumerRoot), PACKAGE_ROOT] },
        },
      };
    },

    configResolved(config) {
      projectRoot = config.root;
      configureAgentRuntime({
        ...(cursorAgentPath ? { cursorAgentPath } : {}),
        ...(agentModelPriority ? { agentModelPriority } : {}),
        ...(agentSkills === undefined ? {} : { agentSkills }),
      });
    },

    configureServer(server) {
      server.middlewares.use("/api/comments", (req, res, next) => {
        if (rejectRemoteApiRequest(req, res, allowRemoteAccess)) {
          return;
        }
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method === "GET") {
          wrapApiHandler((r, s) =>
            handleGet(r, s, projectRoot, excludeSrcPrefixes)
          )(req, res);
          return;
        }
        if (req.method === "POST") {
          wrapApiHandler((r, s) =>
            handlePost(r, s, projectRoot, excludeSrcPrefixes)
          )(req, res);
          return;
        }
        if (req.method === "DELETE") {
          wrapApiHandler((r, s) =>
            handleDelete(r, s, projectRoot, excludeSrcPrefixes)
          )(req, res);
          return;
        }
        if (req.method === "PATCH") {
          wrapApiHandler((r, s) =>
            handlePatch(r, s, projectRoot, excludeSrcPrefixes)
          )(req, res);
          return;
        }
        next();
      });

      server.middlewares.use("/api/iterations", (req, res, next) => {
        if (rejectRemoteApiRequest(req, res, allowRemoteAccess)) {
          return;
        }
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }
        handleIterationsMiddleware(
          req,
          res,
          projectRoot,
          excludeSrcPrefixes,
          server,
          next
        );
      });
    },

    resolveId(id, importer) {
      if (mountOverlay && id === VIRTUAL_CLIENT_ID) {
        return RESOLVED_VIRTUAL_CLIENT_ID;
      }
      // The virtual client module imports the package's public entrypoints by
      // bare specifier. Those can't be resolved relative to a virtual importer,
      // so anchor them to a real file inside the package.
      if (
        mountOverlay &&
        importer === RESOLVED_VIRTUAL_CLIENT_ID &&
        CLIENT_BARE_IMPORTS.has(id)
      ) {
        return this.resolve(id, SELF_MODULE_PATH, { skipSelf: true });
      }
      return null;
    },

    load(id) {
      if (mountOverlay && id === RESOLVED_VIRTUAL_CLIENT_ID) {
        return forkDesignClientModule(overlayImport);
      }
      return null;
    },

    transformIndexHtml: {
      order: "pre",
      handler(html) {
        let nextHtml = html;
        if (!nextHtml.includes(INJECT_MARKER)) {
          nextHtml = nextHtml.replace(
            "</head>",
            `  ${INJECT_MARKER}\n  </head>`
          );
        }
        if (mountOverlay && !nextHtml.includes(AUTO_MOUNT_MARKER)) {
          nextHtml = nextHtml.replace(
            "</head>",
            `  ${AUTO_MOUNT_MARKER}\n  <script type="module">import "${VIRTUAL_CLIENT_ID}";</script>\n  </head>`
          );
        }
        return nextHtml;
      },
    },
  };
}

export interface ForkDesignPluginOptions extends CommentsPluginOptions {
  /**
   * Source-location stamping for DOM target picking. Enabled by default.
   * Pass `false` only when you mount the overlay manually and provide another
   * source-location strategy.
   */
  sourceLoc?:
    | false
    | {
        excludeSrcPrefixes?: string[];
        projectRoot?: string;
      };
}

export type ForkDesignPluginOption =
  | { name: string }
  | ForkDesignPluginOption[];

/** Streamlined dev setup: source locations + API middleware + overlay mount. */
export function forkDesign(
  options: ForkDesignPluginOptions = {}
): ForkDesignPluginOption {
  const {
    sourceLoc: sourceLocOptions,
    mountOverlay = true,
    ...commentsOptions
  } = options;
  const middleware = comments({ ...commentsOptions, mountOverlay });
  if (sourceLocOptions === false) {
    return [middleware];
  }
  return [
    createSourceLocPlugin({
      excludeSrcPrefixes:
        sourceLocOptions?.excludeSrcPrefixes ?? options.excludeSrcPrefixes,
      projectRoot: sourceLocOptions?.projectRoot,
    }),
    middleware,
  ];
}

/** Re-exported for `forkdesign/plugin` consumers configuring the dev source-loc stamper. */
export function sourceLoc(
  options: Parameters<typeof createSourceLocPlugin>[0] = {}
): ReturnType<typeof createSourceLocPlugin> {
  return createSourceLocPlugin(options);
}
