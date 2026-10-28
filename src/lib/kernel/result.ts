// Expected business failures are values, not exceptions. The error code doubles as an i18n key (errors.<CODE>).
export type Result<T, E extends string = string> = { ok: true; value: T } | { ok: false; error: E };
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const fail = <E extends string>(error: E): Result<never, E> => ({ ok: false, error });
