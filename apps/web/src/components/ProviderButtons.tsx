import { signIn, useAuth } from "../lib/auth";
import googleLogo from "../assets/providers/google.png";
import orcidLogo from "../assets/providers/orcid.png";

/** Official marks, decorative here (the button text names the provider). */
const LOGOS: Record<string, string> = { google: googleLogo, orcid: orcidLogo };

/** "Continue with Google / ORCID": the same buttons in the sign-in dialog and on pages that need an account. */
export function ProviderButtons() {
  const { providers } = useAuth();
  return (
    <div className="modal-actions">
      {providers.map((p) => (
        <button key={p.id} type="button" className="btn btn-ghost provider-btn" onClick={() => signIn(p.id)}>
          <img className="provider-logo" src={LOGOS[p.id]} alt="" width={22} height={22} />
          <span>Continue with {p.label}</span>
        </button>
      ))}
    </div>
  );
}
