"use client";

import { SerwistProvider } from "@serwist/turbopack/react";
import { useEffect, type ReactNode } from "react";

export function PwaProvider({ children }: { children: ReactNode }) {
  // Ask the browser not to evict our offline data (ADR-001: iOS can clear it otherwise).
  useEffect(() => void navigator.storage?.persist?.(), []);

  return (
    <SerwistProvider
      swUrl="/serwist/sw.js"
      disable={process.env.NODE_ENV === "development"}
      // The default reloads the page when the network returns, which would wipe a half-filled form.
      reloadOnOnline={false}
    >
      {children}
    </SerwistProvider>
  );
}
