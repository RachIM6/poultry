"use client";

import { useEffect, useId, useRef, useState } from "react";

// SPEC X4, WCAG 2.2 AA: where focus goes when a form opens in place of its button, or closes.

/**
 * An inline form that takes the place of the button that opened it (2.4.3). The form's first field takes the focus
 * (autoFocus); on close, the focus goes back to that button, if it is still there.
 */
export function useInline<T extends string>() {
  const scope = useId();
  const [open, setOpen] = useState<T>();
  const last = useRef<T>(undefined);
  useEffect(() => {
    if (open === undefined && last.current) document.querySelector<HTMLElement>(`[data-opens="${scope}${last.current}"]`)?.focus();
  }, [open, scope]);
  const opener = (k: T, then?: () => void) => ({ "data-opens": scope + k, onClick: () => (setOpen((last.current = k)), then?.()) });
  return { open, opener, close: () => setOpen(undefined) };
}

