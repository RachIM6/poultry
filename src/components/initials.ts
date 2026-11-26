/**
 * The avatar's letters: the first letter of the first two words; one letter for an Arabic name (two would join into a
 * word); none for a phone or an email (an account made before names).
 */
export function initials(name: string | undefined): string {
  if (!name || /[\d@]/.test(name)) return "";
  const letters = name.split(" ").slice(0, 2).map((word) => Array.from(word)[0].toLocaleUpperCase());
  return /\p{Script=Arabic}/u.test(letters[0]) ? letters[0] : letters.join("");
}
