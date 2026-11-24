import type { AbstractIntlMessages } from "next-intl";
import type fr from "../../messages/fr.json";

/** A namespace ("Sale"), or one key or group in it ("Farms.saved", "Stock.units"). */
export type MessagePath = keyof typeof fr | `${keyof typeof fr}.${string}`;

/** These parts of the catalogue only. A path that isn't there throws: a typo fails the prerender, or the request. */
export function pick(messages: AbstractIntlMessages, paths: readonly MessagePath[]): AbstractIntlMessages {
  const out: AbstractIntlMessages = {};
  for (const path of paths) {
    const keys = path.split(".");
    const last = keys.pop() as string;
    let from: AbstractIntlMessages | string | undefined = messages;
    let to = out;
    for (const k of keys) {
      from = typeof from === "object" ? from[k] : undefined;
      to = (to[k] ??= {}) as AbstractIntlMessages;
    }
    const value = typeof from === "object" ? from[last] : undefined;
    if (value === undefined) throw new Error(`No message at ${path}`);
    to[last] = value;
  }
  return out;
}
