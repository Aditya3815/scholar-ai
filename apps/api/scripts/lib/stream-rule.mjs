// The event rule (docs/design/research-patterns.md, section 1) applied to every stream an endpoint test reads: progress and text are different event types, one end event, and so on.
// Loads packages/shared/src/stream-shape.ts as it is (Node strips the types), so the rule has one home.
import { streamShapeProblems } from "../../../../packages/shared/src/stream-shape.ts";

const found = [];
let streams = 0;

/** Checks one stream that was read to its end (not one the test stopped half way) and keeps what is wrong with it. */
export function checkStream(name, events, label = "") {
  streams++;
  for (const p of streamShapeProblems(name, events)) found.push(`${label || name}: ${p}`);
}

/** The line a test prints at its end: how many streams were checked, and every problem found. Returns true when there was none. */
export function reportStreams(ok) {
  ok(found.length === 0 && streams > 0, `every stream followed the event rule: progress and text in separate events, exactly one end (${streams} streams checked${found.length ? "; " + found.slice(0, 3).join(" | ") : ""})`);
  return found.length === 0;
}
