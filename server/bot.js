import crypto from 'node:crypto';
import { db, ensureUserSeeded, getUserBootstrap, processDueRecurring, recordTxHistory, roundAmount, DEFAULT_BOT_PREFS } from './db.js';
import { parseBankNotification } from '../src/lib/bankParser.js';
import { logger } from './logger.js';

/**
 * Phase 4: Telegram Notification & Quick-Entry Bot
 * Strictly reads BOT_TOKEN from process.env ONLY (never hardcoded).
 */
function telegramApiBase() {
  const token = process.env.BOT_TOKEN;
  if (!token) return null;
  const root = process.env.TELEGRAM_API_ROOT || 'https://api.telegram.org';
  return `${root.replace(/\/$/, '')}/bot${token}`;
}

export async function sendTelegramMessage(chatId, text, extra = {}) {
  const base = telegramApiBase();
  if (!base || !chatId) return { ok: false, reason: 'BOT_TOKEN or chatId not configured' };

  try {
    const res = await fetch(`${base}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...extra,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      logger.warn(`Telegram sendMessage failed: ${data.description || res.status}`);
      return { ok: false, reason: data.description || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    logger.warn(`Telegram sendMessage error: ${err.message}`);
    return { ok: false, reason: err.message };
  }
}

function fmtMoney(n) {
  return '฿ ' + new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(Number(n) || 0));
}

export function buildUserSummaryText(userId) {
  const boot = getUserBootstrap(userId);
  const activeWallets = boot.wallets.filter((w) => !w.deletedAt);
  const activeTx = boot.transactions.filter((t) => !t.deletedAt);
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Wallet total in THB
  let totalThb = 0;
  for (const w of activeWallets) {
    let bal = Number(w.initialBalance || 0);
    for (const t of activeTx) {
      if (t.type === 'transfer') {
        if (t.walletId === w.id) bal -= t.amount + (t.fee || 0);
        if (t.toWalletId === w.id) bal += t.toAmount ?? t.amount;
      } else if (t.walletId === w.id) {
        bal += t.type === 'income' ? t.amount : -t.amount;
      }
    }
    totalThb += w.currency === 'USDT' ? bal * (boot.usdtRate || 34.5) : bal;
  }

  let monthInc = 0;
  let monthExp = 0;
  for (const t of activeTx) {
    if (!t.date.startsWith(ym)) continue;
    if (t.type === 'income') monthInc += t.amountTHB;
    else if (t.type === 'expense') monthExp += t.amountTHB;
  }

  return (
    `<b>📊 สรุปการเงิน CE Money Tracker Pro</b>\n` +
    `ยอดรวมทุกวอลเล็ท: <b>${totalThb < 0 ? '-' : ''}${fmtMoney(totalThb)}</b>\n` +
    `รายรับเดือนนี้: <b>+ ${fmtMoney(monthInc)}</b>\n` +
    `รายจ่ายเดือนนี้: <b>- ${fmtMoney(monthExp)}</b>\n` +
    `คงเหลือสุทธิเดือนนี้: <b>${monthInc - monthExp < 0 ? '-' : '+ '}${fmtMoney(monthInc - monthExp)}</b>`
  );
}

/** Notify user via Telegram when a budget crosses 70% or 100% (if enabled). */
export async function maybeSendBudgetTelegramAlert(userId, categoryName, spent, budgetAmount, level) {
  const row = db.prepare('SELECT telegram_id, bot_prefs_json FROM users WHERE id = ?').get(userId);
  if (!row?.telegram_id) return;
  let prefs = { ...DEFAULT_BOT_PREFS };
  try {
    prefs = { ...prefs, ...JSON.parse(row.bot_prefs_json || '{}') };
  } catch {
    /* default */
  }
  if (!prefs.budgetAlerts) return;

  const pct = budgetAmount > 0 ? Math.round((spent / budgetAmount) * 100) : 0;
  const header = level === 'over' ? '🚨 <b>เกินงบประมาณแล้ว!</b>' : '⚠️ <b>ใกล้ถึงลิมิตงบประมาณ</b>';
  const msg =
    `${header}\n` +
    `หมวดหมู่: <b>${categoryName}</b>\n` +
    `ใช้ไปแล้ว: <b>${fmtMoney(spent)}</b> (${pct}%)\n` +
    `งบที่ตั้งไว้: ${fmtMoney(budgetAmount)}`;

  await sendTelegramMessage(row.telegram_id, msg);
}

/** Handle incoming Telegram update (from webhook or polling). */
export async function handleTelegramUpdate(update) {
  const msg = update?.message;
  if (!msg?.text || !msg?.from?.id) return;

  if (process.env.OWNER_TELEGRAM_ID && String(msg.from.id) !== String(process.env.OWNER_TELEGRAM_ID)) {
    await sendTelegramMessage(msg.chat.id, '⛔ บอทนี้จำกัดสิทธิ์เฉพาะเจ้าของบัญชีเท่านั้น');
    return;
  }

  const user = {
    id: `tg_${msg.from.id}`,
    telegramId: String(msg.from.id),
    firstName: msg.from.first_name || '',
    lastName: msg.from.last_name || '',
    username: msg.from.username || '',
    photoUrl: '',
  };
  ensureUserSeeded(user);

  const text = msg.text.trim();

  if (text.startsWith('/start') || text.startsWith('/help')) {
    const appUrl = process.env.PUBLIC_APP_URL;
    const replyMarkup = appUrl
      ? { inline_keyboard: [[{ text: '💰 เปิด CE Money Tracker Pro', web_app: { url: appUrl } }]] }
      : undefined;

    await sendTelegramMessage(
      msg.chat.id,
      `<b>ยินดีต้อนรับสู่ CE Money Tracker Pro</b> ✨\n\n` +
        `คำสั่งด่วนผ่านแชท:\n` +
        `• <code>/summary</code> — ดูยอดคงเหลือและสรุปเดือนนี้\n` +
        `• <code>/out 120 ข้าวเที่ยง</code> — บันทึกรายจ่ายด่วน\n` +
        `• <code>/in 5000 ขายสินค้า</code> — บันทึกรายรับด่วน`,
      replyMarkup ? { reply_markup: replyMarkup } : {},
    );
    return;
  }

  if (text.startsWith('/summary')) {
    await sendTelegramMessage(msg.chat.id, buildUserSummaryText(user.id));
    return;
  }

  const quickMatch = text.match(/^\/(in|out|รับ|จ่าย)\s+([\d,.]+)(?:\s+(.+))?$/i);
  if (quickMatch) {
    const cmd = quickMatch[1].toLowerCase();
    const isIncome = cmd === 'in' || cmd === 'รับ';
    const amt = roundAmount(parseFloat(quickMatch[2].replace(/,/g, '')), 'THB');
    const note = (quickMatch[3] || '').trim();
    if (!(amt > 0)) {
      await sendTelegramMessage(msg.chat.id, 'กรุณาระบุจำนวนเงินที่มากกว่า 0 เช่น <code>/out 150 กาแฟ</code>');
      return;
    }

    const txId = crypto.randomUUID();
    const now = new Date().toISOString();
    const catId = isIncome ? 'inc-other' : 'exp-other';
    const walletRow =
      db.prepare("SELECT id FROM wallets WHERE user_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC LIMIT 1").get(user.id) ||
      { id: 'w-cash-default' };

    db.prepare(
      `INSERT INTO transactions (
         user_id, id, type, amount, currency, fx_rate, amount_thb,
         category_id, wallet_id, channel, tx_date, reference, note, tags_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'THB', 1, ?, ?, ?, 'CASH', ?, '', ?, '[]', ?, ?)`,
    ).run(user.id, txId, isIncome ? 'income' : 'expense', amt, amt, catId, walletRow.id, now, note, now, now);

    recordTxHistory(user.id, txId, 'create', 'บันทึกด่วนผ่าน Telegram Bot', {
      type: isIncome ? 'income' : 'expense',
      amount: amt,
      note,
    });

    await sendTelegramMessage(
      msg.chat.id,
      `✅ บันทึก${isIncome ? 'รายรับ' : 'รายจ่าย'} <b>${fmtMoney(amt)}</b> ${note ? `(${note}) ` : ''}เรียบร้อยแล้ว\n\n` +
        buildUserSummaryText(user.id),
    );
    return;
  }

  // Auto-parse forwarded/pasted Thai bank & LINE notifications (K PLUS, MAKE, KTC, SCB Connect, BBL, KTB, Krungsri, TTB, TrueMoney)
  const parsed = parseBankNotification(text);
  if (parsed) {
    const userRow = db.prepare('SELECT settings_json, usdt_rate FROM users WHERE id = ?').get(user.id);
    const settings = JSON.parse(userRow?.settings_json || '{}');
    const fxRates = { USDT: Number(userRow?.usdt_rate || 34.5), ...(settings.fxRates || {}) };
    const rate = parsed.currency === 'THB' ? 1 : Number(fxRates[parsed.currency] || 0);
    const amtThb = parsed.currency === 'THB' ? parsed.amount : rate > 0 ? roundAmount(parsed.amount * rate, 'THB') : null;

    const walletRow =
      db.prepare('SELECT id FROM wallets WHERE user_id = ? AND provider_code = ? AND deleted_at IS NULL LIMIT 1').get(user.id, parsed.providerCode) ||
      db.prepare('SELECT id FROM wallets WHERE user_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC LIMIT 1').get(user.id) ||
      { id: 'w-cash-default' };

    const txId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO transactions (
         user_id, id, type, amount, currency, fx_rate, amount_thb,
         category_id, wallet_id, channel, tx_date, reference, note, tags_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'BANK', ?, '', ?, '[]', ?, ?)`,
    ).run(
      user.id,
      txId,
      parsed.type,
      parsed.amount,
      parsed.currency,
      rate,
      amtThb,
      parsed.categoryId,
      walletRow.id,
      now,
      parsed.note,
      now,
      now,
    );

    recordTxHistory(user.id, txId, 'create', `บันทึกอัตโนมัติจากข้อความแจ้งเตือน (${parsed.providerCode})`, parsed);
    await sendTelegramMessage(
      msg.chat.id,
      `🤖 <b>ตรวจพบแจ้งเตือน ${parsed.providerCode} — บันทึกอัตโนมัติสำเร็จ!</b>\n` +
        `ประเภท: ${parsed.type === 'income' ? 'รายรับ' : 'รายจ่าย'}\n` +
        `ยอดเงิน: <b>${parsed.amount} ${parsed.currency}</b>${amtThb == null ? ' <i>(ยังไม่ได้ตั้งเรท — ไม่นับรวมในยอดบาท)</i>' : ''}\n` +
        `รายการ: ${parsed.note}`,
    );
  }
}

