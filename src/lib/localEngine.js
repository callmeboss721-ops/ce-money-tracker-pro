import { DEFAULT_CATEGORIES } from './categories';
import { round2, round4 } from './format';

/**
 * Crash-proof local persistence engine (IndexedDB / localStorage / Memory fallback).
 * Enables 100% full functionality in standalone .html artifacts, offline PWAs,
 * and sandboxed mobile WebViews without requiring localhost server connectivity.
 */
const BASE_STORAGE_KEY = 'ce_money_tracker_standalone_v4';
let memoryState = null;

function getTelegramWebUser() {
  try {
    return window.Telegram?.WebApp?.initDataUnsafe?.user || null;
  } catch {
    return null;
  }
}

function getStorageKey() {
  const tgUser = getTelegramWebUser();
  if (tgUser?.id) return `ce_money_tracker_tg_${tgUser.id}_v4`;
  return BASE_STORAGE_KEY;
}

export function safeSessionGet(key) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSessionSet(key, val) {
  try {
    if (val === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, val);
  } catch {
    /* sandboxed iframe ignore */
  }
}

function makeUid() {
  try {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  } catch {
    /* ignore */
  }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function defaultState() {
  const now = new Date().toISOString();
  const tgUser = getTelegramWebUser();
  return {
    user: tgUser?.id
      ? {
          id: `tg_${tgUser.id}`,
          telegramId: String(tgUser.id),
          firstName: tgUser.first_name || 'Telegram User',
          lastName: tgUser.last_name || '',
          username: tgUser.username || '',
          photoUrl: tgUser.photo_url || '',
          authMode: 'telegram_local',
        }
      : {
          id: 'local_owner',
          telegramId: null,
          firstName: 'บัญชีส่วนตัว',
          lastName: '',
          username: '',
          photoUrl: '',
          authMode: 'local',
        },
    settings: { hideBalance: false, yearFormat: 'BE', theme: 'lavender', fxRates: { USDT: 34.5 } },
    usdtRate: 34.5,
    pinHash: null,
    botPrefs: { budgetAlerts: true, recurringAlerts: true, dailySummary: false, dailyHour: 20 },
    wallets: [
      { id: 'w-cash-default', providerCode: 'CASH', group: 'cash', name: 'เงินสด', last4: null, initialBalance: 0, currency: 'THB', order: 0, deletedAt: null, createdAt: now, updatedAt: now },
      { id: 'w-bank-default', providerCode: 'KBANK', group: 'bank', name: 'K PLUS', last4: null, initialBalance: 0, currency: 'THB', order: 1, deletedAt: null, createdAt: now, updatedAt: now },
      { id: 'w-truemoney-default', providerCode: 'TRUEMONEY', group: 'ewallet', name: 'TrueMoney', last4: null, initialBalance: 0, currency: 'THB', order: 2, deletedAt: null, createdAt: now, updatedAt: now },
      { id: 'w-usdt-default', providerCode: 'USDT', group: 'crypto', name: 'USDT Wallet', last4: null, initialBalance: 0, currency: 'USDT', order: 3, deletedAt: null, createdAt: now, updatedAt: now },
    ],
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c, createdAt: now, updatedAt: now })),
    transactions: [],
    budgets: [],
    recurring: [],
    notifications: [],
    history: [],
    slips: {}, // slipId -> dataUrl
  };
}

function loadState() {
  if (memoryState) return memoryState;
  try {
    const raw = window.localStorage.getItem(getStorageKey());
    if (raw) {
      const parsed = JSON.parse(raw);
      const base = defaultState();
      // Additive category merge
      const haveCat = new Set((parsed.categories || []).map((c) => c.id));
      const mergedCats = [...(parsed.categories || [])];
      for (const dc of base.categories) if (!haveCat.has(dc.id)) mergedCats.push(dc);
      memoryState = {
        ...base,
        ...parsed,
        user: getTelegramWebUser()?.id ? base.user : parsed.user || base.user,
        categories: mergedCats,
        settings: { ...base.settings, ...(parsed.settings || {}) },
      };
      return memoryState;
    }
  } catch {
    /* sandboxed iframe — use memoryState */
  }
  memoryState = defaultState();
  saveState(memoryState);
  return memoryState;
}

function saveState(st) {
  memoryState = st;
  try {
    window.localStorage.setItem(getStorageKey(), JSON.stringify(st));
  } catch {
    /* quota or sandboxed iframe — keep in memoryState */
  }
}

