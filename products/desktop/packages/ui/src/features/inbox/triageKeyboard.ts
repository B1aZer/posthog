/**
 * A focused button or link owns Enter/Space activation. The global Enter
 * shortcut must yield to it, or Tab-then-Enter on any control in the card
 * (Next, Exit, a section toggle, a verdict button) exits triage instead of
 * doing what the control says.
 */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest("button, a[href], [role='button']") !== null
  );
}

export function triageEnterAction(input: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}): "toggle" | "open" | null {
  if (
    input.key !== "Enter" ||
    input.altKey ||
    isInteractiveTarget(input.target)
  ) {
    return null;
  }
  return input.metaKey || input.ctrlKey ? "open" : "toggle";
}
