import { useSyncExternalStore } from "react";
import type { AuthProviderInfo, AuthUser } from "@scholar/shared";

export type AuthState = {
  status: "loading" | "ready";
  user: AuthUser | null;
  /** Only providers configured on this deployment; the UI shows no sign-in at all if empty. */
  providers: AuthProviderInfo[];
};

let state: AuthState = { status: "loading", user: null, providers: [] };
const listeners = new Set<() => void>();
const set = (next: AuthState) => {
  state = next;
  listeners.forEach((l) => l());
};

export const getAuthState = (): AuthState => state;
export function subscribeAuth(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function refreshAuth(): Promise<void> {
  try {
    const [me, prov] = await Promise.all([
      fetch("/api/v1/auth/me", { credentials: "same-origin" }),
      fetch("/api/v1/auth/providers", { credentials: "same-origin" }),
    ]);
    const user = me.ok ? ((await me.json()) as { user: AuthUser | null }).user : null;
    const providers = prov.ok ? ((await prov.json()) as { providers: AuthProviderInfo[] }).providers : [];
    set({ status: "ready", user, providers });
    try {
      if (user) localStorage.setItem("scholar.signedin", "1");
      else if (me.ok) localStorage.removeItem("scholar.signedin");
    } catch {
      /* storage blocked: the intro chunk is then fetched after sign-in status, as before */
    }
  } catch {
    // Offline or API down: browse anonymously, hide sign-in.
    set({ status: "ready", user: null, providers: [] });
  }
}

export function useAuth(): AuthState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

const here = () => encodeURIComponent(location.pathname + location.search);

/** Full-page redirect to the provider (OAuth authorization-code flow with PKCE runs on the server). */
export function signIn(provider: string) {
  location.assign(`/api/v1/auth/${provider}/start?return=${here()}`);
}

/** Attach another provider to the signed-in account. */
export function linkProvider(provider: string) {
  location.assign(`/api/v1/auth/${provider}/start?link=1&return=${here()}`);
}

export async function signOut(): Promise<void> {
  await fetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  await refreshAuth();
}

const ERRORS: Record<string, string> = {
  denied: "Sign-in was cancelled. You can try again whenever you like.",
  state: "That sign-in link expired or was already used. Please try again.",
  failed: "We could not complete sign-in. Please try again in a moment.",
  provider: "That sign-in method is not available.",
  identity_taken: "That account is already linked to a different profile.",
  signin_required: "Please sign in first.",
  link_target_missing: "Your session ended before the account could be linked. Please sign in again.",
};

/** Reads ?auth_error=... left by the server redirect, removes it from the URL, and returns a human message. */
export function takeAuthError(): string | null {
  const params = new URLSearchParams(location.search);
  const code = params.get("auth_error");
  if (!code) return null;
  params.delete("auth_error");
  const qs = params.toString();
  history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : ""));
  return ERRORS[code] ?? "Sign-in did not complete. Please try again.";
}

void refreshAuth();
