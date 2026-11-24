"use client";

import { useEffect, useState } from "react";
import type { BatchResultDto } from "@/modules/finance/shared";

/**
 * SPEC-finance §9 "One cost per kg": FN13's batch results from the server, as /results shows them. Fetched again when
 * `key` changes (the phone's batches after a sync). Null while it loads, offline, or when `money` is false (I5).
 */
export function useBatchResults(money: boolean, key: string): BatchResultDto[] | null {
  const [rows, setRows] = useState<BatchResultDto[] | null>(null);
  useEffect(() => {
    if (!money) return;
    let live = true;
    fetch("/api/finance/batch-results", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((value: BatchResultDto[] | null) => live && value && setRows(value))
      .catch(() => {}); // offline: the figures stay as they were
    return () => {
      live = false;
    };
  }, [money, key]);
  return money ? rows : null;
}
