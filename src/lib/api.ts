export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly data: Record<string, unknown> | null = null) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

// Every server answer is JSON; errors carry an Uzbek message the page can show as it is.
export async function api<T = unknown>(endpoint: string, method: Method = 'GET', body?: unknown): Promise<T> {
  const options: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) options.body = JSON.stringify(body);
  let res: Response;
  try {
    res = await fetch(`/api${endpoint}`, options);
  } catch {
    throw new ApiError('Server bilan aloqa yo‘q. Internetni tekshirib, qayta urinib ko‘ring.', 0);
  }
  let data: Record<string, unknown> | null = null;
  try {
    data = await res.json();
  } catch {
    // An HTML error page from a proxy; the status says enough.
  }
  if (!res.ok) throw new ApiError(typeof data?.error === 'string' ? data.error : `Server xatosi: ${res.status}`, res.status, data);
  return data as T;
}
