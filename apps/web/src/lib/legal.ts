import { PRIVACY_VERSION } from "@scholar/shared";
import { ApiError } from "./documents";
import { refreshAuth } from "./auth";

/**
 * Who is behind the service, for the legal pages. Fill these in (they are the only place) when the entity and the contact addresses exist.
 * While any is empty the pages say so and show a "draft" banner, so nobody mistakes a placeholder for a promise.
 */
export const LEGAL = {
  product: "Scholar AI",
  /** The person or company that runs the service (the "data fiduciary" under India's DPDP Act). */
  entity: "",
  /** Where to write about anything in the policy. */
  contactEmail: "",
  /** The person who answers complaints about personal data. */
  grievanceName: "",
  grievanceEmail: "",
  /** Postal address of the entity. */
  address: "",
  /** The Indian state or city whose courts the terms refer to. */
  jurisdiction: "",
  /** When this text took effect, as a date. Empty while it is a draft. */
  effective: "",
};

export const LEGAL_COMPLETE = Object.values(LEGAL).every((v) => v !== "");

export const LEGAL_LINKS = [
  { href: "/how-we-verify", label: "How we verify" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
] as const;

/** "I have read this": recorded against the account with the version of the text. */
export async function acknowledgePrivacy(): Promise<void> {
  const res = await fetch("/api/v1/account/privacy-ack", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: PRIVACY_VERSION }), credentials: "same-origin" });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { type?: string; title?: string; detail?: string } | null;
    throw new ApiError(res.status, j?.type ?? "error", j?.title ?? "That could not be saved", j?.detail);
  }
  await refreshAuth();
}
