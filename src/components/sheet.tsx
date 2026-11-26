"use client";

import { useTranslations } from "next-intl";
import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from "react";
import { useInline } from "@/components/focus";
import { ghost, secondarySm } from "@/components/ui";

// tasks/plan-ui-cleanup.md §2.7: an occasional form in a native modal <dialog>, which makes the page behind it inert
// and keeps Tab inside it: a side sheet from lg, a bottom sheet on the phone. No dependency. The page lists "Ui" in its
// ClientMessages. In /batches it loads with the lazy section chunks, never in the first load.

const Close = createContext<() => void>(() => {});

/** In a sheet's form: closes the sheet, e.g. once the form has saved. */
export const useCloseSheet = () => useContext(Close);

/**
 * Open while `open`: Escape and the close button call `onClose`, which sets `open` to false. Shown, the first field takes
 * the focus. Where the focus goes back is the opener's job: `useInline` (focus.ts) does it, as `SheetButton` below.
 */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  const t = useTranslations("Ui");
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog || dialog.open) return;
    dialog.showModal(); // focuses the close button, the first control
    dialog.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea")?.focus();
  }, [open]);
  if (!open) return null;
  return (
    // Escape closes the dialog natively, then fires `close`; the close button unmounts it (no `close` event then).
    <dialog
      ref={ref}
      aria-labelledby={id}
      onClose={onClose}
      className="inset-x-0 bottom-0 top-auto m-0 max-h-[90dvh] w-full max-w-full overflow-y-auto overscroll-contain rounded-t-[18px] bg-card p-4 text-ink backdrop:bg-ink/40 lg:inset-y-0 lg:start-auto lg:end-0 lg:h-dvh lg:max-h-none lg:w-[28rem] lg:rounded-none lg:rounded-s-[18px] lg:p-6"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id={id} className="text-lg font-semibold">{title}</h2>
        <button type="button" aria-label={t("close")} onClick={onClose} className={`${ghost} min-w-11 lg:min-w-8`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <Close value={onClose}>{children}</Close>
    </dialog>
  );
}

/**
 * The opener and its sheet. A server page passes its server-action form as `children`; the form calls `useCloseSheet()`
 * once it has saved. On close the focus goes back to this button.
 * ```tsx
 * <SheetButton label="Apport ou retrait" title="Apport ou retrait"><MovementForm … /></SheetButton>
 * ```
 */
export function SheetButton({ label, title, className = secondarySm, children }: { label: ReactNode; title: ReactNode; className?: string; children: ReactNode }) {
  const { open, opener, close } = useInline<"sheet">();
  return (
    <>
      <button type="button" aria-haspopup="dialog" className={className} {...opener("sheet")}>{label}</button>
      <Sheet open={open === "sheet"} onClose={close} title={title}>{children}</Sheet>
    </>
  );
}
