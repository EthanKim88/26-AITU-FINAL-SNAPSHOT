const BASE_URL = process.env.CTF_OPS_URL || "http://localhost:10000";

async function request(method: string, path: string, body?: unknown): Promise<unknown> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();

  if (!res.ok) {
    const msg = (data as { error?: string }).error || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return data;
}

export function apiGet(path: string) {
  return request("GET", path);
}

export function apiPost(path: string, body: unknown) {
  return request("POST", path, body);
}

export function apiPatch(path: string, body: unknown) {
  return request("PATCH", path, body);
}

export function apiDelete(path: string) {
  return request("DELETE", path);
}
