import { serverRequest } from '../serverConnection.js';
export class AdminRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function adminRequest<T>(path: string, method = 'GET', body?: unknown, csrfToken?: string): Promise<T> {
  const response = await serverRequest(path, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: { ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}), ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const value = await response.json() as T & { error?: { message: string } };
  if (!response.ok) throw new AdminRequestError(value.error?.message ?? 'The request could not be completed.', response.status);
  return value;
}
