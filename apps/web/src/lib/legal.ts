import { PRIVACY_VERSION } from "@scholar/shared";
import { send } from "./api/client";
import { refreshAuth } from "./auth";

/**
 * Who is behind the service, for the legal pages. Fill these in (they are the only place) when the entity and the contact addresses exist.
 * While any is empty the pages say so and show a "draft" banner, so nobody mistakes a placeholder for a promise.
 */
export const LEGAL = {
  product: "Sodhsetu",
  /** The person or company that runs the service (the "data fiduciary" under India's DPDP Act). */
  entity: "",
  /** Where to write about anything in the policy. */
  contactEmail: "team@sodhsetu.in",
  /** The person who answers complaints about personal data. */
  grievanceName: "",
  grievanceEmail: "privacy@sodhsetu.in",
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
  await send("/api/v1/account/privacy-ack", { method: "POST", json: { version: PRIVACY_VERSION }, fallback: "That could not be saved" });
  await refreshAuth();
}
