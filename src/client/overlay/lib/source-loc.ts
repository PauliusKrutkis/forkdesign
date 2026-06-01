/**
 * Resolve a DOM element to a (file, line, column) source location.
 *
 * In dev, every host JSX element is stamped with `data-source-loc="<file>:<line>:<col>"`
 * by `src/dev/babel-plugin-source-loc.ts` (gated on `command === 'serve'`).
 * The composer walks up from the clicked node to the closest ancestor with
 * that attribute. The matched element is the actual JSXElement to anchor.
 *
 * Returns null when:
 *   - no ancestor carries the attribute (rare — only React-DOM-internal text
 *     nodes / detached fragments, or when running outside dev),
 *   - or the attribute value is malformed.
 */

export interface SourceLoc {
  /** 1-indexed source column */
  column: number;
  /** the element actually carrying the attribute (may differ from the click target) */
  element: HTMLElement;
  /** project-relative path with forward slashes (e.g. src/pages/Foo.tsx) */
  file: string;
  /** 1-indexed source line */
  line: number;
}

export function findSourceLoc(el: Element): SourceLoc | null {
  let cur: Element | null = el;
  while (cur) {
    if (cur instanceof HTMLElement) {
      const raw = cur.getAttribute("data-source-loc");
      if (raw) {
        const parsed = parseLoc(raw);
        if (parsed) {
          return { ...parsed, element: cur };
        }
      }
    }
    cur = cur.parentElement;
  }
  return null;
}

function parseLoc(raw: string): Omit<SourceLoc, "element"> | null {
  // Format: "<file>:<line>:<col>". File may contain "/" but not ":".
  const lastColon = raw.lastIndexOf(":");
  if (lastColon < 0) {
    return null;
  }
  const secondLastColon = raw.lastIndexOf(":", lastColon - 1);
  if (secondLastColon < 0) {
    return null;
  }

  const file = raw.slice(0, secondLastColon);
  const line = Number(raw.slice(secondLastColon + 1, lastColon));
  const column = Number(raw.slice(lastColon + 1));
  if (!(file && Number.isFinite(line) && Number.isFinite(column))) {
    return null;
  }
  return { file, line, column };
}
