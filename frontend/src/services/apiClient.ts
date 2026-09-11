const API_URL = import.meta.env.VITE_API_URL;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type ApiEnvelope<T> = { data: T } | { error: { code: string; message: string } };

/**
 * Thin fetch wrapper: always sends the session cookie (credentials:
 * "include", required since the API and frontend are different origins in
 * dev), always parses the API's { data } / { error } envelope, and turns a
 * { error } response into a typed ApiError instead of a generic HTTP failure.
 */
export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  // A 204 (e.g. logout) has no body at all — res.json() would throw on the
  // empty string, so that case is success with no data, not a parse failure.
  if (res.status === 204) {
    return undefined as T;
  }

  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;

  if (!res.ok || !body || "error" in body) {
    const code = body && "error" in body ? body.error.code : "UNKNOWN_ERROR";
    const message =
      body && "error" in body ? body.error.message : `Request failed with status ${res.status}`;
    throw new ApiError(res.status, code, message);
  }

  return body.data;
}
