import { tg } from './telegram';

/**
 * Frontend API client.
 * Security: Zero API keys or secrets live in frontend code.
 * Every request attaches `X-Telegram-Init-Data` so the backend verifies HMAC with BOT_TOKEN.
 */
export function getAuthHeaders(extra = {}) {
  const initData = tg?.initData || window.Telegram?.WebApp?.initData || '';
  const headers = { ...extra };
  if (initData) {
    headers['X-Telegram-Init-Data'] = initData;
  }
  return headers;
}

export async function apiJson(path, { method = 'GET', body } = {}) {
  const headers = getAuthHeaders(body !== undefined ? { 'Content-Type': 'application/json' } : {});
  const res = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function apiUploadSlip(blobOrFile, name = 'slip.png') {
  const headers = getAuthHeaders({
    'Content-Type': blobOrFile.type || 'image/png',
    'X-File-Name': encodeURIComponent(name),
  });
  const res = await fetch('/api/slips', {
    method: 'POST',
    headers,
    credentials: 'same-origin',
    body: blobOrFile,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'อัปโหลดสลิปไม่สำเร็จ');
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function apiFetchSlipObjectUrl(slipId) {
  if (!slipId) return null;
  const res = await fetch(`/api/slips/${encodeURIComponent(slipId)}`, {
    method: 'GET',
    headers: getAuthHeaders(),
    credentials: 'same-origin',
  });
  if (!res.ok) return null;
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export async function apiDownloadCsv(params = {}) {
  const qs = new URLSearchParams();
  if (typeof params === 'string') {
    if (params) qs.set('month', params);
  } else if (params && typeof params === 'object') {
    for (const [k, v] of Object.entries(params)) {
      if (v) qs.set(k, String(v));
    }
  }
  const qStr = qs.toString() ? `?${qs.toString()}` : '';
  const res = await fetch(`/api/export.csv${qStr}`, {
    method: 'GET',
    headers: getAuthHeaders(),
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'ส่งออก CSV ไม่สำเร็จ');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const suffix = typeof params === 'string' ? params || 'all' : params.month || params.from || 'custom';
  a.download = `ce-money-tracker-${suffix}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}
