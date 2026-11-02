// Minimal HTTP client for the OpenCode v2 HTTP API.
// Basic auth header lives in memory only and is never persisted.

const encodeBasic = (login, password) => {
  const bytes = new TextEncoder().encode(`${login}:${password}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
};

function assertBaseUrl(value) {
  let parsed;
  try { parsed = new URL(String(value)); } catch { throw new Error('baseUrl must be http(s)'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('baseUrl must be http(s)');
  if (parsed.username || parsed.password || parsed.search || parsed.hash)
    throw new Error('baseUrl must not contain userinfo, query or hash');
  return (parsed.origin + parsed.pathname).replace(/\/+$/, '');
}

export function createV2Client({
  baseUrl,
  login,
  password,
  requestImpl = fetch,
  timeoutMs = 15000,
}) {
  const base = assertBaseUrl(baseUrl);
  let authHeader = login !== undefined && login !== null
    ? encodeBasic(login, password)
    : null;
  const activeRequests = new Set();

  async function request(method, path, body) {
    const controller = new AbortController();
    activeRequests.add(controller);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = {};
      if (authHeader) headers.Authorization = authHeader;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await requestImpl(base + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
      return res.status === 204 ? undefined : await res.json();
    } finally {
      clearTimeout(timer);
      activeRequests.delete(controller);
    }
  }

  const sessionPath = (id) => `/api/session/${encodeURIComponent(id)}`;

  return {
    info: () => request('GET', '/api/info'),
    listSessions: () => request('GET', '/api/session'),
    createSession: (opts) =>
      request('POST', '/api/session', opts && opts.title !== undefined ? { title: opts.title } : {}),
    listMessages: (id) => request('GET', `${sessionPath(id)}/message`),
    prompt: (id, text) => request('POST', `${sessionPath(id)}/prompt`, { text }),
    interrupt: (id) => request('POST', `${sessionPath(id)}/interrupt`),
    // No persistent connection: every call is a standalone request.
    disconnect: () => {
      authHeader = null;
      for (const controller of activeRequests) controller.abort();
    },
  };
}
