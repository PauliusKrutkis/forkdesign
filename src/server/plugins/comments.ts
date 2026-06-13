import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ViteDevServer } from "vite";
import { configureAgentRuntime } from "../agent/config.ts";
import type { AgentModel } from "../agent/models.ts";
import type { AgentSkill } from "../agent/skills.ts";
import {
  handleDelete,
  handleGet,
  handlePatch,
  handlePost,
} from "../api/comments/routes.ts";
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

function forkDesignClientModule(): string {
  return `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { CommentOverlay } from "forkdesign";
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

  return {
    name: "vite-plugin-comments",
    apply: "serve",

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

    resolveId(id) {
      if (mountOverlay && id === VIRTUAL_CLIENT_ID) {
        return RESOLVED_VIRTUAL_CLIENT_ID;
      }
      return null;
    },

    load(id) {
      if (mountOverlay && id === RESOLVED_VIRTUAL_CLIENT_ID) {
        return forkDesignClientModule();
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
