// Sends every scan to every model in turn and stores the answers in results/<model>/<scan>.json.
//   node run.mjs [modelFilter] [scanFilter]
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const URL_ = process.env.SPIKE_URL ?? "http://localhost:8799";
const MODELS = ["@cf/google/gemma-3-12b-it", "@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/meta/llama-4-scout-17b-16e-instruct"];
const SCANS = process.env.SCANS ?? "scans";
const RES = process.env.RES ?? "results";
const [mf, sf] = [process.argv[2], process.argv[3]];

for (const model of MODELS.filter((m) => !mf || m.includes(mf))) {
  const dir = HERE + RES + "/" + model.replace(/[^a-z0-9.]+/gi, "_") + "/";
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(HERE + SCANS).filter((f) => f.endsWith(".jpg") && (!sf || f.includes(sf)))) {
    const out = dir + f.replace(".jpg", ".json");
    if (existsSync(out) && JSON.parse(readFileSync(out, "utf8")).ok) continue;
    const image = "data:image/jpeg;base64," + readFileSync(HERE + SCANS + "/" + f).toString("base64");
    const res = await fetch(URL_, { method: "POST", body: JSON.stringify({ model, image }) }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));
    writeFileSync(out, JSON.stringify(res, null, 1));
    console.log(model.split("/").pop().padEnd(40), f.padEnd(26), res.ok ? `${res.ms} ms, ${res.text.length} chars, usage ${JSON.stringify(res.usage)}` : "ERROR " + String(res.error).slice(0, 160));
  }
}
