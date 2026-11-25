import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { authenticateRequest, signSlipToken, verifySlipToken } from './auth.js';
import {
  db,
  SLIPS_DIR,
  ensureUserSeeded,
  getUserBootstrap,
  sanitizeLast4,
  roundAmount,
  hashPin,
  verifyPinHash,
  recordTxHistory,
  processDueRecurring,
  DEFAULT_BOT_PREFS,
} from './db.js';
import {
  startBotAndScheduler,
  handleTelegramUpdate,
  sendTelegramMessage,
  buildUserSummaryText,
  maybeSendBudgetTelegramAlert,
} from './bot.js';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '../dist');
const PORT = Number(process.env.PORT || 4173);
const MAX_SLIP_BYTES = 5 * 1024 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;

const MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

// PIN brute-force rate limiter (per userId)
const pinAttempts = new Map(); // userId -> { count, resetAt }
function checkPinRateLimit(userId) {
  const now = Date.now();
  const rec = pinAttempts.get(userId);
  if (!rec || now > rec.resetAt) {
    pinAttempts.set(userId, { count: 0, resetAt: now + 5 * 60 * 1000 });
    return true;
  }
  return rec.count < 5;
}
function recordPinFailure(userId) {
  const now = Date.now();
  const rec = pinAttempts.get(userId) || { count: 0, resetAt: now + 5 * 60 * 1000 };
  rec.count += 1;
  pinAttempts.set(userId, rec);
}
function clearPinFailures(userId) {
  pinAttempts.delete(userId);
}

