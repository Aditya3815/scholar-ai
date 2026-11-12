import { Hono } from "hono";
import { MAX_REFERENCE_CHARS } from "@scholar/shared";
import { sameOrigin } from "../auth/http";
import { referenceService } from "./service";
import type { HonoEnv } from "../platform/env";


export const referenceRoutes = new Hono<HonoEnv>();

referenceRoutes.post("/verify", async (c) => {
  if (!sameOrigin(c)) return c.json({ type: "forbidden", title: "Cross-origin request blocked" }, 403);
  const body = await c.req.json<{ reference?: unknown }>().catch(() => null);
  const read = referenceService.read(body?.reference);
  if (!read.ok && read.why === "empty") return c.json({ type: "invalid_reference", title: "Invalid reference", detail: "Send { reference: string }." }, 400);
  if (!read.ok) {
    return c.json({ type: "invalid_reference", title: "Reference too long", detail: `A single reference can be at most ${MAX_REFERENCE_CHARS} characters. Split the list into separate entries.` }, 413);
  }
  const { result, cached } = await referenceService.verify(c.env, read.text);
  c.header("Cache-Control", "no-store");
  return c.json({ ...result, cached });
});
