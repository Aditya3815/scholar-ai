import { m } from "motion/react";
import { BookOpen, Monitor, Moon, Sun } from "lucide-react";
import { spring } from "../lib/motion";
import { setThemePref, useThemePref, type ThemePref } from "../lib/prefs";

const OPTIONS: { id: ThemePref; label: string; Icon: typeof Sun }[] = [
  { id: "auto", label: "Auto", Icon: Monitor },
  { id: "light", label: "Light", Icon: Sun },
  { id: "dark", label: "Dark", Icon: Moon },
  { id: "read", label: "Read", Icon: BookOpen },
];

/** `scope` keeps the sliding pill of one switch from travelling to another switch on the same page (they would share a layout id). */
export function ThemeSwitch({ scope = "top" }: { scope?: string }) {
  const pref = useThemePref();
  return (
    <div className="seg" role="group" aria-label="Theme">
      {OPTIONS.map(({ id, label, Icon }) => {
        const active = pref === id;
        return (
          <button
            key={id}
            type="button"
            className="seg-btn"
            aria-pressed={active}
            aria-label={`${label} theme`}
            title={`${label} theme`}
            onClick={() => setThemePref(id)}
          >
            {active && <m.span layoutId={`theme-pill-${scope}`} className="seg-pill" transition={spring} />}
            <Icon size={16} aria-hidden="true" />
            <span className="seg-label">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
