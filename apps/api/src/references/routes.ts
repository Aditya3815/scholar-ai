import { Hono } from "hono";
import { MAX_REFERENCE_CHARS } from "@scholar/shared";
import { readJson } from "../platform/http/body";
import { referenceService } from "./service";
import type { HonoEnv } from "../platform/env";
import { deny } from "../problem";


export const referenceRoutes = new Hono<HonoEnv>();

referenceRoutes.post("/verify", async (c) => {
  const body = (await readJson(c)) as { reference?: unknown } | null;
  const read = referenceService.read(body?.reference);
  if (!read.ok && read.why === "empty") return deny(c, 400, "invalid_reference", "Invalid reference", "Send { reference: string }.");
  if (!read.ok) {
    return deny(c, 413, "invalid_reference", "Reference too long", `A single reference can be at most ${MAX_REFERENCE_CHARS} characters. Split the list into separate entries.`);
  }
  const { result, cached } = await referenceService.verify(c.env, read.text);
  c.header("Cache-Control", "no-store");
  return c.json({ ...result, cached });
});
