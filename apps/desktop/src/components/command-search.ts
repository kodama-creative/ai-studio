/** Case-insensitive command-palette matching shared by built-in actions. */
export function matchesCommandText(value: string, query: string): boolean {
  return value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}
