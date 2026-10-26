import type { Complete } from "../docs/qa";

/**
 * The router's model, offline (tests and the local end-to-end run only: QA_STUB=1 with ENABLE_DEV_ROUTES=1). It reads the message between the triple quotes and decides by words:
 * "idea", "novel" or "naya" is an idea; "reference" or "bibliograph" a list to check; "uploaded", "workspace" or "pdf" a paper of the reader's; "unsure" is a doubtful answer,
 * "garbled" an invalid one, "boom" a failure; anything else is a search, whose English query is the first words behind "translated:".
 */
export const stubRoute: Complete = async ({ user }) => {
  const text = /"""\n([\s\S]*?)\n"""/.exec(user)?.[1] ?? "";
  if (/\bboom\b/i.test(text)) throw new Error("the model failed");
  if (/\bgarbled\b/i.test(text)) return { model: "stub", json: { mode: "banana", confidence: 0.99, search_query: "" } };
  if (/\bunsure\b/i.test(text)) return { model: "stub", json: { mode: "idea", confidence: 0.3, search_query: "" } };
  if (/\b(?:idea|novel|naya)\b/i.test(text)) return { model: "stub", json: { mode: "idea", confidence: 0.9, search_query: "" } };
  if (/reference|bibliograph/i.test(text)) return { model: "stub", json: { mode: "verify", confidence: 0.9, search_query: "" } };
  if (/uploaded|workspace|\bpdf\b/i.test(text)) return { model: "stub", json: { mode: "paper", confidence: 0.9, search_query: "" } };
  return { model: "stub", json: { mode: "search", confidence: 0.9, search_query: `translated: ${text.split(/\s+/).slice(0, 5).join(" ")}` } };
};
