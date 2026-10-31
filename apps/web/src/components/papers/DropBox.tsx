import type { ReactNode } from "react";
import { RivePiece } from "../RivePiece";
import dropFile from "../../assets/rive/drop.riv?url";

/** The page's colours, by the name of the property of the Rive file that takes them (apps/web/rive/drop). */
const COLORS = { line: "--border-strong", accent: "--accent", accentSoft: "--accent-soft" };

/**
 * The picture in the upload zone: a box whose lid opens when a file is carried over it and comes down on it when it is dropped. The zone's own drag events say what is happening and the
 * picture decides nothing; the zone is a plain button with a label and works without it (`fallback`, the icon it had, shows until the picture is drawn and instead of it when it cannot be).
 * `drop` is written before `over` so that a drop is never taken for a file that was only dragged away.
 */
export default function DropBox({ over, dropped, off, fallback }: { over: boolean; dropped: boolean; off: boolean; fallback: ReactNode }) {
  return <RivePiece className="uz-scene" src={dropFile} artboard="Drop" stateMachine="Drop" width={96} height={80} booleans={{ drop: dropped, over, off }} loop={over} colors={COLORS} fallback={fallback} />;
}
