import { notFound } from "next/navigation";

// Any path under a locale that no route matches: render [locale]/not-found.tsx, not Next's English page.
export default function Unknown() {
  notFound();
}
