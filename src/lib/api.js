// One fetch wrapper for every panel: checks the status before parsing, never throws on HTML error pages,
// and carries the HTTP status so callers can react to 401/429.
export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}
export const seg = value => encodeURIComponent(String(value ?? ''));
export async function api(path, { method = 'GET', body, raw, headers = {}, signal } = {}) {
  const init = { method, credentials: 'same-origin', headers: { ...headers }, signal };
  if (raw !== undefined) init.body = raw;
  else if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch('/api' + path, init);
  } catch {
    throw new ApiError('Network error. Check your connection and try again.', 0, null);
  }
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }
  }
  if (!response.ok) {
    const fallback =
      response.status === 429
        ? 'Too many attempts. Please wait a few minutes and try again.'
        : response.status === 401
          ? 'Please sign in'
          : response.status >= 500
            ? 'The server could not complete this request. Please try again.'
            : 'Request failed (' + response.status + ')';
    throw new ApiError(data.error || fallback, response.status, data);
  }
  return data;
}
export const get = path => api(path);
export const post = (path, body = {}) => api(path, { method: 'POST', body });
export const put = (path, body = {}) => api(path, { method: 'PUT', body });
export const patch = (path, body = {}) => api(path, { method: 'PATCH', body });
export const del = path => api(path, { method: 'DELETE' });
export const upload = (path, blob, contentType = 'application/octet-stream') =>
  api(path, { method: 'POST', raw: blob, headers: { 'content-type': contentType } });
