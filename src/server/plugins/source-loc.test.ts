import { describe, expect, it } from "vitest";
import { sourceLoc } from "./source-loc.ts";

const projectRoot = "/repo";

function runTransform(
  code: string,
  id: string,
  options: { excludeSrcPrefixes?: string[] } = {}
): { code: string } | null {
  const plugin = sourceLoc({ projectRoot, ...options });
  const hook = plugin.transform;
  const fn =
    typeof hook === "function"
      ? hook
      : hook && "handler" in hook
        ? hook.handler
        : null;
  if (!fn) {
    throw new Error("plugin has no transform hook");
  }
  // @ts-expect-error — calling Vite transform hook without full PluginContext
  const result = fn.call({}, code, id) as unknown;
  if (result == null) {
    return null;
  }
  if (typeof result === "string") {
    return { code: result };
  }
  if (typeof result === "object" && "code" in result) {
    const r = result as { code?: string };
    return r.code == null ? null : { code: r.code };
  }
  return null;
}

describe("vite-plugin-source-loc transform", () => {
  it("stamps host JSX elements with data-source-loc", () => {
    const code = `
export function Page() {
  return (
    <div>
      <button>Save</button>
    </div>
  );
}
`;
    const out = runTransform(code, `${projectRoot}/src/pages/Foo.tsx`);
    expect(out).not.toBeNull();
    expect(out?.code).toContain(`data-source-loc="src/pages/Foo.tsx:4:5"`);
    expect(out?.code).toContain(`data-source-loc="src/pages/Foo.tsx:5:7"`);
  });

  it("skips uppercase (component) JSX elements", () => {
    const code = `
import { MyComponent } from "./x";
export function Page() {
  return <MyComponent />;
}
`;
    const out = runTransform(code, `${projectRoot}/src/pages/Foo.tsx`);
    expect(out).toBeNull();
  });

  it("does not re-stamp an already-stamped element", () => {
    const code = `
export function Page() {
  return <div data-source-loc="hand-written">x</div>;
}
`;
    const out = runTransform(code, `${projectRoot}/src/pages/Foo.tsx`);
    expect(out).toBeNull();
  });

  it("skips files outside src/", () => {
    const code = "export function X() { return <div />; }";
    const out = runTransform(code, `${projectRoot}/node_modules/foo/index.tsx`);
    expect(out).toBeNull();
  });

  it("skips paths listed in excludeSrcPrefixes", () => {
    const code = "export function X() { return <div />; }";
    const out = runTransform(
      code,
      `${projectRoot}/src/components/comments/Foo.tsx`,
      { excludeSrcPrefixes: ["src/components/comments/"] }
    );
    expect(out).toBeNull();
  });

  it("emits forward-slash project-relative paths even with query strings", () => {
    const code = "export function X() { return <div />; }";
    const out = runTransform(code, `${projectRoot}/src/pages/Foo.tsx?t=1234`);
    expect(out).not.toBeNull();
    expect(out?.code).toContain(`data-source-loc="src/pages/Foo.tsx:`);
  });
});
