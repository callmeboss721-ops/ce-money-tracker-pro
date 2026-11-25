import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_CATEGORIES } from '../src/lib/categories.js';

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
export const SLIPS_DIR = path.join(DATA_DIR, 'slips');
fs.mkdirSync(SLIPS_DIR, { recursive: true });

const dbPath = path.join(DATA_DIR, 'ce-money-tracker.sqlite');
export const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    telegram_id TEXT,
    first_name TEXT,
    last_name TEXT,
    username TEXT,
    photo_url TEXT,
    settings_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS wallets (
    user_id TEXT NOT NULL,
    id TEXT NOT NULL,
    provider_code TEXT NOT NULL,
    grp TEXT NOT NULL,
    name TEXT NOT NULL,
    last4 TEXT,
    initial_balance REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'THB',
    sort_order INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id)
  );

  CREATE TABLE IF NOT EXISTS categories (
    user_id TEXT NOT NULL,
    id TEXT NOT NULL,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    icon TEXT NOT NULL,
    color TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id)
  );

  CREATE TABLE IF NOT EXISTS slips (
    user_id TEXT NOT NULL,
    id TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    rel_path TEXT NOT NULL,
    orig_name TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    user_id TEXT NOT NULL,
    id TEXT NOT NULL,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'THB',
    category_id TEXT NOT NULL,
    wallet_id TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'CASH',
    tx_date TEXT NOT NULL,
    reference TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    slip_id TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]',
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id)
  );

  CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions (user_id, tx_date DESC);

  CREATE TABLE IF NOT EXISTS budgets (
    user_id TEXT NOT NULL,
    id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    amount REAL NOT NULL,
    period TEXT NOT NULL DEFAULT 'monthly',
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    user_id TEXT NOT NULL,
    id TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id)
  );

  CREATE TABLE IF NOT EXISTS recurring_rules (
    user_id TEXT NOT NULL,
    id TEXT NOT NULL,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'THB',
    fx_rate REAL NOT NULL DEFAULT 1,
    category_id TEXT NOT NULL DEFAULT '',
    wallet_id TEXT NOT NULL,
    to_wallet_id TEXT,
    channel TEXT NOT NULL DEFAULT 'CASH',
    frequency TEXT NOT NULL DEFAULT 'monthly',
    next_run_date TEXT NOT NULL,
    reference TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    tags_json TEXT NOT NULL DEFAULT '[]',
    active INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id)
  );

  CREATE TABLE IF NOT EXISTS tx_history (
    user_id TEXT NOT NULL,
    id TEXT NOT NULL,
    tx_id TEXT NOT NULL,
    action TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    snapshot_json TEXT NOT NULL,
    changed_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id)
  );

  CREATE INDEX IF NOT EXISTS idx_hist_user_tx ON tx_history (user_id, tx_id, changed_at DESC);
`);

// Additive-only column migrations (never drops or alters existing user data)
function addColumnIfMissing(table, col, colDef) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${colDef}`);
  }
}

addColumnIfMissing('users', 'pin_hash', 'TEXT');
addColumnIfMissing('users', 'usdt_rate', 'REAL NOT NULL DEFAULT 34.5');
addColumnIfMissing('users', 'bot_prefs_json', "TEXT NOT NULL DEFAULT '{}'");

addColumnIfMissing('transactions', 'fx_rate', 'REAL NOT NULL DEFAULT 1');
addColumnIfMissing('transactions', 'amount_thb', 'REAL');
addColumnIfMissing('transactions', 'to_wallet_id', 'TEXT');
addColumnIfMissing('transactions', 'to_amount', 'REAL');
addColumnIfMissing('transactions', 'fee', 'REAL NOT NULL DEFAULT 0');

// Backfill amount_thb on legacy rows where NULL
db.exec(`UPDATE transactions SET amount_thb = ROUND(amount * COALESCE(fx_rate, 1), 2) WHERE amount_thb IS NULL`);

export function roundAmount(n, currency = 'THB') {
  const factor = currency === 'USDT' ? 10000 : 100;
  return Math.round((Number(n || 0) + Number.EPSILON) * factor) / factor;
}

export function sanitizeLast4(val) {
  if (!val) return null;
  const digits = String(val).replace(/\D/g, '').slice(-4);
  return digits.length === 4 ? digits : null;
}

export function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPinHash(pin, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hex] = stored.split(':');
  const derived = crypto.scryptSync(String(pin), salt, 32);
  const target = Buffer.from(hex, 'hex');
  return derived.length === target.length && crypto.timingSafeEqual(derived, target);
}

