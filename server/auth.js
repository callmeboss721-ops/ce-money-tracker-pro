import crypto from 'node:crypto';

/**
 * Verify Telegram Mini App `initData` per official Telegram specification:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifyTelegramInitData(initDataRaw, botToken, maxAgeSec = 86400) {
  if (!initDataRaw || typeof initDataRaw !== 'string') {
    return { ok: false, error: 'Missing Telegram initData' };
  }
  if (!botToken) {
    return { ok: false, error: 'Server BOT_TOKEN is not configured' };
  }

  const params = new URLSearchParams(initDataRaw);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) {
    return { ok: false, error: 'Invalid initData hash format' };
  }

  const pairs = [];
  for (const [k, v] of params.entries()) {
    if (k === 'hash') continue;
    pairs.push(`${k}=${v}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expectedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const a = Buffer.from(hash.toLowerCase(), 'hex');
  const b = Buffer.from(expectedHash.toLowerCase(), 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: 'Invalid Telegram initData signature' };
  }

  const authDate = Number(params.get('auth_date') || 0);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!authDate || authDate > nowSec + 300 || (maxAgeSec > 0 && nowSec - authDate > maxAgeSec)) {
    return { ok: false, error: 'Expired Telegram initData' };
  }

  let userObj;
  try {
    userObj = JSON.parse(params.get('user') || 'null');
  } catch {
    return { ok: false, error: 'Malformed user payload in initData' };
  }
  if (!userObj || !userObj.id) {
    return { ok: false, error: 'Missing Telegram user id' };
  }

  if (process.env.OWNER_TELEGRAM_ID && String(userObj.id) !== String(process.env.OWNER_TELEGRAM_ID)) {
    return { ok: false, status: 403, error: 'Forbidden: non-owner Telegram account' };
  }

  return {
    ok: true,
    user: {
      id: `tg_${userObj.id}`,
      telegramId: String(userObj.id),
      firstName: userObj.first_name || '',
      lastName: userObj.last_name || '',
      username: userObj.username || '',
      photoUrl: userObj.photo_url || '',
      authMode: 'telegram',
    },
  };
}

// Ephemeral per-boot fallback secret ONLY if SESSION_SECRET / BOT_TOKEN absent in local dev
const EPHEMERAL_SECRET = crypto.randomBytes(32).toString('hex');
function signingSecret() {
  return process.env.SESSION_SECRET || process.env.BOT_TOKEN || EPHEMERAL_SECRET;
}

/** Short-lived owner-bound HMAC token for private slip viewing (default 120s). */
export function signSlipToken(userId, slipId, ttlSec = 120) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${userId}:${slipId}:${exp}`;
  const sig = crypto.createHmac('sha256', signingSecret()).update(`slip:${payload}`).digest('hex');
  return `${exp}.${sig}`;
}

export function verifySlipToken(token, userId, slipId) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [expStr, sig] = token.split('.');
  const exp = Number(expStr);
  if (!exp || exp < Math.floor(Date.now() / 1000) || !/^[0-9a-f]{64}$/i.test(sig)) return false;
  const payload = `${userId}:${slipId}:${exp}`;
  const expected = crypto.createHmac('sha256', signingSecret()).update(`slip:${payload}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
}

function parseCookies(cookieHeader = '') {
  const out = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function signDevUid(uid) {
  const sig = crypto.createHmac('sha256', signingSecret()).update(`dev:${uid}`).digest('hex').slice(0, 32);
  return `${uid}.${sig}`;
}

function verifyDevUid(raw) {
  if (!raw || !raw.includes('.')) return null;
  const [uid, sig] = raw.split('.');
  if (!/^dev_[a-f0-9]{16}$/.test(uid)) return null;
  const expected = crypto.createHmac('sha256', signingSecret()).update(`dev:${uid}`).digest('hex').slice(0, 32);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return uid;
}

/**
 * Authenticate every API request:
 * 1. If `X-Telegram-Init-Data` (or `Authorization: tma ...`) is supplied, ALWAYS verify HMAC with BOT_TOKEN.
 * 2. Otherwise, ONLY when `ALLOW_DEV_PREVIEW=true` (non-production preview), assign a signed HttpOnly
 *    per-browser sandboxed user cookie so preview works outside Telegram while keeping per-user isolation.
 */
export function authenticateRequest(req, res) {
  const authHeader = req.headers['authorization'] || '';
  const initData =
    req.headers['x-telegram-init-data'] ||
    (authHeader.toLowerCase().startsWith('tma ') ? authHeader.slice(4).trim() : '');

  const maxAge = Number(process.env.INIT_DATA_MAX_AGE_SEC || 86400);

  if (initData) {
    return verifyTelegramInitData(String(initData), process.env.BOT_TOKEN, maxAge);
  }

  const allowPreview = process.env.ALLOW_DEV_PREVIEW === 'true' && process.env.NODE_ENV !== 'production';
  if (allowPreview) {
    const cookies = parseCookies(req.headers.cookie || '');
    let uid = verifyDevUid(cookies.ce_dev_session);
    if (!uid) {
      uid = `dev_${crypto.randomBytes(8).toString('hex')}`;
      res.setHeader(
        'Set-Cookie',
        `ce_dev_session=${encodeURIComponent(signDevUid(uid))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
      );
    }
    return {
      ok: true,
      user: {
        id: uid,
        telegramId: null,
        firstName: 'โหมดตัวอย่าง',
        lastName: '(Preview)',
        username: '',
        photoUrl: '',
        authMode: 'preview',
      },
    };
  }

  return { ok: false, status: 401, error: 'กรุณาเปิดแอปผ่าน Telegram (ไม่พบ initData ที่ถูกต้อง)' };
}
