/** A time in milliseconds as the database writes it: "YYYY-MM-DD HH:MM:SS" in UTC, so it compares as text with `datetime('now')`. */
export const sqlTime = (ms: number): string => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
