/**
 * Shared fixture button, imported by both <SiteNav> and <Pricing>.
 *
 * Its purpose in the e2e suite is to be a SHARED, cross-file dependency: an
 * agent edit anchored on a button that reuses this component exercises the
 * aux-file / cross-file snapshot path (v{N}.files.json), distinct from edits
 * confined to a single component's own file. Note that the forkdesign plugin
 * stamps a clicked <Button> to THIS file (where the <button> is defined), not
 * to the using component — so specs that want per-file isolation anchor on
 * file-local elements (h1/h3/<a>) instead.
 */
import type { ReactNode } from "react";

export default function Button({
  children,
  variant = "primary",
  testId,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary";
  testId?: string;
}) {
  return (
    <button className={`btn btn-${variant}`} data-testid={testId} type="button">
      {children}
    </button>
  );
}
