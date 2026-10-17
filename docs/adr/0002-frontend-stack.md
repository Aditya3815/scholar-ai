# ADR 0002: Frontend stack for the search slice

Status: accepted, 2026-10-17

## Decisions
- **Plain CSS with design tokens** (not Tailwind yet). Three themes are just variable sets; the component CSS is ~700 lines and reads the tokens. Tailwind adds a build dependency without removing work at this size. Revisit when the component count grows.
- **Radix primitives** (Popover, Dialog, Tabs) for focus management, Escape handling and ARIA; **Motion** for animation, loaded through `LazyMotion` as a separate chunk.
- **EventSource (SSE)** for streaming search; no polling, no WebSocket. Fits Workers and needs no client library.
- **No router yet.** One screen plus a drawer. TanStack Router arrives with the second page (paper workspace, Phase 1). Query state lives in the URL (`?q=`) so searches are shareable.
- **No TanStack Query yet.** Search state is stream-local. It joins when server state needs caching (library, jobs).
- **Library in localStorage** behind `lib/library.ts` (`useLibrary`, `toggleSaved`, `removeSaved`) so swapping to the D1-backed API after sign-in changes one file.

## Consequences
- Initial JS 142 KB gzip (React 19 + Radix + Motion core). If the 150 KB budget gets tight, split the drawer and popovers with dynamic imports.
- Citations are formatted client-side from record metadata (`lib/cite.ts`); correct for the common cases, heuristic on author names. A server-side CSL path replaces it in Phase 1.
