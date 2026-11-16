// The one switch of the eval: EVAL_MODE=replay|record|live (unset or empty: replay). Both record layers read it through here: the HTTP one (fetch-layer.ts) and the model one (model-layer.ts).
//   replay: answers come from the recordings in this folder (offline, deterministic, free): what `npm run eval` and CI run
//   record: real network and real models; what is asked is saved (`npm run eval:record -w apps/api`, or one file: `EVAL_MODE=record npx vitest run -c vitest.eval.config.ts eval/<file>`)
//   live:   real network, nothing saved (the weekly drift check, `npm run eval:live -w apps/api`)
export type Mode = "replay" | "record" | "live";

const MODES: readonly Mode[] = ["replay", "record", "live"];

/** The mode of this run. An unknown value fails at once instead of quietly running in some other mode. */
export function evalMode(value: string | undefined = process.env.EVAL_MODE): Mode {
  const mode = value || "replay";
  if (!(MODES as readonly string[]).includes(mode)) throw new Error(`EVAL_MODE must be ${MODES.join(", ")} or unset, not "${mode}"`);
  return mode as Mode;
}
