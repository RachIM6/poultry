import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// Locale-aware Link / router. Use these instead of next/link and next/navigation in pages.
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
