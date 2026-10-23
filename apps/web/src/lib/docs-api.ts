/** The way the browser talks to /api/v1/documents: one error type, one request helper. Shared by the paper list, the upload job and the scan reader. */

export class ApiError extends Error {
  constructor(readonly status: number, readonly type: string, title: string, readonly detail?: string) {
    super(detail ? `${title}. ${detail}` : title);
  }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/v1/documents${path}`, { credentials: "same-origin", ...init });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { type?: string; title?: string; detail?: string } | null;
    throw new ApiError(res.status, j?.type ?? "error", j?.title ?? `The service answered ${res.status}`, j?.detail);
  }
  return (await res.json()) as T;
}

export const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
