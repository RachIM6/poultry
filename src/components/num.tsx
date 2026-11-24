import type { ReactNode } from "react";

// The finance tables' shared cells (WCAG 1.3.1, 1.4.10). Server or client; no hooks.

/** A number cell: at the column's end in French and Arabic alike, its digits and sign kept left to right. */
export function Num({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <td className={`p-2 text-end tabular-nums ${className}`}>
      <bdi dir="ltr">{children}</bdi>
    </td>
  );
}