export function recordTxHistory(userId, txId, action, summary, snapshotObj) {
  db.prepare(
    `INSERT INTO tx_history (user_id, id, tx_id, action, summary, snapshot_json, changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    userId,
    crypto.randomUUID(),
    txId,
    action,
    String(summary || '').slice(0, 200),
    JSON.stringify(snapshotObj || {}),
    new Date().toISOString(),
  );
}

function advanceDateStr(ymd, freq) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (freq === 'daily') dt.setDate(dt.getDate() + 1);
  else if (freq === 'weekly') dt.setDate(dt.getDate() + 7);
  else if (freq === 'yearly') dt.setFullYear(dt.getFullYear() + 1);
  else dt.setMonth(dt.getMonth() + 1); // monthly
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Auto-generate due recurring transactions for a user (safe & idempotent). */
export function processDueRecurring(userId) {
  const today = todayYmd();
  const dueRules = db
    .prepare(
      `SELECT * FROM recurring_rules
       WHERE user_id = ? AND active = 1 AND deleted_at IS NULL AND next_run_date <= ?`,
    )
    .all(userId, today);

  const created = [];
  for (const rule of dueRules) {
    let runDate = rule.next_run_date;
    let safety = 0;
    while (runDate <= today && safety < 24) {
      safety++;
      const txId = crypto.randomUUID();
      const now = new Date().toISOString();
      const txIso = new Date(`${runDate}T09:00:00`).toISOString();
      const amountThb = roundAmount(rule.amount * (rule.fx_rate || 1), 'THB');

      db.prepare(
        `INSERT INTO transactions (
           user_id, id, type, amount, currency, fx_rate, amount_thb,
           category_id, wallet_id, to_wallet_id, to_amount, fee,
           channel, tx_date, reference, note, slip_id, tags_json, deleted_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)`,
      ).run(
        userId,
        txId,
        rule.type,
        rule.amount,
        rule.currency,
        rule.fx_rate || 1,
        amountThb,
        rule.category_id || 'exp-other',
        rule.wallet_id,
        rule.to_wallet_id || null,
        rule.type === 'transfer' ? rule.amount : null,
        rule.channel || 'CASH',
        txIso,
        rule.reference || '',
        rule.note ? `[รายการประจำ] ${rule.note}` : '[รายการประจำ]',
        rule.tags_json || '[]',
        now,
        now,
      );

      recordTxHistory(userId, txId, 'create', `สร้างอัตโนมัติจากรายการประจำ (${runDate})`, {
        type: rule.type,
        amount: rule.amount,
        currency: rule.currency,
        date: txIso,
        note: rule.note,
      });

      const notifId = `rec-${rule.id}-${runDate}`;
      db.prepare(
        `INSERT OR IGNORE INTO notifications (user_id, id, title, body, is_read, created_at)
         VALUES (?, ?, ?, ?, 0, ?)`,
      ).run(
        userId,
        notifId,
        'บันทึกรายการประจำอัตโนมัติ',
        `${rule.note || 'รายการประจำ'} จำนวน ${rule.amount} ${rule.currency} (${runDate})`,
        now,
      );

      created.push({ txId, rule, runDate });
      runDate = advanceDateStr(runDate, rule.frequency);
    }

    db.prepare('UPDATE recurring_rules SET next_run_date = ?, updated_at = ? WHERE user_id = ? AND id = ?').run(
      runDate,
      new Date().toISOString(),
      userId,
      rule.id,
    );
  }
  return created;
}

export function ensureUserSeeded(user) {
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(user.id);
  if (!existing) {
    db.prepare(
      `INSERT INTO users (id, telegram_id, first_name, last_name, username, photo_url, settings_json, usdt_rate, bot_prefs_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 34.5, ?, ?, ?)`,
    ).run(
      user.id,
      user.telegramId,
      user.firstName,
      user.lastName,
      user.username,
      user.photoUrl,
      JSON.stringify({ hideBalance: false, yearFormat: 'BE', theme: 'lavender' }),
      JSON.stringify({ budgetAlerts: true, recurringAlerts: true, dailySummary: false, dailyHour: 20 }),
      now,
      now,
    );
  } else {
    db.prepare(
      `UPDATE users SET telegram_id = COALESCE(?, telegram_id), first_name = ?, last_name = ?, username = ?, photo_url = ?, updated_at = ?
       WHERE id = ?`,
    ).run(user.telegramId, user.firstName, user.lastName, user.username, user.photoUrl, now, user.id);
  }

  const haveCats = new Set(
    db.prepare('SELECT id FROM categories WHERE user_id = ?').all(user.id).map((r) => r.id),
  );
  const insertCat = db.prepare(
    `INSERT INTO categories (user_id, id, type, name, icon, color, sort_order, is_default, deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)`,
  );
  for (const c of DEFAULT_CATEGORIES) {
    if (!haveCats.has(c.id)) {
      insertCat.run(user.id, c.id, c.type, c.name, c.icon, c.color, c.order ?? 0, now, now);
    }
  }

  const walletCount = db.prepare('SELECT COUNT(*) AS cnt FROM wallets WHERE user_id = ?').get(user.id).cnt;
  if (walletCount === 0) {
    const insertWallet = db.prepare(
      `INSERT INTO wallets (user_id, id, provider_code, grp, name, last4, initial_balance, currency, sort_order, deleted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, 0, ?, ?, NULL, ?, ?)`,
    );
    insertWallet.run(user.id, 'w-cash-default', 'CASH', 'cash', 'เงินสด', 'THB', 0, now, now);
    insertWallet.run(user.id, 'w-bank-default', 'KBANK', 'bank', 'บัญชีธนาคาร', 'THB', 1, now, now);
    insertWallet.run(user.id, 'w-truemoney-default', 'TRUEMONEY', 'ewallet', 'TrueMoney', 'THB', 2, now, now);
    insertWallet.run(user.id, 'w-usdt-default', 'USDT', 'crypto', 'USDT Wallet', 'USDT', 3, now, now);
  }
}

export const DEFAULT_BOT_PREFS = {
  budgetAlerts: true,
  recurringAlerts: true,
  dailySummary: false,
  dailyHour: 20,
  lastDailyDate: '',
};

export function getUserBootstrap(userId) {
  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const usdtRate = Number(userRow?.usdt_rate || 34.5);

  const wallets = db
    .prepare('SELECT * FROM wallets WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(userId)
    .map((r) => ({
      id: r.id,
      providerCode: r.provider_code,
      group: r.grp,
      name: r.name,
      last4: r.last4,
      initialBalance: r.initial_balance,
      currency: r.currency || 'THB',
      order: r.sort_order,
      deletedAt: r.deleted_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

  const categories = db
    .prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(userId)
    .map((r) => ({
      id: r.id,
      type: r.type,
      name: r.name,
      icon: r.icon,
      color: r.color,
      order: r.sort_order,
      isDefault: Boolean(r.is_default),
      deletedAt: r.deleted_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

  const transactions = db
    .prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY tx_date DESC, created_at DESC')
    .all(userId)
    .map((r) => {
      const cur = r.currency || 'THB';
      const fx = cur === 'THB' ? 1 : Number(r.fx_rate ?? 0);
      const amtThb =
        cur === 'THB'
          ? Number(r.amount)
          : r.amount_thb != null
            ? Number(r.amount_thb)
            : fx > 0
              ? roundAmount(r.amount * fx, 'THB')
              : null;
      return {
        id: r.id,
        type: r.type,
        amount: r.amount,
        currency: cur,
        fxRate: fx,
        amountTHB: amtThb,
        categoryId: r.category_id,
        walletId: r.wallet_id,
        toWalletId: r.to_wallet_id || null,
        toAmount: r.to_amount != null ? Number(r.to_amount) : null,
        fee: Number(r.fee || 0),
        channel: r.channel || 'CASH',
        date: r.tx_date,
        reference: r.reference || '',
        note: r.note || '',
        slipId: r.slip_id || null,
        tags: JSON.parse(r.tags_json || '[]'),
        deletedAt: r.deleted_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });

  const budgets = db
    .prepare('SELECT * FROM budgets WHERE user_id = ?')
    .all(userId)
    .map((r) => ({
      id: r.id,
      categoryId: r.category_id,
      amount: r.amount,
      period: r.period,
      deletedAt: r.deleted_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

  const recurring = db
    .prepare('SELECT * FROM recurring_rules WHERE user_id = ? ORDER BY next_run_date ASC, created_at DESC')
    .all(userId)
    .map((r) => ({
      id: r.id,
      type: r.type,
      amount: r.amount,
      currency: r.currency || 'THB',
      fxRate: Number(r.fx_rate || 1),
      categoryId: r.category_id,
      walletId: r.wallet_id,
      toWalletId: r.to_wallet_id || null,
      channel: r.channel || 'CASH',
      frequency: r.frequency || 'monthly',
      nextRunDate: r.next_run_date,
      reference: r.reference || '',
      note: r.note || '',
      tags: JSON.parse(r.tags_json || '[]'),
      active: Boolean(r.active),
      deletedAt: r.deleted_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

  const notifications = db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100')
    .all(userId)
    .map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      read: Boolean(r.is_read),
      createdAt: r.created_at,
    }));

  const history = db
    .prepare('SELECT * FROM tx_history WHERE user_id = ? ORDER BY changed_at DESC LIMIT 150')
    .all(userId)
    .map((r) => ({
      id: r.id,
      txId: r.tx_id,
      action: r.action,
      summary: r.summary,
      snapshot: JSON.parse(r.snapshot_json || '{}'),
      changedAt: r.changed_at,
    }));

  let settings = { hideBalance: false, yearFormat: 'BE', theme: 'lavender' };
  try {
    settings = { ...settings, ...JSON.parse(userRow?.settings_json || '{}') };
  } catch {
    /* default */
  }

  let botPrefs = { ...DEFAULT_BOT_PREFS };
  try {
    botPrefs = { ...botPrefs, ...JSON.parse(userRow?.bot_prefs_json || '{}') };
  } catch {
    /* default */
  }

  return {
    wallets,
    categories,
    transactions,
    budgets,
    recurring,
    notifications,
    history,
    settings,
    usdtRate,
    hasPin: Boolean(userRow?.pin_hash),
    botPrefs,
    botConfigured: Boolean(process.env.BOT_TOKEN),
  };
}
