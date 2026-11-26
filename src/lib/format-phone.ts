/** A Moroccan number as people write it: "+212600000182" → "06 00 00 01 82". Any other number stays as stored. */
export function formatPhone(e164: string): string {
  const national = /^\+212(\d{9})$/.exec(e164);
  return national ? `0${national[1]}`.replace(/(\d{2})(?=\d)/g, "$1 ") : e164;
}
