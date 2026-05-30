import { beforeEach, describe, expect, it } from "vitest";
import { findSourceLoc } from "./sourceLoc";

describe("findSourceLoc", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns the loc on the clicked element when present", () => {
    const el = document.createElement("button");
    el.setAttribute("data-source-loc", "src/pages/Foo.tsx:42:7");
    document.body.appendChild(el);

    const loc = findSourceLoc(el);
    expect(loc).not.toBeNull();
    expect(loc?.file).toBe("src/pages/Foo.tsx");
    expect(loc?.line).toBe(42);
    expect(loc?.column).toBe(7);
    expect(loc?.element).toBe(el);
  });

  it("walks up to find the nearest ancestor with a loc", () => {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-source-loc", "src/pages/Foo.tsx:10:3");
    const inner = document.createElement("span");
    wrapper.appendChild(inner);
    document.body.appendChild(wrapper);

    const loc = findSourceLoc(inner);
    expect(loc).not.toBeNull();
    expect(loc?.element).toBe(wrapper);
    expect(loc?.line).toBe(10);
  });

  it("returns null when no ancestor has a loc", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    expect(findSourceLoc(el)).toBeNull();
  });

  it("parses file paths containing colons gracefully (none here, but no crash)", () => {
    const el = document.createElement("div");
    el.setAttribute("data-source-loc", "src/pages/A.tsx:5:9");
    document.body.appendChild(el);
    const loc = findSourceLoc(el);
    expect(loc?.file).toBe("src/pages/A.tsx");
    expect(loc?.line).toBe(5);
    expect(loc?.column).toBe(9);
  });

  it("returns null on malformed attribute values", () => {
    const el = document.createElement("div");
    el.setAttribute("data-source-loc", "no-colons-here");
    document.body.appendChild(el);
    expect(findSourceLoc(el)).toBeNull();
  });
});
