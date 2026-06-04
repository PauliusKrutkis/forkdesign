import path from "node:path";
import traverseDefault from "@babel/traverse";
import {
  isJSXAttribute,
  isJSXIdentifier,
  jsxAttribute,
  jsxIdentifier,
  stringLiteral,
} from "@babel/types";
import recast from "recast";
import babelTsParser from "recast/parsers/babel-ts.js";
import type { Plugin } from "vite";

// @babel/traverse default-export interop varies across CJS/ESM bundlers.
const traverse = ((
  traverseDefault as unknown as { default?: typeof traverseDefault }
).default ?? traverseDefault) as typeof import("@babel/traverse").default;

/**
 * Dev-only Vite plugin that stamps every host-element JSX opening tag with
 * `data-source-loc="<file>:<line>:<col>"`. The composer reads this attribute
 * off the DOM to identify which source file + position to mutate when
 * persisting a new comment.
 */
interface SourceLocOptions {
  /** Skip stamping JSX in files under these project-relative prefixes. */
  excludeSrcPrefixes?: string[];
  projectRoot: string;
}

export function sourceLoc({
  projectRoot,
  excludeSrcPrefixes = [],
}: SourceLocOptions): Plugin {
  return {
    name: "vite-plugin-source-loc",
    apply: "serve",
    enforce: "pre",
    transform(code, id) {
      // Vite suffixes module ids with `?t=<timestamp>` (HMR) and other params;
      // strip the query before doing extension/path checks.
      const cleanId = id.split("?")[0];
      if (!cleanId.endsWith(".tsx")) {
        return null;
      }
      const norm = cleanId.split(path.sep).join("/");
      if (norm.includes("/node_modules/")) {
        return null;
      }
      if (!norm.includes("/src/")) {
        return null;
      }
      const relFromRoot = path
        .relative(projectRoot, cleanId)
        .split(path.sep)
        .join("/");
      if (excludeSrcPrefixes.some((prefix) => relFromRoot.startsWith(prefix))) {
        return null;
      }

      let ast: ReturnType<typeof recast.parse>;
      try {
        ast = recast.parse(code, { parser: babelTsParser });
      } catch {
        return null;
      }

      const rel = path.relative(projectRoot, cleanId).split(path.sep).join("/");
      if (rel.startsWith("..")) {
        return null;
      }

      let mutated = false;

      traverse(ast, {
        JSXOpeningElement(p) {
          const loc = p.node.loc;
          if (!loc) {
            return;
          }

          const name = p.node.name;
          if (!isJSXIdentifier(name)) {
            return;
          }
          const tag = name.name;
          if (tag[0] !== tag[0].toLowerCase()) {
            return;
          }

          const already = p.node.attributes.some(
            (a) =>
              isJSXAttribute(a) &&
              isJSXIdentifier(a.name) &&
              a.name.name === "data-source-loc"
          );
          if (already) {
            return;
          }

          const value = `${rel}:${loc.start.line}:${loc.start.column + 1}`;
          p.node.attributes.push(
            jsxAttribute(jsxIdentifier("data-source-loc"), stringLiteral(value))
          );
          mutated = true;
        },
      } as Parameters<typeof traverse>[1]);

      if (!mutated) {
        return null;
      }
      const out = recast.print(ast).code;
      return { code: out, map: null };
    },
  };
}
