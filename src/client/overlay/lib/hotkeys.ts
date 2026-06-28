export function isInTextInput(el: Element | null): boolean {
  if (!el) {
    return false;
  }
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  if (el instanceof HTMLElement && el.isContentEditable) {
    return true;
  }
  return false;
}