// Cached live THB/USDT rate (5 min TTL)
let cachedLiveRate = { rate: null, fetchedAt: 0 };
async function fetchLiveUsdtThbRate() {
  const now = Date.now();
  if (cachedLiveRate.rate && now - cachedLiveRate.fetchedAt < 5 * 60 * 1000) {
    return cachedLiveRate.rate;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2200);
    const res = await fetch('https://api.bitkub.com/api/market/ticker?sym=THB_USDT', { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const last = Number(data?.THB_USDT?.last);
      if (last > 10 && last < 200) {
        cachedLiveRate = { rate: roundAmount(last, 'THB'), fetchedAt: now };
        return cachedLiveRate.rate;
      }
    }
  } catch {
    /* network restricted or offline — graceful fallback */
  }
  return null;
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function readBuffer(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(Object.assign(new Error('ไฟล์มีขนาดเกินกำหนด'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBuffer(req, MAX_JSON_BYTES);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw Object.assign(new Error('รูปแบบ JSON ไม่ถูกต้อง'), { status: 400 });
  }
}

function detectImageMime(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  return null;
}

function uid() {
  return crypto.randomUUID();
}

function safeUserDir(userId) {
  const safe = String(userId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const dir = path.join(SLIPS_DIR, safe);
  fs.mkdirSync(dir, { recursive: true });
  return { safe, dir };
}

function csvCell(val) {
  let s = val == null ? '' : String(val);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;

  // Phase 4: Telegram Webhook endpoint (authenticated via secret token header)
  if (pathname === '/api/telegram/webhook' && req.method === 'POST') {
    if (!process.env.BOT_TOKEN) return sendJson(res, 503, { error: 'BOT_TOKEN not configured' });
    if (process.env.WEBHOOK_SECRET) {
      const got = String(req.headers['x-telegram-bot-api-secret-token'] || '');
      const exp = String(process.env.WEBHOOK_SECRET);
      const a = Buffer.from(got);
      const b = Buffer.from(exp);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return sendJson(res, 401, { error: 'Invalid webhook secret' });
      }
    }
    const update = await readJson(req);
    await handleTelegramUpdate(update);
    return sendJson(res, 200, { ok: true });
  }

  // Private slip stream: GET /api/slips/:id (owner auth OR short-lived HMAC token)
  const slipMatch = pathname.match(/^\/api\/slips\/([a-zA-Z0-9_-]+)(\/sign)?$/);
  if (slipMatch && req.method === 'GET' && !slipMatch[2]) {
    const slipId = slipMatch[1];
    let authedUserId = null;

    const qUid = url.searchParams.get('uid');
    const qTok = url.searchParams.get('token');
    if (qUid && qTok && verifySlipToken(qTok, qUid, slipId)) {
      authedUserId = qUid;
    } else {
      const auth = authenticateRequest(req, res);
      if (!auth.ok) return sendJson(res, auth.status || 401, { error: auth.error });
      authedUserId = auth.user.id;
    }

    const row = db
      .prepare('SELECT mime_type, size_bytes, rel_path FROM slips WHERE user_id = ? AND id = ?')
      .get(authedUserId, slipId);
    if (!row) return sendJson(res, 404, { error: 'ไม่พบไฟล์สลิปหรือไม่มีสิทธิ์เข้าถึง' });

    const absPath = path.resolve(SLIPS_DIR, row.rel_path);
    if (!absPath.startsWith(SLIPS_DIR + path.sep) || !fs.existsSync(absPath)) {
      return sendJson(res, 404, { error: 'ไม่พบไฟล์สลิป' });
    }

    res.writeHead(200, {
      'Content-Type': row.mime_type,
      'Content-Length': row.size_bytes,
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(absPath).pipe(res);
    return;
  }

  // Every other API endpoint MUST pass authenticateRequest
  const auth = authenticateRequest(req, res);
  if (!auth.ok) {
    logger.warn(`Unauthorized ${req.method} ${pathname}: ${auth.error}`);
    return sendJson(res, auth.status || 401, { error: auth.error });
  }
  const user = auth.user;
  ensureUserSeeded(user);

  // Sign short-lived private slip URL
  if (slipMatch && slipMatch[2] === '/sign' && req.method === 'POST') {
    const slipId = slipMatch[1];
    const exists = db.prepare('SELECT id FROM slips WHERE user_id = ? AND id = ?').get(user.id, slipId);
    if (!exists) return sendJson(res, 404, { error: 'ไม่พบสลิป' });
    const token = signSlipToken(user.id, slipId, 180);
    return sendJson(res, 200, {
      url: `/api/slips/${encodeURIComponent(slipId)}?uid=${encodeURIComponent(user.id)}&token=${encodeURIComponent(token)}`,
    });
  }

  // GET /api/bootstrap (also runs any due recurring rules!)
  if (pathname === '/api/bootstrap' && req.method === 'GET') {
    processDueRecurring(user.id);
    return sendJson(res, 200, { user, ...getUserBootstrap(user.id) });
  }

  // Phase 2: GET & PUT /api/rate (USDT/THB exchange rate)
  if (pathname === '/api/rate' && req.method === 'GET') {
    const live = await fetchLiveUsdtThbRate();
    const row = db.prepare('SELECT usdt_rate FROM users WHERE id = ?').get(user.id);
    const saved = Number(row?.usdt_rate || 34.5);
    const rate = live || saved;
    if (live) {
      db.prepare('UPDATE users SET usdt_rate = ? WHERE id = ?').run(live, user.id);
    }
    return sendJson(res, 200, { rate, source: live ? 'live' : 'saved', saved });
  }
  if (pathname === '/api/rate' && req.method === 'PUT') {
    const body = await readJson(req);
    const rate = roundAmount(body.rate, 'USDT');
    if (!(rate > 0 && rate < 1000)) return sendJson(res, 400, { error: 'เรทไม่ถูกต้อง' });
    db.prepare('UPDATE users SET usdt_rate = ?, updated_at = ? WHERE id = ?').run(rate, new Date().toISOString(), user.id);
    return sendJson(res, 200, { ok: true, rate });
  }

  // POST /api/slips — upload private slip
  if (pathname === '/api/slips' && req.method === 'POST') {
    const ct = (req.headers['content-type'] || '').toLowerCase();
    let imgBuf;
    let origName = 'slip';

    if (ct.startsWith('multipart/form-data')) {
      const raw = await readBuffer(req, MAX_SLIP_BYTES + 65536);
      const webRes = new Response(raw, { headers: { 'content-type': req.headers['content-type'] } });
      const form = await webRes.formData();
      const file = form.get('slip') || form.get('file');
      if (!file || typeof file.arrayBuffer !== 'function') {
        return sendJson(res, 400, { error: 'ไม่พบไฟล์สลิป' });
      }
      origName = String(file.name || 'slip').slice(0, 120);
      imgBuf = Buffer.from(await file.arrayBuffer());
    } else {
      imgBuf = await readBuffer(req, MAX_SLIP_BYTES);
      if (req.headers['x-file-name']) {
        try {
          origName = decodeURIComponent(String(req.headers['x-file-name'])).slice(0, 120);
        } catch {
          origName = 'slip';
        }
      }
    }

    if (!imgBuf || imgBuf.length === 0) return sendJson(res, 400, { error: 'ไฟล์สลิปว่างเปล่า' });
    if (imgBuf.length > MAX_SLIP_BYTES) return sendJson(res, 413, { error: 'ไฟล์สลิปต้องมีขนาดไม่เกิน 5MB' });

    const mime = detectImageMime(imgBuf);
    if (!mime) return sendJson(res, 400, { error: 'รองรับเฉพาะไฟล์รูปภาพ JPG หรือ PNG เท่านั้น' });

    const slipId = uid();
    const ext = mime === 'image/png' ? 'png' : 'jpg';
    const { safe, dir } = safeUserDir(user.id);
    const filename = `${slipId}.${ext}`;
    fs.writeFileSync(path.join(dir, filename), imgBuf, { mode: 0o600 });

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO slips (user_id, id, mime_type, size_bytes, rel_path, orig_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(user.id, slipId, mime, imgBuf.length, `${safe}/${filename}`, origName, now);

    return sendJson(res, 201, { id: slipId, mimeType: mime, size: imgBuf.length });
  }

  // Transactions CRUD + Transfer + USDT + Tags + Audit History
  const txHistMatch = pathname.match(/^\/api\/transactions\/([a-zA-Z0-9_-]+)\/history$/);
  if (txHistMatch && req.method === 'GET') {
    const rows = db
      .prepare('SELECT id, action, summary, snapshot_json, changed_at FROM tx_history WHERE user_id = ? AND tx_id = ? ORDER BY changed_at DESC')
      .all(user.id, txHistMatch[1])
      .map((r) => ({ id: r.id, action: r.action, summary: r.summary, snapshot: JSON.parse(r.snapshot_json || '{}'), changedAt: r.changed_at }));
    return sendJson(res, 200, { history: rows });
  }

  const txIdMatch = pathname.match(/^\/api\/transactions\/([a-zA-Z0-9_-]+)$/);
  if ((pathname === '/api/transactions' && req.method === 'POST') || (txIdMatch && req.method === 'PUT')) {
    const body = await readJson(req);
    const id = txIdMatch ? txIdMatch[1] : body.id || uid();
    const type = ['expense', 'income', 'transfer'].includes(body.type) ? body.type : 'expense';
    const rawCur = String(body.currency || 'THB').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const currency = rawCur || 'THB';
    const amount = roundAmount(body.amount, currency === 'USDT' ? 'USDT' : 'THB');
    if (!(amount > 0)) return sendJson(res, 400, { error: 'จำนวนเงินต้องมากกว่า 0' });
    if (!body.walletId) return sendJson(res, 400, { error: 'กรุณาเลือกวอลเล็ท' });
    if (type === 'transfer') {
      if (!body.toWalletId || body.toWalletId === body.walletId) {
        return sendJson(res, 400, { error: 'กรุณาเลือกวอลเล็ทปลายทางที่ต่างจากต้นทาง' });
      }
    } else if (!body.categoryId) {
      return sendJson(res, 400, { error: 'กรุณาเลือกหมวดหมู่' });
    }

    let slipId = body.slipId || null;
    if (slipId) {
      const ownSlip = db.prepare('SELECT id FROM slips WHERE user_id = ? AND id = ?').get(user.id, slipId);
      if (!ownSlip) slipId = null;
    }

    const hasExplicitFx = body.fxRate != null && Number(body.fxRate) > 0;
    const fxRate = currency === 'THB' ? 1 : hasExplicitFx ? Number(body.fxRate) : 0;
    const amountThb =
      currency === 'THB'
        ? roundAmount(amount, 'THB')
        : fxRate > 0
          ? body.amountTHB != null
            ? roundAmount(body.amountTHB, 'THB')
            : roundAmount(amount * fxRate, 'THB')
          : null;
    const fee = type === 'transfer' ? Math.max(0, roundAmount(body.fee || 0, currency)) : 0;
    const toWalletId = type === 'transfer' ? String(body.toWalletId) : null;
    let toAmount = null;
    if (type === 'transfer') {
      const destWallet = db.prepare('SELECT currency FROM wallets WHERE user_id = ? AND id = ?').get(user.id, toWalletId);
      const destCur = destWallet?.currency || 'THB';
      if (body.toAmount != null && Number(body.toAmount) > 0) {
        toAmount = roundAmount(body.toAmount, destCur);
      } else if (currency === destCur) {
        toAmount = amount;
      } else if (currency === 'USDT' && destCur === 'THB') {
        toAmount = roundAmount(amount * fxRate, 'THB');
      } else {
        toAmount = roundAmount(amount / fxRate, 'USDT');
      }
    }

    const now = new Date().toISOString();
    const prev = db.prepare('SELECT * FROM transactions WHERE user_id = ? AND id = ?').get(user.id, id);
    const channel = ['BANK', 'TRUEMONEY', 'USDT', 'CASH'].includes(body.channel) ? body.channel : currency === 'USDT' ? 'USDT' : 'CASH';
    const txDate = body.date ? new Date(body.date).toISOString() : now;
    const reference = String(body.reference || '').trim().slice(0, 160);
    const note = String(body.note || '').trim().slice(0, 500);
    const cleanTags = Array.isArray(body.tags)
      ? [...new Set(body.tags.map((t) => String(t).trim().replace(/^#+/, '')).filter(Boolean))].slice(0, 15)
      : [];
    const tagsJson = JSON.stringify(cleanTags);
    const catId = type === 'transfer' ? 'transfer' : String(body.categoryId);

    db.prepare(
      `INSERT INTO transactions (
         user_id, id, type, amount, currency, fx_rate, amount_thb,
         category_id, wallet_id, to_wallet_id, to_amount, fee,
         channel, tx_date, reference, note, slip_id, tags_json, deleted_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(user_id, id) DO UPDATE SET
         type = excluded.type,
         amount = excluded.amount,
         currency = excluded.currency,
         fx_rate = excluded.fx_rate,
         amount_thb = excluded.amount_thb,
         category_id = excluded.category_id,
         wallet_id = excluded.wallet_id,
         to_wallet_id = excluded.to_wallet_id,
         to_amount = excluded.to_amount,
         fee = excluded.fee,
         channel = excluded.channel,
         tx_date = excluded.tx_date,
         reference = excluded.reference,
         note = excluded.note,
         slip_id = excluded.slip_id,
         tags_json = excluded.tags_json,
         deleted_at = NULL,
         updated_at = excluded.updated_at`,
    ).run(
      user.id,
      id,
      type,
      amount,
      currency,
      fxRate,
      amountThb,
      catId,
      body.walletId,
      toWalletId,
      toAmount,
      fee,
      channel,
      txDate,
      reference,
      note,
      slipId,
      tagsJson,
      prev?.created_at || now,
      now,
    );

    const action = prev ? 'update' : 'create';
    const summary = prev
      ? `แก้ไขยอดเป็น ${amount} ${currency}${note ? ` (${note})` : ''}`
      : `สร้างรายการ ${amount} ${currency}${note ? ` (${note})` : ''}`;
    recordTxHistory(user.id, id, action, summary, {
      type,
      amount,
      currency,
      fxRate,
      amountTHB: amountThb,
      categoryId: catId,
      walletId: body.walletId,
      toWalletId,
      toAmount,
      fee,
      date: txDate,
      reference,
      note,
      tags: cleanTags,
    });

    // Check budget & optionally send Phase 4 Telegram budget alert
    if (type === 'expense') {
      const bRow = db
        .prepare('SELECT id, amount FROM budgets WHERE user_id = ? AND category_id = ? AND deleted_at IS NULL')
        .get(user.id, catId);
      if (bRow && bRow.amount > 0) {
        const dt = new Date(txDate);
        const ym = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
        const spentRow = db
          .prepare(
            `SELECT COALESCE(SUM(COALESCE(amount_thb, amount)), 0) AS total
             FROM transactions
             WHERE user_id = ? AND type = 'expense' AND category_id = ? AND deleted_at IS NULL AND substr(tx_date, 1, 7) = ?`,
          )
          .get(user.id, catId, ym);
        const spent = Number(spentRow?.total || 0);
        const pct = (spent / bRow.amount) * 100;
        const level = pct >= 100 ? 'over' : pct >= 70 ? 'warn' : 'ok';
        if (level !== 'ok') {
          const notifKey = `budget-${bRow.id}-${ym}-${level}`;
          const already = db.prepare('SELECT id FROM notifications WHERE user_id = ? AND id = ?').get(user.id, notifKey);
          if (!already) {
            const catRow = db.prepare('SELECT name FROM categories WHERE user_id = ? AND id = ?').get(user.id, catId);
            const catName = catRow?.name || 'หมวดหมู่';
            db.prepare('INSERT INTO notifications (user_id, id, title, body, is_read, created_at) VALUES (?, ?, ?, ?, 0, ?)').run(
              user.id,
              notifKey,
              level === 'over' ? `เกินงบแล้ว: ${catName}` : `ใกล้ถึงลิมิต: ${catName}`,
              `ใช้ไป ฿ ${spent.toFixed(2)} จากงบ ฿ ${bRow.amount.toFixed(2)}`,
              now,
            );
            maybeSendBudgetTelegramAlert(user.id, catName, spent, bRow.amount, level).catch(() => {});
          }
        }
      }
    }

    return sendJson(res, 200, { ok: true, id });
  }

  // DELETE /api/transactions/:id (soft delete + audit history)
  if (txIdMatch && req.method === 'DELETE') {
    const prev = db.prepare('SELECT * FROM transactions WHERE user_id = ? AND id = ?').get(user.id, txIdMatch[1]);
    if (!prev) return sendJson(res, 404, { error: 'ไม่พบรายการ' });
    const now = new Date().toISOString();
    db.prepare('UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND id = ?').run(now, now, user.id, txIdMatch[1]);
    recordTxHistory(user.id, txIdMatch[1], 'delete', `ย้ายรายการ ${prev.amount} ${prev.currency} ไปถังขยะ`, {
      amount: prev.amount,
      currency: prev.currency,
      note: prev.note,
    });
    return sendJson(res, 200, { ok: true });
  }

  // Wallets CRUD (supports THB & USDT)
  const walletMatch = pathname.match(/^\/api\/wallets\/([a-zA-Z0-9_-]+)$/);
  if ((pathname === '/api/wallets' && req.method === 'POST') || (walletMatch && req.method === 'PUT')) {
    const body = await readJson(req);
    const id = walletMatch ? walletMatch[1] : body.id || uid();
    const last4 = sanitizeLast4(body.last4);
    const currency = body.currency === 'USDT' ? 'USDT' : 'THB';
    const now = new Date().toISOString();
    const prev = db.prepare('SELECT created_at, sort_order FROM wallets WHERE user_id = ? AND id = ?').get(user.id, id);
    const order = prev?.sort_order ?? (body.order ?? 99);

    db.prepare(
      `INSERT INTO wallets (user_id, id, provider_code, grp, name, last4, initial_balance, currency, sort_order, deleted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(user_id, id) DO UPDATE SET
         provider_code = excluded.provider_code,
         grp = excluded.grp,
         name = excluded.name,
         last4 = excluded.last4,
         initial_balance = excluded.initial_balance,
         currency = excluded.currency,
         deleted_at = NULL,
         updated_at = excluded.updated_at`,
    ).run(
      user.id,
      id,
      String(body.providerCode || 'CASH').slice(0, 24),
      String(body.group || 'cash').slice(0, 24),
      String(body.name || 'วอลเล็ท').trim().slice(0, 80),
      last4,
      roundAmount(body.initialBalance || 0, currency),
      currency,
      order,
      prev?.created_at || now,
      now,
    );
    return sendJson(res, 200, { ok: true, id });
  }
  if (walletMatch && req.method === 'DELETE') {
    const now = new Date().toISOString();
    db.prepare('UPDATE wallets SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND id = ?').run(now, now, user.id, walletMatch[1]);
    return sendJson(res, 200, { ok: true });
  }

  // Categories CRUD
  const catMatch = pathname.match(/^\/api\/categories\/([a-zA-Z0-9_-]+)$/);
  if ((pathname === '/api/categories' && req.method === 'POST') || (catMatch && req.method === 'PUT')) {
    const body = await readJson(req);
    const id = catMatch ? catMatch[1] : body.id || uid();
    const name = String(body.name || '').trim().slice(0, 60);
    if (!name) return sendJson(res, 400, { error: 'กรุณาระบุชื่อหมวดหมู่' });
    const type = body.type === 'income' ? 'income' : 'expense';
    const now = new Date().toISOString();
    const prev = db.prepare('SELECT created_at, sort_order, is_default FROM categories WHERE user_id = ? AND id = ?').get(user.id, id);

    db.prepare(
      `INSERT INTO categories (user_id, id, type, name, icon, color, sort_order, is_default, deleted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(user_id, id) DO UPDATE SET
         type = excluded.type, name = excluded.name, icon = excluded.icon,
         color = excluded.color, deleted_at = NULL, updated_at = excluded.updated_at`,
    ).run(
      user.id,
      id,
      type,
      name,
      String(body.icon || 'ellipsis').slice(0, 40),
      String(body.color || '#4C8DFF').slice(0, 20),
      prev?.sort_order ?? 99,
      prev?.is_default ?? 0,
      prev?.created_at || now,
      now,
    );
    return sendJson(res, 200, { ok: true, id });
  }
  if (catMatch && req.method === 'DELETE') {
    const now = new Date().toISOString();
    db.prepare('UPDATE categories SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND id = ?').run(now, now, user.id, catMatch[1]);
    return sendJson(res, 200, { ok: true });
  }

  // Budgets CRUD
  const budgetMatch = pathname.match(/^\/api\/budgets\/([a-zA-Z0-9_-]+)$/);
  if (pathname === '/api/budgets' && req.method === 'POST') {
    const body = await readJson(req);
    const existing = db
      .prepare('SELECT id, created_at FROM budgets WHERE user_id = ? AND (id = ? OR (category_id = ? AND deleted_at IS NULL))')
      .get(user.id, body.id || '', body.categoryId || '');
    const id = existing?.id || body.id || uid();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO budgets (user_id, id, category_id, amount, period, deleted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'monthly', NULL, ?, ?)
       ON CONFLICT(user_id, id) DO UPDATE SET
         category_id = excluded.category_id, amount = excluded.amount, deleted_at = NULL, updated_at = excluded.updated_at`,
    ).run(user.id, id, String(body.categoryId), roundAmount(body.amount, 'THB'), existing?.created_at || now, now);
    return sendJson(res, 200, { ok: true, id });
  }
  if (budgetMatch && req.method === 'DELETE') {
    const now = new Date().toISOString();
    db.prepare('UPDATE budgets SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND id = ?').run(now, now, user.id, budgetMatch[1]);
    return sendJson(res, 200, { ok: true });
  }

  // Phase 3: Recurring Rules CRUD + manual Run Now
  const recRunMatch = pathname.match(/^\/api\/recurring\/([a-zA-Z0-9_-]+)\/run$/);
  if (recRunMatch && req.method === 'POST') {
    const rule = db.prepare('SELECT * FROM recurring_rules WHERE user_id = ? AND id = ? AND deleted_at IS NULL').get(user.id, recRunMatch[1]);
    if (!rule) return sendJson(res, 404, { error: 'ไม่พบรายการประจำ' });
    const txId = uid();
    const now = new Date().toISOString();
    const amtThb = roundAmount(rule.amount * (rule.fx_rate || 1), 'THB');
    db.prepare(
      `INSERT INTO transactions (
         user_id, id, type, amount, currency, fx_rate, amount_thb,
         category_id, wallet_id, to_wallet_id, to_amount, fee,
         channel, tx_date, reference, note, slip_id, tags_json, deleted_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)`,
    ).run(
      user.id,
      txId,
      rule.type,
      rule.amount,
      rule.currency,
      rule.fx_rate || 1,
      amtThb,
      rule.category_id || 'exp-other',
      rule.wallet_id,
      rule.to_wallet_id || null,
      rule.type === 'transfer' ? rule.amount : null,
      rule.channel || 'CASH',
      now,
      rule.reference || '',
      rule.note ? `[รายการประจำ] ${rule.note}` : '[รายการประจำ]',
      rule.tags_json || '[]',
      now,
      now,
    );
    recordTxHistory(user.id, txId, 'create', 'สั่งบันทึกรายการประจำทันที', { type: rule.type, amount: rule.amount, currency: rule.currency });
    return sendJson(res, 200, { ok: true, txId });
  }

  const recMatch = pathname.match(/^\/api\/recurring\/([a-zA-Z0-9_-]+)$/);
  if ((pathname === '/api/recurring' && req.method === 'POST') || (recMatch && req.method === 'PUT')) {
    const body = await readJson(req);
    const id = recMatch ? recMatch[1] : body.id || uid();
    const type = ['expense', 'income', 'transfer'].includes(body.type) ? body.type : 'expense';
    const currency = body.currency === 'USDT' ? 'USDT' : 'THB';
    const amount = roundAmount(body.amount, currency);
    if (!(amount > 0)) return sendJson(res, 400, { error: 'จำนวนเงินต้องมากกว่า 0' });
    const freq = ['daily', 'weekly', 'monthly', 'yearly'].includes(body.frequency) ? body.frequency : 'monthly';
    const nextRun = /^\d{4}-\d{2}-\d{2}$/.test(body.nextRunDate || '')
      ? body.nextRunDate
      : new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();
    const prev = db.prepare('SELECT created_at FROM recurring_rules WHERE user_id = ? AND id = ?').get(user.id, id);

    db.prepare(
      `INSERT INTO recurring_rules (
         user_id, id, type, amount, currency, fx_rate, category_id, wallet_id, to_wallet_id,
         channel, frequency, next_run_date, reference, note, tags_json, active, deleted_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(user_id, id) DO UPDATE SET
         type = excluded.type, amount = excluded.amount, currency = excluded.currency, fx_rate = excluded.fx_rate,
         category_id = excluded.category_id, wallet_id = excluded.wallet_id, to_wallet_id = excluded.to_wallet_id,
         channel = excluded.channel, frequency = excluded.frequency, next_run_date = excluded.next_run_date,
         reference = excluded.reference, note = excluded.note, tags_json = excluded.tags_json,
         active = excluded.active, deleted_at = NULL, updated_at = excluded.updated_at`,
    ).run(
      user.id,
      id,
      type,
      amount,
      currency,
      currency === 'USDT' ? Number(body.fxRate || 34.5) : 1,
      type === 'transfer' ? 'transfer' : String(body.categoryId || 'exp-other'),
      String(body.walletId || 'w-cash-default'),
      type === 'transfer' ? String(body.toWalletId || '') : null,
      String(body.channel || 'CASH'),
      freq,
      nextRun,
      String(body.reference || '').slice(0, 160),
      String(body.note || '').slice(0, 300),
      JSON.stringify(Array.isArray(body.tags) ? body.tags : []),
      body.active === false ? 0 : 1,
      prev?.created_at || now,
      now,
    );
    processDueRecurring(user.id);
    return sendJson(res, 200, { ok: true, id });
  }
  if (recMatch && req.method === 'DELETE') {
    const now = new Date().toISOString();
    db.prepare('UPDATE recurring_rules SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND id = ?').run(now, now, user.id, recMatch[1]);
    return sendJson(res, 200, { ok: true });
  }

  // Phase 3: Trash Restore (never permanently deletes user data)
  if (pathname === '/api/trash/restore' && req.method === 'POST') {
    const body = await readJson(req);
    const { kind, id } = body;
    const tableMap = {
      transaction: 'transactions',
      wallet: 'wallets',
      category: 'categories',
      budget: 'budgets',
      recurring: 'recurring_rules',
    };
    const tbl = tableMap[kind];
    if (!tbl || !id) return sendJson(res, 400, { error: 'ข้อมูลไม่ถูกต้อง' });
    const now = new Date().toISOString();
    db.prepare(`UPDATE ${tbl} SET deleted_at = NULL, updated_at = ? WHERE user_id = ? AND id = ?`).run(now, user.id, String(id));
    if (kind === 'transaction') {
      recordTxHistory(user.id, String(id), 'restore', 'กู้คืนรายการจากถังขยะ', {});
    }
    return sendJson(res, 200, { ok: true });
  }

  // Phase 3: PIN Lock (set, verify, remove)
  if (pathname === '/api/pin/verify' && req.method === 'POST') {
    if (!checkPinRateLimit(user.id)) {
      return sendJson(res, 429, { error: 'ใส่รหัสผิดเกินกำหนด กรุณารอ 5 นาที' });
    }
    const body = await readJson(req);
    const row = db.prepare('SELECT pin_hash FROM users WHERE id = ?').get(user.id);
    if (!row?.pin_hash) return sendJson(res, 200, { ok: true });
    if (!verifyPinHash(body.pin || '', row.pin_hash)) {
      recordPinFailure(user.id);
      return sendJson(res, 401, { error: 'รหัส PIN ไม่ถูกต้อง' });
    }
    clearPinFailures(user.id);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/pin/set' && req.method === 'POST') {
    if (!checkPinRateLimit(user.id)) return sendJson(res, 429, { error: 'กรุณารอสักครู่ก่อนลองใหม่' });
    const body = await readJson(req);
    const newPin = String(body.newPin || '');
    if (!/^\d{4,6}$/.test(newPin)) return sendJson(res, 400, { error: 'รหัส PIN ต้องเป็นตัวเลข 4–6 หลัก' });
    const row = db.prepare('SELECT pin_hash FROM users WHERE id = ?').get(user.id);
    if (row?.pin_hash) {
      if (!verifyPinHash(body.currentPin || '', row.pin_hash)) {
        recordPinFailure(user.id);
        return sendJson(res, 401, { error: 'รหัส PIN ปัจจุบันไม่ถูกต้อง' });
      }
    }
    clearPinFailures(user.id);
    db.prepare('UPDATE users SET pin_hash = ?, updated_at = ? WHERE id = ?').run(hashPin(newPin), new Date().toISOString(), user.id);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/pin/remove' && req.method === 'POST') {
    if (!checkPinRateLimit(user.id)) return sendJson(res, 429, { error: 'กรุณารอสักครู่ก่อนลองใหม่' });
    const body = await readJson(req);
    const row = db.prepare('SELECT pin_hash FROM users WHERE id = ?').get(user.id);
    if (row?.pin_hash && !verifyPinHash(body.currentPin || '', row.pin_hash)) {
      recordPinFailure(user.id);
      return sendJson(res, 401, { error: 'รหัส PIN ปัจจุบันไม่ถูกต้อง' });
    }
    clearPinFailures(user.id);
    db.prepare('UPDATE users SET pin_hash = NULL, updated_at = ? WHERE id = ?').run(new Date().toISOString(), user.id);
    return sendJson(res, 200, { ok: true });
  }

  // Phase 4: Bot notification preferences & test message
  if (pathname === '/api/bot/prefs' && req.method === 'PUT') {
    const body = await readJson(req);
    const row = db.prepare('SELECT bot_prefs_json, telegram_id FROM users WHERE id = ?').get(user.id);
    let cur = { ...DEFAULT_BOT_PREFS };
    try {
      cur = { ...cur, ...JSON.parse(row?.bot_prefs_json || '{}') };
    } catch {
      /* default */
    }
    const next = {
      ...cur,
      ...(typeof body.budgetAlerts === 'boolean' ? { budgetAlerts: body.budgetAlerts } : {}),
      ...(typeof body.recurringAlerts === 'boolean' ? { recurringAlerts: body.recurringAlerts } : {}),
      ...(typeof body.dailySummary === 'boolean' ? { dailySummary: body.dailySummary } : {}),
      ...(body.dailyHour != null ? { dailyHour: Math.min(23, Math.max(0, Number(body.dailyHour))) } : {}),
    };
    // Allow linking owner telegram_id in preview mode if user specifies chatId
    const nextTgId = body.telegramChatId ? String(body.telegramChatId).replace(/[^\d-]/g, '') : row?.telegram_id || null;
    db.prepare('UPDATE users SET bot_prefs_json = ?, telegram_id = COALESCE(?, telegram_id), updated_at = ? WHERE id = ?').run(
      JSON.stringify(next),
      nextTgId || null,
      new Date().toISOString(),
      user.id,
    );
    return sendJson(res, 200, { ok: true, botPrefs: next });
  }

  if (pathname === '/api/bot/test' && req.method === 'POST') {
    if (!process.env.BOT_TOKEN) {
      return sendJson(res, 400, { error: 'ยังไม่ได้ตั้งค่า BOT_TOKEN ใน Environment Variable ของเซิร์ฟเวอร์' });
    }
    const body = await readJson(req);
    const row = db.prepare('SELECT telegram_id FROM users WHERE id = ?').get(user.id);
    const chatId = body.chatId || row?.telegram_id || process.env.OWNER_TELEGRAM_ID;
    if (!chatId) {
      return sendJson(res, 400, { error: 'ไม่พบ Telegram Chat ID (กรุณาเปิดแอปผ่าน Telegram หรือกรอก Chat ID)' });
    }
    const sent = await sendTelegramMessage(chatId, `🔔 <b>ทดสอบการแจ้งเตือนสำเร็จ!</b>\n\n` + buildUserSummaryText(user.id));
    if (!sent.ok) return sendJson(res, 502, { error: `ส่งข้อความไม่สำเร็จ: ${sent.reason}` });
    return sendJson(res, 200, { ok: true });
  }

  // Notifications
  if (pathname === '/api/notifications' && req.method === 'POST') {
    const body = await readJson(req);
    const id = String(body.id || uid()).slice(0, 120);
    const now = new Date().toISOString();
    db.prepare('INSERT OR IGNORE INTO notifications (user_id, id, title, body, is_read, created_at) VALUES (?, ?, ?, ?, 0, ?)').run(
      user.id,
      id,
      String(body.title || '').slice(0, 120),
      String(body.body || '').slice(0, 300),
      now,
    );
    return sendJson(res, 200, { ok: true });
  }
  if (pathname === '/api/notifications/read-all' && req.method === 'POST') {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(user.id);
    return sendJson(res, 200, { ok: true });
  }

  // Settings (hideBalance, yearFormat, fxRates, trackedSources)
  if (pathname === '/api/settings' && req.method === 'PUT') {
    const body = await readJson(req);
    const row = db.prepare('SELECT settings_json, usdt_rate FROM users WHERE id = ?').get(user.id);
    const cur = JSON.parse(row?.settings_json || '{}');
    const next = {
      ...cur,
      ...(typeof body.hideBalance === 'boolean' ? { hideBalance: body.hideBalance } : {}),
      ...(body.yearFormat === 'BE' || body.yearFormat === 'CE' ? { yearFormat: body.yearFormat } : {}),
      ...(body.theme === 'lavender' || body.theme === 'gold' ? { theme: body.theme } : {}),
      ...(body.fxRates && typeof body.fxRates === 'object' ? { fxRates: body.fxRates } : {}),
      ...(Array.isArray(body.trackedSources) ? { trackedSources: body.trackedSources.slice(0, 30) } : {}),
    };
    const nextUsdt = next.fxRates?.USDT > 0 ? Number(next.fxRates.USDT) : Number(row?.usdt_rate || 34.5);
    db.prepare('UPDATE users SET settings_json = ?, usdt_rate = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(next),
      nextUsdt,
      new Date().toISOString(),
      user.id,
    );
    return sendJson(res, 200, { ok: true, settings: next, usdtRate: nextUsdt });
  }

  // Non-destructive merge sync
  if (pathname === '/api/sync' && req.method === 'POST') {
    const body = await readJson(req);
    const now = new Date().toISOString();
    let merged = 0;

    for (const w of body.wallets || []) {
      if (!w?.id) continue;
      const cur = db.prepare('SELECT updated_at FROM wallets WHERE user_id = ? AND id = ?').get(user.id, w.id);
      if (!cur || (w.updatedAt || w.createdAt || '') >= (cur.updated_at || '')) {
        const curCode = w.currency === 'USDT' ? 'USDT' : 'THB';
        db.prepare(
          `INSERT INTO wallets (user_id, id, provider_code, grp, name, last4, initial_balance, currency, sort_order, deleted_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, id) DO UPDATE SET
             provider_code = excluded.provider_code, grp = excluded.grp, name = excluded.name,
             last4 = excluded.last4, initial_balance = excluded.initial_balance, currency = excluded.currency,
             deleted_at = excluded.deleted_at, updated_at = excluded.updated_at`,
        ).run(
          user.id,
          w.id,
          String(w.providerCode || 'CASH'),
          String(w.group || 'cash'),
          String(w.name || 'เงินสด').slice(0, 80),
          sanitizeLast4(w.last4),
          roundAmount(w.initialBalance || 0, curCode),
          curCode,
          w.order ?? 0,
          w.deletedAt || null,
          w.createdAt || now,
          w.updatedAt || now,
        );
        merged++;
      }
    }

    for (const c of body.categories || []) {
      if (!c?.id) continue;
      const cur = db.prepare('SELECT updated_at FROM categories WHERE user_id = ? AND id = ?').get(user.id, c.id);
      if (!cur || (c.updatedAt || '') > (cur.updated_at || '')) {
        db.prepare(
          `INSERT INTO categories (user_id, id, type, name, icon, color, sort_order, is_default, deleted_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, id) DO UPDATE SET
             type = excluded.type, name = excluded.name, icon = excluded.icon,
             color = excluded.color, deleted_at = excluded.deleted_at, updated_at = excluded.updated_at`,
        ).run(
          user.id,
          c.id,
          c.type === 'income' ? 'income' : 'expense',
          String(c.name || '').slice(0, 60),
          String(c.icon || 'ellipsis'),
          String(c.color || '#7A8497'),
          c.order ?? 99,
          c.isDefault ? 1 : 0,
          c.deletedAt || null,
          c.createdAt || now,
          c.updatedAt || now,
        );
        merged++;
      }
    }

    for (const t of body.transactions || []) {
      if (!t?.id) continue;
      const cur = db.prepare('SELECT updated_at FROM transactions WHERE user_id = ? AND id = ?').get(user.id, t.id);
      if (!cur || (t.updatedAt || t.createdAt || '') >= (cur.updated_at || '')) {
        const curCode = t.currency === 'USDT' ? 'USDT' : 'THB';
        const fx = Number(t.fxRate || 1);
        const amt = roundAmount(t.amount, curCode);
        const amtThb = t.amountTHB != null ? roundAmount(t.amountTHB, 'THB') : roundAmount(amt * fx, 'THB');
        db.prepare(
          `INSERT INTO transactions (
             user_id, id, type, amount, currency, fx_rate, amount_thb,
             category_id, wallet_id, to_wallet_id, to_amount, fee,
             channel, tx_date, reference, note, slip_id, tags_json, deleted_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, id) DO UPDATE SET
             type = excluded.type, amount = excluded.amount, currency = excluded.currency,
             fx_rate = excluded.fx_rate, amount_thb = excluded.amount_thb, category_id = excluded.category_id,
             wallet_id = excluded.wallet_id, to_wallet_id = excluded.to_wallet_id, to_amount = excluded.to_amount,
             fee = excluded.fee, channel = excluded.channel, tx_date = excluded.tx_date,
             reference = excluded.reference, note = excluded.note, slip_id = excluded.slip_id,
             tags_json = excluded.tags_json, deleted_at = excluded.deleted_at, updated_at = excluded.updated_at`,
        ).run(
          user.id,
          t.id,
          ['expense', 'income', 'transfer'].includes(t.type) ? t.type : 'expense',
          amt,
          curCode,
          fx,
          amtThb,
          String(t.categoryId || 'exp-other'),
          String(t.walletId || 'w-cash-default'),
          t.toWalletId || null,
          t.toAmount != null ? Number(t.toAmount) : null,
          Number(t.fee || 0),
          String(t.channel || 'CASH'),
          t.date || now,
          String(t.reference || '').slice(0, 160),
          String(t.note || '').slice(0, 500),
          t.slipId || null,
          JSON.stringify(t.tags || []),
          t.deletedAt || null,
          t.createdAt || now,
          t.updatedAt || now,
        );
        merged++;
      }
    }

    for (const b of body.budgets || []) {
      if (!b?.id) continue;
      const cur = db.prepare('SELECT updated_at FROM budgets WHERE user_id = ? AND id = ?').get(user.id, b.id);
      if (!cur || (b.updatedAt || b.createdAt || '') >= (cur.updated_at || '')) {
        db.prepare(
          `INSERT INTO budgets (user_id, id, category_id, amount, period, deleted_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'monthly', ?, ?, ?)
           ON CONFLICT(user_id, id) DO UPDATE SET
             category_id = excluded.category_id, amount = excluded.amount,
             deleted_at = excluded.deleted_at, updated_at = excluded.updated_at`,
        ).run(user.id, b.id, String(b.categoryId), roundAmount(b.amount, 'THB'), b.deletedAt || null, b.createdAt || now, b.updatedAt || now);
        merged++;
      }
    }

    return sendJson(res, 200, { ok: true, merged, ...getUserBootstrap(user.id) });
  }

  // GET /api/export.csv (supports month, from, to, type, walletId, categoryId, tag)
  if (pathname === '/api/export.csv' && req.method === 'GET') {
    const month = url.searchParams.get('month');
    const from = url.searchParams.get('from'); // YYYY-MM-DD
    const to = url.searchParams.get('to'); // YYYY-MM-DD
    const qType = url.searchParams.get('type');
    const qWallet = url.searchParams.get('walletId');
    const qCat = url.searchParams.get('categoryId');
    const qTag = url.searchParams.get('tag');

    const data = getUserBootstrap(user.id);
    const catMap = new Map(data.categories.map((c) => [c.id, c.name]));
    const walMap = new Map(data.wallets.map((w) => [w.id, w.name]));
    const chMap = { BANK: 'โอนธนาคาร', TRUEMONEY: 'TrueMoney', USDT: 'USDT', CASH: 'เงินสด' };
    const typeMap = { income: 'รายรับ', expense: 'รายจ่าย', transfer: 'โอนระหว่างวอลเล็ท' };

    const rows = data.transactions.filter((t) => {
      if (t.deletedAt) return false;
      const ymd = t.date.slice(0, 10);
      if (month && !t.date.startsWith(month)) return false;
      if (from && ymd < from) return false;
      if (to && ymd > to) return false;
      if (qType && qType !== 'all' && t.type !== qType) return false;
      if (qWallet && qWallet !== 'all' && t.walletId !== qWallet && t.toWalletId !== qWallet) return false;
      if (qCat && qCat !== 'all' && t.categoryId !== qCat) return false;
      if (qTag && qTag !== 'all' && !(t.tags || []).includes(qTag)) return false;
      return true;
    });

    const lines = [
      [
        'วันที่',
        'เวลา',
        'ประเภท',
        'หมวดหมู่',
        'ช่องทาง',
        'วอลเล็ทต้นทาง',
        'วอลเล็ทปลายทาง',
        'จำนวนเงิน',
        'สกุลเงิน',
        'เรทแลกเปลี่ยน',
        'มูลค่า (THB)',
        'ค่าธรรมเนียม',
        'แท็ก',
        'อ้างอิง',
        'โน้ต',
        'แนบสลิป',
      ]
        .map(csvCell)
        .join(','),
    ];

    for (const t of rows) {
      const dt = new Date(t.date);
      const dStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      const tStr = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
      lines.push(
        [
          dStr,
          tStr,
          typeMap[t.type] || t.type,
          t.type === 'transfer' ? 'โอนระหว่างวอลเล็ท' : catMap.get(t.categoryId) || '',
          chMap[t.channel] || t.channel,
          walMap.get(t.walletId) || '',
          t.toWalletId ? walMap.get(t.toWalletId) || '' : '',
          t.currency === 'USDT' ? String(t.amount) : t.amount.toFixed(2),
          t.currency,
          t.fxRate,
          t.amountTHB.toFixed(2),
          t.fee ? String(t.fee) : '0',
          (t.tags || []).map((x) => `#${x}`).join(' '),
          t.reference || '',
          t.note || '',
          t.slipId ? 'มี' : 'ไม่มี',
        ]
          .map(csvCell)
          .join(','),
      );
    }

    const csv = '\uFEFF' + lines.join('\r\n');
    const fname = `ce-money-tracker-${month || (from ? `${from}_${to || ''}` : 'all')}.csv`;
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fname}"`,
      'Cache-Control': 'no-store',
    });
    res.end(csv);
    return;
  }

  return sendJson(res, 404, { error: 'API endpoint not found' });
}

function serveStatic(req, res, url) {
  let reqPath = decodeURIComponent(url.pathname);
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.resolve(DIST_DIR, '.' + reqPath);
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_MAP[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': ext === '.html' || ext === '.json' ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  const indexHtml = path.join(DIST_DIR, 'index.html');
  if (fs.existsSync(indexHtml)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    fs.createReadStream(indexHtml).pipe(res);
    return;
  }

  res.writeHead(404);
  res.end('Build not found. Run npm run build first.');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res, url);
    }
  } catch (err) {
    logger.error(`Request failed ${req.method} ${url.pathname}: ${err.message}`);
    if (!res.headersSent) {
      sendJson(res, err.status || 500, { error: err.message || 'เกิดข้อผิดพลาดภายในระบบ' });
    }
  }
});

startBotAndScheduler();

server.listen(PORT, '0.0.0.0', () => {
  logger.info(`CE Money Tracker Pro server listening on http://0.0.0.0:${PORT}`);
});
