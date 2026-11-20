/**
 * What the Paper Reader's Critique agent sends (docs/design/paper-reader.md, 9.3 and 23): the wire shape of a critique, the end of its stream (documents.ts AskStreamEvent `critique`). Types only;
 * the kinds' list and labels are in reader-agents.ts (it holds `CRITIQUE_KINDS` equal to `CritiqueKind`). Imports nothing.
 */

/** The kinds of weak point a critique names. */
export type CritiqueKind = "thin_evidence" | "missing_baseline" | "overclaim" | "limitation_stated" | "limitation_unstated";
/** One weak point, with the passage it is about: `quote` was checked against the paper's own text (a point whose quote was not found is never sent). */
export type CritiquePoint = { kind: CritiqueKind; text: string; quote: string; page: number; idx: number; section?: string };
/** A critique: its points, the focus it was asked with ("" for the whole paper), and how many points the model wrote that were dropped because their quote was not in the paper. */
export type Critique = { id: string; focus: string; points: CritiquePoint[]; dropped: number; createdAt: number; model?: string };