let schedulerStarted = false;

/** Start background scheduler for recurring rules & daily Telegram digest + optional polling. */
export function startBotAndScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  // Run recurring & daily summary check every 60 seconds
  const tick = async () => {
    try {
      const users = db.prepare('SELECT id, telegram_id, bot_prefs_json FROM users').all();
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const curHour = now.getHours();

      for (const u of users) {
        const created = processDueRecurring(u.id);
        let prefs = { ...DEFAULT_BOT_PREFS };
        try {
          prefs = { ...prefs, ...JSON.parse(u.bot_prefs_json || '{}') };
        } catch {
          /* ignore */
        }

        if (created.length > 0 && u.telegram_id && prefs.recurringAlerts && process.env.BOT_TOKEN) {
          for (const item of created) {
            await sendTelegramMessage(
              u.telegram_id,
              `🔁 <b>บันทึกรายการประจำอัตโนมัติ</b>\n${item.rule.note || 'รายการประจำ'}: <b>${item.rule.amount} ${item.rule.currency}</b> (${item.runDate})`,
            );
          }
        }

        if (
          process.env.BOT_TOKEN &&
          u.telegram_id &&
          prefs.dailySummary &&
          curHour === Number(prefs.dailyHour ?? 20) &&
          prefs.lastDailyDate !== today
        ) {
          const sent = await sendTelegramMessage(u.telegram_id, `🌙 <b>สรุปรายวันประจำวันที่ ${today}</b>\n\n` + buildUserSummaryText(u.id));
          if (sent.ok) {
            prefs.lastDailyDate = today;
            db.prepare('UPDATE users SET bot_prefs_json = ? WHERE id = ?').run(JSON.stringify(prefs), u.id);
          }
        }
      }
    } catch (err) {
      logger.warn(`Scheduler tick warning: ${err.message}`);
    }
  };

  setInterval(tick, 60 * 1000).unref();

  if (!process.env.BOT_TOKEN) {
    logger.info('Telegram Bot idle: set BOT_TOKEN env variable to enable Telegram alerts & commands');
    return;
  }

  if (process.env.BOT_POLLING === 'true') {
    let offset = 0;
    const poll = async () => {
      const base = telegramApiBase();
      if (!base) return;
      try {
        const res = await fetch(`${base}/getUpdates?timeout=20&offset=${offset}`);
        const data = await res.json().catch(() => ({}));
        if (data?.ok && Array.isArray(data.result)) {
          for (const upd of data.result) {
            offset = upd.update_id + 1;
            await handleTelegramUpdate(upd);
          }
        }
      } catch {
        /* retry next cycle */
      }
      setTimeout(poll, 3000).unref();
    };
    poll();
    logger.info('Telegram Bot polling active');
  } else {
    logger.info('Telegram Bot configured (ready for outbound notifications & /api/telegram/webhook)');
  }
}
