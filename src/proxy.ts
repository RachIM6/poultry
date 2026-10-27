import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// Redirects / to /ar or /fr (cookie, then Accept-Language, then ar).
export default createMiddleware(routing);

export const config = {
  // Everything except API routes, Next internals and files with an extension.
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
