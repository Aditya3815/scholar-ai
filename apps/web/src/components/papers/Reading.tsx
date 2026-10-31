import type { ReactNode } from "react";
import { readingPose } from "@scholar/shared";
import { RivePiece } from "../RivePiece";
import readingFile from "../../assets/rive/reading.riv?url";

/** The page's colours, by the name of the property of the Rive file that takes them (apps/web/rive/reading). */
const COLORS = { line: "--border-strong", accent: "--accent", accentSoft: "--accent-soft" };

/**
 * The scene beside an upload while its paper is read, uploaded and indexed (or, for page pictures, read page by page): a paper under a line that sweeps it, a page set aside as each is read, a ring
 * that fills as the job goes on, a check when it is done. The page tells it the step and how far along the job is (the same numbers as the bar under it) and it decides nothing. An error has
 * no scene: `fallback` (the page's own sign) is shown then, and also when the scene cannot be shown at all.
 */
export default function Reading({ step, progress, fallback }: { step: string; progress: number; fallback: ReactNode }) {
  const pose = readingPose({ step, progress });
  if (!pose) return <>{fallback}</>;
  const moving = pose.mode <= 2; // reading, uploading and indexing keep moving; done and paused hold still
  return <RivePiece className="job-scene-piece" src={readingFile} artboard="Reading" stateMachine="Reading" width={96} height={96} numbers={{ mode: pose.mode, progress: pose.progress }} loop={moving} colors={COLORS} fallback={fallback} />;
}
