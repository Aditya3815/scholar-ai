import { useAllowance, shortTokens } from "../lib/allowance";

/**
 * A ring that shows how much of today's AI allowance is used: it fills as tokens are spent, turns amber at 75% and red at 90%. The full numbers are in the text beside it
 * (and for a screen reader); the allowance comes back every day.
 */
export function AllowanceRing({ signedIn }: { signedIn: boolean }) {
  const a = useAllowance(signedIn);
  if (!signedIn || !a) return null;
  const R = 15;
  const C = 2 * Math.PI * R;
  const frac = a.limit > 0 ? Math.min(a.used / a.limit, 1) : 0;
  const pct = Math.round(frac * 100);
  const level = frac >= 0.9 ? "high" : frac >= 0.75 ? "mid" : "low";
  const text = `${a.used.toLocaleString("en-IN")} of ${a.limit.toLocaleString("en-IN")} tokens used today. ${a.left.toLocaleString("en-IN")} left. It comes back tomorrow.`;
  return (
    <div className="allow" data-level={level} title={text}>
      <svg className="allow-ring" viewBox="0 0 36 36" width="36" height="36" role="img" aria-label={text}>
        <circle className="allow-track" cx="18" cy="18" r={R} fill="none" strokeWidth="4" />
        <circle className="allow-fill" cx="18" cy="18" r={R} fill="none" strokeWidth="4" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} transform="rotate(-90 18 18)" />
        <text x="18" y="21.5" textAnchor="middle" className="allow-pct">{pct}%</text>
      </svg>
      <span className="allow-txt">
        <strong>AI allowance today</strong>
        <small>{shortTokens(a.left)} of {shortTokens(a.limit)} tokens left</small>
      </span>
    </div>
  );
}
