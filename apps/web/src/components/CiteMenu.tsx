import * as Tabs from "@radix-ui/react-tabs";
import { AnimatePresence, m } from "motion/react";
import { Check, Copy, Quote } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Paper } from "@scholar/shared";
import { CITE_STYLES, formatCitation, type CiteStyle } from "../lib/cite";
import { spring, springPop } from "../lib/motion";
import { Pop } from "./Pop";

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onClick = async () => {
    const ok = await copyText(text);
    setState(ok ? "copied" : "failed");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 1800);
  };

  return (
    <button type="button" className="btn btn-primary btn-sm" onClick={onClick}>
      <AnimatePresence mode="wait" initial={false}>
        <m.span
          key={state}
          className="btn-ico"
          initial={{ scale: 0.4, opacity: 0, rotate: -30 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          exit={{ scale: 0.4, opacity: 0 }}
          transition={springPop}
        >
          {state === "copied" ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
        </m.span>
      </AnimatePresence>
      <span>{state === "copied" ? "Copied" : state === "failed" ? "Press Ctrl+C" : label}</span>
      <span className="sr-only" role="status" aria-live="polite">
        {state === "copied" ? "Citation copied to clipboard" : ""}
      </span>
    </button>
  );
}

export function CiteMenu({ paper }: { paper: Paper }) {
  const [style, setStyle] = useState<CiteStyle>("apa");
  const text = formatCitation(paper, style);

  return (
    <Pop
      label="Cite this paper"
      trigger={(open) => (
        <button type="button" className="btn btn-ghost btn-sm" aria-expanded={open}>
          <Quote size={15} aria-hidden="true" />
          <span>Cite</span>
        </button>
      )}
    >
      <Tabs.Root value={style} onValueChange={(v) => setStyle(v as CiteStyle)} className="cite">
        <Tabs.List className="cite-tabs" aria-label="Citation style">
          {CITE_STYLES.map((s) => (
            <Tabs.Trigger key={s.id} value={s.id} className="cite-tab">
              {style === s.id && <m.span layoutId="cite-tab-pill" className="cite-tab-pill" transition={spring} />}
              <span className="cite-tab-label">{s.label}</span>
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value={style} asChild>
          <pre className="cite-text" tabIndex={0}>
            {text}
          </pre>
        </Tabs.Content>
        <div className="cite-foot">
          <CopyButton text={text} />
          <span className="cite-note">Built from the record metadata, never by AI. Check names before submitting.</span>
        </div>
      </Tabs.Root>
    </Pop>
  );
}
