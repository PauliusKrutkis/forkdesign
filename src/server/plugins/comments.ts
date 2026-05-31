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
import { configureFixRuntime } from "../fix/index.ts";
import { sendError } from "../platform/http.ts";

const INJECT_MARKER = "<!-- vite-plugin-comments injected -->";

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
          handleGet(req, res, projectRoot, excludeSrcPrefixes).catch(
            (err: unknown) => {
              sendError(
                res,
                500,
                err instanceof Error ? err.message : String(err)
              );
            }
          );
          return;
        }
        if (req.method === "POST") {
          handlePost(req, res, projectRoot, excludeSrcPrefixes).catch(
            (err: unknown) => {
              sendError(
                res,
                500,
                err instanceof Error ? err.message : String(err)
              );
            }
          );
          return;
        }
        if (req.method === "DELETE") {
          handleDelete(req, res, projectRoot, excludeSrcPrefixes).catch(
            (err: unknown) => {
              sendError(
                res,
                500,
                err instanceof Error ? err.message : String(err)
              );
            }
          );
          return;
        }
        if (req.method === "PATCH") {
          handlePatch(req, res, projectRoot, excludeSrcPrefixes).catch(
            (err: unknown) => {
              sendError(
                res,
                500,
                err instanceof Error ? err.message : String(err)
              );
            }
          );
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
        const sub = iterationsSubpath(req.url ?? "");

        if (req.method === "GET" && (sub === "" || sub === "/")) {
          handleIterationsList(req, res, projectRoot, excludeSrcPrefixes).catch(
            (err: unknown) => {
              sendError(
                res,
                500,
                err instanceof Error ? err.message : String(err)
              );
            }
          );
          return;
        }
        if (req.method === "POST" && sub === "/activate") {
          handleIterationsActivate(
            req,
            res,
            projectRoot,
            excludeSrcPrefixes
          ).catch((err: unknown) => {
            sendError(
              res,
              500,
              err instanceof Error ? err.message : String(err)
            );
          });
          return;
        }
        if (req.method === "POST" && sub === "/new") {
          handleIterationsNew(req, res, projectRoot, excludeSrcPrefixes).catch(
            (err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
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
              } else {
                sendError(res, 500, message);
              }
            }
          );
          return;
        }
        if (req.method === "POST" && sub === "/screenshot") {
          handleIterationsScreenshot(
            req,
            res,
            projectRoot,
            excludeSrcPrefixes
          ).catch((err: unknown) => {
            sendError(
              res,
              500,
              err instanceof Error ? err.message : String(err)
            );
          });
          return;
        }
        if (req.method === "POST" && sub === "/delete") {
          handleIterationsDelete(
            req,
            res,
            projectRoot,
            excludeSrcPrefixes
          ).catch((err: unknown) => {
            sendError(
              res,
              500,
              err instanceof Error ? err.message : String(err)
            );
          });
          return;
        }
        next();
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
