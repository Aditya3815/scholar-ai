/** Word-level text helpers shared by the server (verifying quotes) and the browser (highlighting them in the PDF). */

/** Lower-case words and numbers; diacritics folded so "Résumé" and "resume" compare equal. Punctuation is dropped. */
export const words = (s: string): string[] => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").match(/[\p{L}\p{N}]+/gu) ?? [];

export type Run = { /** words of `needle` found together */ len: number; /** index in `hay` where the run starts */ start: number };

/** The longest stretch of consecutive `needle` words that also appears, unbroken and in order, in `hay`. */
export function findRun(needle: string[], hay: string[]): Run {
  let best: Run = { len: 0, start: 0 };
  let prev = new Array<number>(hay.length + 1).fill(0);
  for (const w of needle) {
    const cur = new Array<number>(hay.length + 1).fill(0);
    for (let j = 1; j <= hay.length; j++) {
      if (hay[j - 1] === w) {
        cur[j] = prev[j - 1]! + 1;
        if (cur[j]! > best.len) best = { len: cur[j]!, start: j - cur[j]! };
      }
    }
    prev = cur;
  }
  return best;
}

/**
 * Every place the words of `needle` appear together, in order and unbroken, in `hay` (start indices). The LAST needle word may be a
 * beginning ("transfor" finds "transformer"), so a search can be run while it is still being typed.
 */
export function findAll(needle: string[], hay: string[]): number[] {
  const out: number[] = [];
  const n = needle.length;
  if (n === 0) return out;
  const last = needle[n - 1]!;
  for (let i = 0; i + n <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < n - 1 && ok; j++) ok = hay[i + j] === needle[j];
    if (ok && hay[i + n - 1]!.startsWith(last)) out.push(i);
  }
  return out;
}
