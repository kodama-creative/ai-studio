/**
 * Derives a short label for an avatar (at most two letters). Prefers the first
 * number in the name (e.g. "Doubao 2.0 Pro" → "2.0", "GPT 5" → "5"); otherwise
 * initials of the first two words (e.g. "OpenAI Codex" → "OC", "Aurora Doubao
 * Pro Max" → "AD"); otherwise camelCase capitals for a single word (e.g.
 * "DeepSeek" → "DS", "MiniMax" → "MM").
 */
export function extractInitials(name: string): string {
  const normalizedName = name.replace(/-/, " ");
  const number = /\d+(?:\.\d+)?/.exec(normalizedName);
  if (number) { return number[0]; }

  const words = normalizedName.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const firstInitial = words[0]?.charAt(0);
    const secondInitial = words[1]?.charAt(0);
    if (firstInitial && secondInitial) {
      return (firstInitial + secondInitial).toUpperCase();
    }
  }

  const firstWord = words[0] ?? "";
  const capitals = firstWord.match(/[A-Z]/g);
  if (capitals && capitals.length >= 2) {
    return capitals.slice(0, 2).join("");
  }

  return normalizedName.slice(0, 2).toUpperCase();
}
