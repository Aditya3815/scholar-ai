// Spike only (never deployed): runs one Workers AI vision model on one image and reports text, usage and time.
const PROMPT =
  "Transcribe all the text in this scanned page exactly as written, in reading order. Keep Hindi (Devanagari) in Devanagari and English in English. " +
  "Do not translate, summarise, correct or add anything. Output only the transcribed text.";

export default {
  async fetch(req, env) {
    if (req.method !== "POST") return new Response("POST {model, image(dataUri), prompt?}", { status: 405 });
    const { model, image, prompt, maxTokens } = await req.json();
    const t0 = Date.now();
    try {
      const out = await env.AI.run(model, {
        messages: [{ role: "user", content: [{ type: "text", text: prompt ?? PROMPT }, { type: "image_url", image_url: { url: image } }] }],
        max_tokens: maxTokens ?? 2048,
        temperature: 0,
      });
      const text = out.response ?? out.choices?.[0]?.message?.content ?? "";
      return Response.json({ ok: true, ms: Date.now() - t0, text, usage: out.usage ?? null });
    } catch (e) {
      return Response.json({ ok: false, ms: Date.now() - t0, error: String(e?.message ?? e) });
    }
  },
};
