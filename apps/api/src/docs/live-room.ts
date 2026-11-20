import { DurableObject } from "cloudflare:workers";
import { LIVE_CLOSE, LIVE_MAX_MESSAGE_BYTES, LIVE_ROOM_CAP, liveMessageBytes, readLiveHere, type LiveServerMessage } from "@scholar/shared";
import type { Env } from "../platform/env";
import { LIVE_WHO_HEADER, applyHere, freshBucket, freshConn, presenceOf, readConn, revokes, take, type Bucket, type LiveConn, type LiveRevoke, type LiveSignal, type LiveWho } from "./live-presence";

/**
 * One paper's room (docs/design/paper-live.md, section 2): a Durable Object a paper (`getByName(<paper id>)`), with hibernatable WebSockets, so it is not billed for the time it waits.
 * Who is here and where lives in each socket's attachment and in memory, nothing in storage: when everyone has left it is gone, and there is no record of who looked at what.
 *   fetch(upgrade)   a socket joins (the Worker checked the person's access first and says who they are in LIVE_WHO_HEADER); refused with 429 past LIVE_ROOM_CAP sockets.
 *   message          `here` (where the page is): read by readLiveHere, at most 2 KB, at most 20 a second; then the presence list goes to everyone, when it changed.
 *   signal()         a write succeeded (RPC from the Worker): `changed` goes to everyone. A signal, never content: the page fetches the thing through its route.
 *   revoke()         access ended (RPC from the Worker): those sockets are closed with 4403, or 4001 when only the role changed (the page connects again).
 */
export class PaperRoom extends DurableObject<Env> {
  /** In memory only (lost with hibernation, which is harmless: a bucket starts full, and the list is sent again on the next change). */
  private buckets = new Map<string, Bucket>();
  private lastSent = "";

  private open(): { ws: WebSocket; c: LiveConn }[] {
    const out: { ws: WebSocket; c: LiveConn }[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const c = readConn(ws.deserializeAttachment());
      if (c) out.push({ ws, c });
    }
    return out;
  }

  private send(ws: WebSocket, m: LiveServerMessage): void {
    try {
      ws.send(JSON.stringify(m));
    } catch {
      /* closing: the close handler tells the others */
    }
  }

  /** The presence list to everyone, when it is not what was sent last (a heartbeat that changes nothing sends nothing). */
  private broadcastPresence(force = false): void {
    const all = this.open();
    const people = presenceOf(all.map((x) => x.c), Date.now());
    const text = JSON.stringify({ t: "presence", people } satisfies LiveServerMessage);
    if (!force && text === this.lastSent) return;
    this.lastSent = text;
    for (const { ws } of all) {
      try {
        ws.send(text);
      } catch {
        /* closing */
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    let who: LiveWho;
    try {
      who = JSON.parse(request.headers.get(LIVE_WHO_HEADER) ?? "") as LiveWho;
      if (typeof who?.userId !== "string" || typeof who.name !== "string") throw new Error("who");
    } catch {
      return new Response("Not found", { status: 404 });
    }
    if (this.ctx.getWebSockets().length >= LIVE_ROOM_CAP) return new Response("This paper has as many people open as it can hold", { status: 429 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const conn = crypto.randomUUID();
    this.ctx.acceptWebSocket(server, [`u:${who.userId}`]);
    server.serializeAttachment(freshConn(conn, who, Date.now()));
    this.send(server, { t: "hello", you: who.userId, colour: who.colour, role: who.role });
    this.broadcastPresence(true);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const c = readConn(ws.deserializeAttachment());
    if (!c) return ws.close(LIVE_CLOSE.abuse, "unknown");
    if (typeof message !== "string") return ws.close(LIVE_CLOSE.abuse, "text only");
    if (liveMessageBytes(message) > LIVE_MAX_MESSAGE_BYTES) return ws.close(LIVE_CLOSE.tooBig, "too big");
    const now = Date.now();
    let b = this.buckets.get(c.conn);
    if (!b) this.buckets.set(c.conn, (b = freshBucket(now)));
    const verdict = take(b, now);
    if (verdict === "close") return ws.close(LIVE_CLOSE.abuse, "too many messages");
    if (verdict === "drop") return;
    const here = readLiveHere(message);
    if (!here) return;
    ws.serializeAttachment(applyHere(c, here, now));
    this.broadcastPresence();
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    this.gone(ws);
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, "bye");
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.gone(ws);
  }

  private gone(ws: WebSocket): void {
    const c = readConn(ws.deserializeAttachment());
    if (c) this.buckets.delete(c.conn);
    this.broadcastPresence();
  }

  /** A write succeeded: everyone in the room is told what changed (they fetch it through its route). */
  async signal(s: LiveSignal): Promise<number> {
    const all = this.open();
    const m: LiveServerMessage = { t: "changed", kind: s.kind, by: String(s.by), ...(typeof s.id === "string" ? { id: s.id } : {}), ...(typeof s.rev === "number" ? { rev: s.rev } : {}) };
    for (const { ws } of all) this.send(ws, m);
    return all.length;
  }

  /** Access ended (or a role changed): the matching sockets are closed. Returns how many. */
  async revoke(r: LiveRevoke): Promise<number> {
    let n = 0;
    for (const { ws, c } of this.open()) {
      if (!revokes(c, r)) continue;
      n++;
      this.buckets.delete(c.conn);
      try {
        ws.close(r.reconnect ? LIVE_CLOSE.reconnect : LIVE_CLOSE.noAccess, r.reconnect ? "role changed" : "no access");
      } catch {
        /* already closing */
      }
    }
    if (n) this.broadcastPresence();
    return n;
  }
}
