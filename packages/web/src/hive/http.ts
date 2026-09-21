export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'ApiError'; }
}
const TOKEN_KEY = 'lister.hive.access-token';
export function setAccessToken(token: string) { localStorage.setItem(TOKEN_KEY, token); }
export async function request<T>(method: string, url: string, body?: unknown, contentType = 'application/json'): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers: Record<string,string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = contentType;
  const response = await fetch(url, {method, headers, credentials:'same-origin', cache:'no-store', signal: AbortSignal.timeout(12000), body: body === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(body) : body as string});
  const text = await response.text();
  let data: any;
  try { data = text ? JSON.parse(text) : null; } catch { data = {error:text}; }
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('hive-auth-required'));
    throw new ApiError(response.status, data?.error ?? response.statusText);
  }
  return data as T;
}

export async function logout() {
  await request('POST','/api/hive/auth/logout');
  localStorage.removeItem(TOKEN_KEY);
}
export interface BrowserSession { id:string; label:string; created:number; expires:number; current:boolean }
