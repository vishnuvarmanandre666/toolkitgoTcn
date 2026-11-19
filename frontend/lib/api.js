/**
 * Thin fetch wrapper for the ToolkitGo API. All calls go to the same-origin
 * /api proxy so httpOnly session cookies are sent automatically.
 */
export class ApiError extends Error {
  constructor(status, body) {
    const msg = Array.isArray(body?.message) ? body.message.join('. ') : body?.message || 'Request failed';
    super(msg);
    this.status = status;
    this.details = body?.details;
    this.messages = Array.isArray(body?.message) ? body.message : [msg];
  }
}

async function parse(res) {
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text };
  }
  if (!res.ok) throw new ApiError(res.status, body);
  return body;
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      signal,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new ApiError(0, { message: 'Network error. Check your connection and try again.' });
  }
  return parse(res);
}

/** Multipart upload with progress (fetch has no upload progress events). */
export function uploadWithProgress(path, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${path}`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = { message: xhr.responseText };
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new ApiError(xhr.status, body));
    };
    xhr.onerror = () => reject(new ApiError(0, { message: 'Upload failed. Check your connection and try again.' }));
    xhr.send(formData);
  });
}
