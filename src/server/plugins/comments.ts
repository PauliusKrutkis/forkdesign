import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import {
  handleDelete,
  handleGet,
  handlePatch,
  handlePost,
} from "../api/comments/routes.ts";
import {
  handleIterationsActivate,
  handleIterationsDelete,
  handleIterationsList,
  handleIterationsNew,
  handleIterationsScreenshot,
  iterationsSubpath,
} from "../api/iterations/routes.ts";
import { configureFixRuntime } from "../fix/config.ts";
import type { FixModel } from "../fix/models.ts";
import type { FixSkill } from "../fix/skills.ts";
import { errorMessage, sendError, wrapApiHandler } from "../platform/http.ts";
import { sourceLoc as createSourceLocPlugin } from "./source-loc.ts";

const INJECT_MARKER = "<!-- vite-plugin-comments injected -->";
const AUTO_MOUNT_MARKER = "<!-- redline overlay auto-mount -->";
const VIRTUAL_CLIENT_ID = "virtual:redline/client";
const RESOLVED_VIRTUAL_CLIENT_ID = `\0${VIRTUAL_CLIENT_ID}`;

function redlineClientModule(): string {
  return `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { CommentOverlay } from "redline";
import "redline/styles.css";

const ROOT_ID = "redline-overlay-root";

function mountRedlineOverlay() {
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
  document.addEventListener("DOMContentLoaded", mountRedlineOverlay, { once: true });
} else {
  mountRedlineOverlay();
}
`;
}

function handleIterationsMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string,
  excludeSrcPrefixes: string[],
  next: () => void
): void {
  const sub = iterationsSubpath(req.url ?? "");

  if (req.method === "GET" && (sub === "" || sub === "/")) {
    wrapApiHandler((r, s) =>
      handleIterationsList(r, s, projectRoot, excludeSrcPrefixes)
    )(req, res);
    return;
  }
  if (req.method === "POST" && sub === "/activate") {
    wrapApiHandler((r, s) =>
      handleIterationsActivate(r, s, projectRoot, excludeSrcPrefixes)
    )(req, res);
    return;
  }
  if (req.method === "POST" && sub === "/new") {
    handleIterationsNew(req, res, projectRoot, excludeSrcPrefixes).catch(
      (err: unknown) => {
        sendIterationsStreamError(res, err);
      }
    );
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
      handleIterationsDelete(r, s, projectRoot, excludeSrcPrefixes)
    )(req, res);
    return;
  }
  next();
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
  /** Path to the Cursor CLI `agent` binary. Default: `"agent"` (must be on PATH). */
  cursorAgentPath?: string;
  /**
   * Project-relative `src/` prefixes to skip when reading/writing comments
   * (e.g. overlay infrastructure or dev-only routes in your app).
   */
  excludeSrcPrefixes?: string[];
  /** Override the default Fix model priority order. */
  fixModelPriority?: FixModel[];
  /**
   * Skill guidance injected into generated fix prompts.
   * Defaults to `["frontend-design"]`; pass `[]` to disable.
   */
  fixSkills?: FixSkill[];
  /**
   * Inject and mount `<CommentOverlay />` automatically in dev. The low-level
   * `comments()` middleware keeps this off by default; use `redline()` for the
   * streamlined setup.
   */
  mountOverlay?: boolean;
}

export function comments(options: CommentsPluginOptions = {}): Plugin {
  const excludeSrcPrefixes = options.excludeSrcPrefixes ?? [];
  const cursorAgentPath = options.cursorAgentPath;
  const fixModelPriority = options.fixModelPriority;
  const fixSkills = options.fixSkills;
  const mountOverlay = options.mountOverlay ?? false;
  let projectRoot = process.cwd();

  return {
    name: "vite-plugin-comments",
    apply: "serve",

    configResolved(config) {
      projectRoot = config.root;
      configureFixRuntime({
        ...(cursorAgentPath ? { cursorAgentPath } : {}),
        ...(fixModelPriority ? { fixModelPriority } : {}),
        ...(fixSkills === undefined ? {} : { fixSkills }),
      });
    },

    configureServer(server) {
      server.middlewares.use("/api/comments", (req, res, next) => {
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
        return redlineClientModule();
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

export interface RedlinePluginOptions extends CommentsPluginOptions {
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

/** Streamlined dev setup: source locations + API middleware + overlay mount. */
export function redline(options: RedlinePluginOptions = {}): Plugin[] {
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

/** Re-exported for `redline/plugin` consumers configuring the dev source-loc stamper. */
export function sourceLoc(
  options: Parameters<typeof createSourceLocPlugin>[0] = {}
): ReturnType<typeof createSourceLocPlugin> {
  return createSourceLocPlugin(options);
}
