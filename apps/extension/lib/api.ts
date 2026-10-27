type ApiEnvelope = { json: unknown };

function isEnvelope(value: unknown): value is ApiEnvelope {
  return typeof value === 'object' && value !== null && Object.hasOwn(value, 'json');
}

export async function requestApi<T>(
  baseUrl: string,
  path: string,
  input: object,
  token?: string,
  fetcher: typeof fetch = fetch,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const response = await fetcher(`${baseUrl}/api/rpc/${path}`, {
    method: 'POST',
    // Extension requests use their own bearer session, independently of website cookies.
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ json: input }),
    signal: AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 8000), ...(options.signal ? [options.signal] : [])]),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = isEnvelope(payload) ? payload.json : null;
    if (typeof detail === 'object' && detail !== null && 'message' in detail && typeof detail.message === 'string') {
      throw new Error(detail.message);
    }
    throw new Error(response.status === 403
      ? 'The library rejected this request (403). Please sign in again.'
      : `Library request failed (${response.status}).`);
  }
  if (!isEnvelope(payload)) throw new Error('The library returned an unexpected response. Please try again.');
  return payload.json as T;
}
