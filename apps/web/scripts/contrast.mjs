const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const themes = {
  light: { bg: "#FBFAF7", surface: "#FFFFFF", surface2: "#F3F1EB", text: "#16181D", muted: "#565A63", border: "#E5E1D8", accent: "#3548C8", accentFg: "#FFFFFF", accentSoft: "#E8EBFA", ok: "#0F7A4A", warn: "#8F5200", danger: "#B3261E", dangerFg: "#FFFFFF" },
  dark: { bg: "#0F1115", surface: "#171A20", surface2: "#1F232B", text: "#ECECE8", muted: "#A3A6AE", border: "#2A2F39", accent: "#93A6FF", accentFg: "#0B1030", accentSoft: "#1D2447", ok: "#5FD39B", warn: "#F0B95C", danger: "#FF8A80", dangerFg: "#3A0B08" },
  read: { bg: "#F4ECD8", surface: "#FAF4E4", surface2: "#EDE3CB", text: "#3B3226", muted: "#6B5D49", border: "#D9CDB0", accent: "#7A4B16", accentFg: "#FFFFFF", accentSoft: "#EBDDBE", ok: "#2F6B3C", warn: "#7A4B00", danger: "#9E2A20", dangerFg: "#FFFFFF" },
};
const pairs = [
  ["text", "bg", 4.5], ["text", "surface", 4.5], ["text", "surface2", 4.5],
  ["muted", "bg", 4.5], ["muted", "surface", 4.5], ["muted", "surface2", 4.5],
  ["accent", "bg", 4.5], ["accent", "surface", 4.5], ["accent", "accentSoft", 4.5], ["accentFg", "accent", 4.5],
  ["ok", "surface", 4.5], ["warn", "surface", 4.5], ["warn", "surface2", 4.5], ["danger", "surface", 4.5],
  ["danger", "bg", 4.5], ["dangerFg", "danger", 4.5], ["border", "bg", 1.0],
];
let bad = 0;
for (const [name, t] of Object.entries(themes)) {
  console.log(`\n${name}`);
  for (const [fg, bg, min] of pairs) {
    const r = ratio(t[fg], t[bg]);
    const ok = r >= min;
    if (!ok) bad++;
    console.log(`  ${ok ? "ok " : "LOW"} ${fg.padEnd(9)} on ${bg.padEnd(10)} ${r.toFixed(2)}${min > 1 ? "" : " (decorative)"}`);
  }
}
console.log(`\nfailures: ${bad}`);