function simplePinHash(pin) {
  let h = 2166136261;
  const s = `ce-salt-v4:${pin}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 'fnv:' + (h >>> 0).toString(16);
}

function fileToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error('อ่านไฟล์รูปไม่สำเร็จ'));
    fr.readAsDataURL(blob);
  });
}

function advanceDateStr(ymd, freq) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (freq === 'daily') dt.setDate(dt.getDate() + 1);
  else if (freq === 'weekly') dt.setDate(dt.getDate() + 7);
  else if (freq === 'yearly') dt.setFullYear(dt.getFullYear() + 1);
  else dt.setMonth(dt.getMonth() + 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function runDueRecurringLocal(st) {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  let changed = false;

  for (const r of st.recurring) {
    if (!r.active || r.deletedAt || r.nextRunDate > today) continue;
    let runDate = r.nextRunDate;
    let safety = 0;
    while (runDate <= today && safety < 24) {
      safety++;
      const txId = makeUid();
      const now = new Date().toISOString();
      const txIso = new Date(`${runDate}T09:00:00`).toISOString();
      const fx = r.currency === 'THB' ? 1 : Number(r.fxRate || st.usdtRate || 34.5);
      const amtThb = r.currency === 'THB' ? round2(r.amount) : fx > 0 ? round2(r.amount * fx) : null;
      st.transactions.unshift({
        id: txId,
        type: r.type,
        amount: r.amount,
        currency: r.currency || 'THB',
        fxRate: fx,
        amountTHB: amtThb,
        categoryId: r.categoryId || 'exp-other',
        walletId: r.walletId,
        toWalletId: r.toWalletId || null,
        toAmount: r.type === 'transfer' ? r.amount : null,
        fee: 0,
        channel: r.channel || 'CASH',
        date: txIso,
        reference: r.reference || '',
        note: r.note ? `[รายการประจำ] ${r.note}` : '[รายการประจำ]',
        slipId: null,
        tags: r.tags || [],
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      st.history.unshift({
        id: makeUid(),
        txId,
        action: 'create',
        summary: `สร้างอัตโนมัติจากรายการประจำ (${runDate})`,
        snapshot: { amount: r.amount, currency: r.currency },
        changedAt: now,
      });
      runDate = advanceDateStr(runDate, r.frequency);
      changed = true;
    }
    r.nextRunDate = runDate;
  }
  if (changed) saveState(st);
}

export const localEngine = {
  bootstrap() {
    const st = loadState();
    runDueRecurringLocal(st);
    return {
      user: st.user,
      wallets: [...st.wallets],
      categories: [...st.categories],
      transactions: [...st.transactions],
      budgets: [...st.budgets],
      recurring: [...st.recurring],
      notifications: [...st.notifications],
      history: [...st.history],
      settings: { ...st.settings },
      usdtRate: st.usdtRate,
      hasPin: Boolean(st.pinHash),
      botPrefs: { ...st.botPrefs },
      botConfigured: false,
    };
  },

  async saveTransaction(draft, slip) {
    const st = loadState();
    const now = new Date().toISOString();
    const idx = draft.id ? st.transactions.findIndex((t) => t.id === draft.id) : -1;
    const prev = idx >= 0 ? st.transactions[idx] : null;

    let slipId = prev?.slipId ?? null;
    if (slip instanceof Blob) {
      slipId = makeUid();
      st.slips[slipId] = await fileToDataUrl(slip);
    } else if (slip === null) {
      slipId = null;
    }

    const cur = String(draft.currency || 'THB').toUpperCase();
    const amount = cur === 'USDT' ? round4(draft.amount) : round2(draft.amount);
    const fx = cur === 'THB' ? 1 : Number(draft.fxRate ?? 0);
    const amountTHB = cur === 'THB' ? round2(amount) : fx > 0 ? round2(amount * fx) : null;

    let toAmount = null;
    if (draft.type === 'transfer') {
      const destW = st.wallets.find((w) => w.id === draft.toWalletId);
      const destCur = destW?.currency || 'THB';
      if (draft.toAmount != null && Number(draft.toAmount) > 0) toAmount = Number(draft.toAmount);
      else if (cur === destCur) toAmount = amount;
      else if (fx > 0) toAmount = cur !== 'THB' && destCur === 'THB' ? round2(amount * fx) : round4(amount / fx);
      else toAmount = amount;
    }

    const rec = {
      ...prev,
      ...draft,
      id: prev?.id || draft.id || makeUid(),
      amount,
      currency: cur,
      fxRate: fx,
      amountTHB,
      categoryId: draft.type === 'transfer' ? 'transfer' : draft.categoryId,
      toWalletId: draft.type === 'transfer' ? draft.toWalletId : null,
      toAmount,
      fee: draft.type === 'transfer' ? Number(draft.fee || 0) : 0,
      slipId,
      tags: Array.isArray(draft.tags) ? draft.tags : [],
      deletedAt: null,
      createdAt: prev?.createdAt || now,
      updatedAt: now,
    };

    if (idx >= 0) st.transactions[idx] = rec;
    else st.transactions.unshift(rec);

    st.history.unshift({
      id: makeUid(),
      txId: rec.id,
      action: prev ? 'update' : 'create',
      summary: `${prev ? 'แก้ไขยอดเป็น' : 'สร้างรายการ'} ${rec.amount} ${rec.currency}${rec.note ? ` (${rec.note})` : ''}`,
      snapshot: { amount: rec.amount, currency: rec.currency, note: rec.note },
      changedAt: now,
    });

    // Budget alert check
    if (rec.type === 'expense' && amountTHB > 0) {
      const b = st.budgets.find((x) => x.categoryId === rec.categoryId && !x.deletedAt);
      if (b && b.amount > 0) {
        const ym = rec.date.slice(0, 7);
        const spent = st.transactions
          .filter((t) => !t.deletedAt && t.type === 'expense' && t.categoryId === rec.categoryId && t.date.startsWith(ym))
          .reduce((s, t) => s + Number(t.amountTHB || 0), 0);
        const pct = (spent / b.amount) * 100;
        const level = pct >= 100 ? 'over' : pct >= 70 ? 'warn' : 'ok';
        if (level !== 'ok') {
          const nId = `budget-${b.id}-${ym}-${level}`;
          if (!st.notifications.some((n) => n.id === nId)) {
            const cat = st.categories.find((c) => c.id === rec.categoryId);
            st.notifications.unshift({
              id: nId,
              title: level === 'over' ? `เกินงบแล้ว: ${cat?.name || ''}` : `ใกล้ถึงลิมิต: ${cat?.name || ''}`,
              body: `ใช้ไป ฿ ${spent.toFixed(2)} จากงบ ฿ ${b.amount.toFixed(2)}`,
              read: false,
              createdAt: now,
            });
          }
        }
      }
    }

    saveState(st);
    return rec;
  },

  deleteTransaction(id) {
    const st = loadState();
    const now = new Date().toISOString();
    const t = st.transactions.find((x) => x.id === id);
    if (t) {
      t.deletedAt = now;
      t.updatedAt = now;
      st.history.unshift({
        id: makeUid(),
        txId: id,
        action: 'delete',
        summary: `ย้ายรายการ ${t.amount} ${t.currency} ไปถังขยะ`,
        snapshot: { amount: t.amount, currency: t.currency },
        changedAt: now,
      });
      saveState(st);
    }
  },

  fetchTxHistory(txId) {
    const st = loadState();
    return st.history.filter((h) => h.txId === txId);
  },

  getSlipUrl(slipId) {
    const st = loadState();
    return st.slips?.[slipId] || null;
  },

  saveWallet(w) {
    const st = loadState();
    const now = new Date().toISOString();
    const last4 = w.last4 ? String(w.last4).replace(/\D/g, '').slice(-4) : null;
    const idx = w.id ? st.wallets.findIndex((x) => x.id === w.id) : -1;
    const prev = idx >= 0 ? st.wallets[idx] : null;
    const cur = w.currency === 'USDT' ? 'USDT' : 'THB';
    const rec = {
      order: st.wallets.length,
      deletedAt: null,
      createdAt: now,
      ...prev,
      ...w,
      id: prev?.id || w.id || makeUid(),
      currency: cur,
      last4: last4 && last4.length === 4 ? last4 : null,
      initialBalance: cur === 'USDT' ? round4(w.initialBalance || 0) : round2(w.initialBalance || 0),
      updatedAt: now,
    };
    if (idx >= 0) st.wallets[idx] = rec;
    else st.wallets.push(rec);
    saveState(st);
    return rec.id;
  },

  deleteWallet(id) {
    const st = loadState();
    const w = st.wallets.find((x) => x.id === id);
    if (w) {
      w.deletedAt = new Date().toISOString();
      saveState(st);
    }
  },

  saveCategory(c) {
    const st = loadState();
    const now = new Date().toISOString();
    const idx = c.id ? st.categories.findIndex((x) => x.id === c.id) : -1;
    const prev = idx >= 0 ? st.categories[idx] : null;
    const id = prev?.id || c.id || makeUid();
    const rec = {
      order: st.categories.length,
      isDefault: false,
      deletedAt: null,
      createdAt: now,
      ...prev,
      ...c,
      id,
      updatedAt: now,
    };
    if (idx >= 0) st.categories[idx] = rec;
    else st.categories.push(rec);
    saveState(st);
    return id;
  },

  deleteCategory(id) {
    const st = loadState();
    const c = st.categories.find((x) => x.id === id);
    if (c) {
      c.deletedAt = new Date().toISOString();
      saveState(st);
    }
  },

  saveBudget(b) {
    const st = loadState();
    const now = new Date().toISOString();
    const idx = st.budgets.findIndex((x) => x.id === b.id || (x.categoryId === b.categoryId && !x.deletedAt));
    const prev = idx >= 0 ? st.budgets[idx] : null;
    const rec = {
      period: 'monthly',
      deletedAt: null,
      createdAt: now,
      ...prev,
      ...b,
      id: prev?.id || b.id || makeUid(),
      amount: round2(b.amount),
      updatedAt: now,
    };
    if (idx >= 0) st.budgets[idx] = rec;
    else st.budgets.push(rec);
    saveState(st);
  },

  deleteBudget(id) {
    const st = loadState();
    const b = st.budgets.find((x) => x.id === id);
    if (b) {
      b.deletedAt = new Date().toISOString();
      saveState(st);
    }
  },

  saveRecurring(r) {
    const st = loadState();
    const now = new Date().toISOString();
    const idx = r.id ? st.recurring.findIndex((x) => x.id === r.id) : -1;
    const prev = idx >= 0 ? st.recurring[idx] : null;
    const rec = {
      active: true,
      deletedAt: null,
      createdAt: now,
      ...prev,
      ...r,
      id: prev?.id || r.id || makeUid(),
      updatedAt: now,
    };
    if (idx >= 0) st.recurring[idx] = rec;
    else st.recurring.push(rec);
    runDueRecurringLocal(st);
    saveState(st);
  },

  deleteRecurring(id) {
    const st = loadState();
    const r = st.recurring.find((x) => x.id === id);
    if (r) {
      r.deletedAt = new Date().toISOString();
      saveState(st);
    }
  },

  runRecurringNow(id) {
    const st = loadState();
    const r = st.recurring.find((x) => x.id === id);
    if (!r) return;
    const now = new Date().toISOString();
    const fx = r.currency === 'THB' ? 1 : Number(r.fxRate || st.usdtRate || 34.5);
    const txId = makeUid();
    st.transactions.unshift({
      id: txId,
      type: r.type,
      amount: r.amount,
      currency: r.currency || 'THB',
      fxRate: fx,
      amountTHB: r.currency === 'THB' ? round2(r.amount) : round2(r.amount * fx),
      categoryId: r.categoryId || 'exp-other',
      walletId: r.walletId,
      toWalletId: r.toWalletId || null,
      toAmount: r.type === 'transfer' ? r.amount : null,
      fee: 0,
      channel: r.channel || 'CASH',
      date: now,
      reference: r.reference || '',
      note: r.note ? `[รายการประจำ] ${r.note}` : '[รายการประจำ]',
      slipId: null,
      tags: r.tags || [],
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    saveState(st);
  },

  restoreTrashItem(kind, id) {
    const st = loadState();
    const map = { transaction: st.transactions, wallet: st.wallets, category: st.categories, budget: st.budgets, recurring: st.recurring };
    const arr = map[kind] || [];
    const item = arr.find((x) => x.id === id);
    if (item) {
      item.deletedAt = null;
      item.updatedAt = new Date().toISOString();
      if (kind === 'transaction') {
        st.history.unshift({ id: makeUid(), txId: id, action: 'restore', summary: 'กู้คืนรายการจากถังขยะ', snapshot: {}, changedAt: item.updatedAt });
      }
      saveState(st);
    }
  },

  verifyPin(pin) {
    const st = loadState();
    if (!st.pinHash) return true;
    if (simplePinHash(pin) !== st.pinHash) throw new Error('รหัส PIN ไม่ถูกต้อง');
    return true;
  },

  setPinCode(currentPin, newPin) {
    const st = loadState();
    if (st.pinHash && simplePinHash(currentPin) !== st.pinHash) {
      throw new Error('รหัส PIN ปัจจุบันไม่ถูกต้อง');
    }
    st.pinHash = simplePinHash(newPin);
    saveState(st);
  },

  removePinCode(currentPin) {
    const st = loadState();
    if (st.pinHash && simplePinHash(currentPin) !== st.pinHash) {
      throw new Error('รหัส PIN ปัจจุบันไม่ถูกต้อง');
    }
    st.pinHash = null;
    saveState(st);
  },

  updateSettings(patch) {
    const st = loadState();
    st.settings = { ...st.settings, ...patch };
    if (st.settings.fxRates?.USDT > 0) st.usdtRate = Number(st.settings.fxRates.USDT);
    saveState(st);
    return st.settings;
  },

  saveUsdtRate(rate) {
    const st = loadState();
    st.usdtRate = Number(rate);
    st.settings.fxRates = { ...(st.settings.fxRates || {}), USDT: Number(rate) };
    saveState(st);
    return st.usdtRate;
  },

  markAllRead() {
    const st = loadState();
    for (const n of st.notifications) n.read = true;
    saveState(st);
  },

  exportCsv(params = {}) {
    const st = loadState();
    const catMap = new Map(st.categories.map((c) => [c.id, c.name]));
    const walMap = new Map(st.wallets.map((w) => [w.id, w.name]));
    const chMap = { BANK: 'โอนธนาคาร', TRUEMONEY: 'TrueMoney', USDT: 'USDT', CASH: 'เงินสด' };
    const typeMap = { income: 'รายรับ', expense: 'รายจ่าย', transfer: 'โอนระหว่างวอลเล็ท' };

    const month = typeof params === 'string' ? params : params.month;
    const from = typeof params === 'object' ? params.from : '';
    const to = typeof params === 'object' ? params.to : '';
    const qType = typeof params === 'object' ? params.type : '';
    const qWallet = typeof params === 'object' ? params.walletId : '';
    const qTag = typeof params === 'object' ? params.tag : '';

    const csvCell = (val) => {
      let s = val == null ? '' : String(val);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const rows = st.transactions.filter((t) => {
      if (t.deletedAt) return false;
      const ymd = t.date.slice(0, 10);
      if (month && !t.date.startsWith(month)) return false;
      if (from && ymd < from) return false;
      if (to && ymd > to) return false;
      if (qType && qType !== 'all' && t.type !== qType) return false;
      if (qWallet && qWallet !== 'all' && t.walletId !== qWallet && t.toWalletId !== qWallet) return false;
      if (qTag && qTag !== 'all' && !(t.tags || []).includes(qTag)) return false;
      return true;
    });

    const lines = [
      ['วันที่', 'เวลา', 'ประเภท', 'หมวดหมู่', 'ช่องทาง', 'วอลเล็ทต้นทาง', 'วอลเล็ทปลายทาง', 'จำนวนเงิน', 'สกุลเงิน', 'เรทแลกเปลี่ยน', 'มูลค่า (THB)', 'ค่าธรรมเนียม', 'แท็ก', 'อ้างอิง', 'โน้ต', 'แนบสลิป']
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
          String(t.amount),
          t.currency,
          t.fxRate,
          t.amountTHB != null ? Number(t.amountTHB).toFixed(2) : '',
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

    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ce-money-tracker-${month || from || 'all'}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2500);
  },

  exportBackupBlob() {
    const st = loadState();
    const payload = {
      app: 'CE Money Tracker Pro',
      dbVersion: 4,
      exportedAt: new Date().toISOString(),
      stores: {
        wallets: st.wallets,
        categories: st.categories,
        transactions: st.transactions,
        budgets: st.budgets,
        recurring: st.recurring,
        notifications: st.notifications,
      },
      slips: st.slips,
    };
    return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  },

  async importBackupFile(file) {
    const data = JSON.parse(await file.text());
    if (!data?.stores) throw new Error('ไฟล์สำรองไม่ถูกต้อง');
    const st = loadState();
    let merged = 0;
    const mergeArr = (target, incoming) => {
      for (const row of incoming || []) {
        if (!row?.id) continue;
        const i = target.findIndex((x) => x.id === row.id);
        if (i < 0) {
          target.push(row);
          merged++;
        } else if ((row.updatedAt || row.createdAt || '') >= (target[i].updatedAt || target[i].createdAt || '')) {
          target[i] = row;
          merged++;
        }
      }
    };
    mergeArr(st.wallets, data.stores.wallets);
    mergeArr(st.categories, data.stores.categories);
    mergeArr(st.transactions, data.stores.transactions);
    mergeArr(st.budgets, data.stores.budgets);
    mergeArr(st.recurring, data.stores.recurring);
    if (data.slips && typeof data.slips === 'object') {
      st.slips = { ...st.slips, ...data.slips };
    }
    saveState(st);
    return merged;
  },
};
