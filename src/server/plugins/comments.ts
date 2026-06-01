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
import { errorMessage, sendError, wrapApiHandler } from "../platform/http.ts";
import { sourceLoc as createSourceLocPlugin } from "./source-loc.ts";

const INJECT_MARKER = "<!-- vite-plugin-comments injected -->";

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
  fixModelPriority?: import("../fix/models.ts").FixModel[];
}

export function comments(options: CommentsPluginOptions = {}): Plugin {
  const excludeSrcPrefixes = options.excludeSrcPrefixes ?? [];
  const cursorAgentPath = options.cursorAgentPath;
  const fixModelPriority = options.fixModelPriority;
  let projectRoot = process.cwd();

  return {
    name: "vite-plugin-comments",
    apply: "serve",

    configResolved(config) {
      projectRoot = config.root;
      configureFixRuntime({
        ...(cursorAgentPath ? { cursorAgentPath } : {}),
        ...(fixModelPriority ? { fixModelPriority } : {}),
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

    transformIndexHtml: {
      order: "pre",
      handler(html) {
        if (html.includes(INJECT_MARKER)) {
          return html;
        }
        return html.replace("</head>", `  ${INJECT_MARKER}\n  </head>`);
      },
    },
  };
}

/** Re-exported for `redline/plugin` consumers configuring the dev source-loc stamper. */
export function sourceLoc(
  options: Parameters<typeof createSourceLocPlugin>[0]
): ReturnType<typeof createSourceLocPlugin> {
  return createSourceLocPlugin(options);
}
