import { setuPose, type LitscanView } from "@scholar/shared";
import { RivePiece } from "../RivePiece";
import setuFile from "../../assets/rive/setu.riv?url";

/** The page's colours, by the name of the property of the Rive file that takes them (apps/web/rive/setu). */
const COLORS = { line: "--border-strong", accent: "--accent", accentSoft: "--accent-soft", warn: "--warn" };

/**
 * The bridge laid while a literature scan runs (docs/design/setu-rive.md): a plank for each theme, laid as its section is checked and written; an open plank for a theme with no paper; the question
 * crosses when the scan ends with every theme answered. It restates what the page already knows from the stored events and decides nothing. Decoration only: the progress bar, the count and the
 * tiles beside it carry every fact, and it shows nothing at all when it cannot be shown (reduced motion, saving data, no WebAssembly, no runtime).
 */
export default function Setu({ view }: { view: Pick<LitscanView, "state" | "total" | "stages" | "parts"> }) {
  const pose = setuPose(view);
  if (!pose) return null;
  const numbers = Object.fromEntries(pose.p.map((v, i) => [`p${i + 1}`, v]));
  const busy = pose.p.some((v) => v === 1 || v === 2); // a plank being searched or read breathes, so the picture keeps being drawn
  return <RivePiece key={pose.artboard} className="setu" src={setuFile} artboard={pose.artboard} stateMachine="Setu" width={640} height={118} numbers={numbers} booleans={{ cross: pose.cross }} loop={busy} colors={COLORS} />;
}
