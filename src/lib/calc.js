import { daysInMonth, round2, round4, shortDate, monthLabel, TH_DAYS_SHORT, dayKey } from './format';

export const alive = (x) => !x.deletedAt;

/**
 * Value of transaction in THB.
 * Per Ref spec: if a foreign currency transaction has no rate set yet (fxRate === 0 and not in fxRates),
 * it displays its original currency amount and is NOT counted in THB totals (returns 0).
 */
export function hasFxRate(tx, fxRates = {}) {
  if (!tx.currency || tx.currency === 'THB') return true;
  if (tx.fxRate && Number(tx.fxRate) > 0) return true;
  if (fxRates && Number(fxRates[tx.currency]) > 0) return true;
  return false;
}

export function txTHB(tx, rateOrMap = 34.5) {
  if (!tx.currency || tx.currency === 'THB') return round2(Number(tx.amount) || 0);
  if (tx.fxRate && Number(tx.fxRate) > 0) {
    return tx.amountTHB != null ? Number(tx.amountTHB) : round2((Number(tx.amount) || 0) * Number(tx.fxRate));
  }
  if (rateOrMap && typeof rateOrMap === 'object' && Number(rateOrMap[tx.currency]) > 0) {
    return round2((Number(tx.amount) || 0) * Number(rateOrMap[tx.currency]));
  }
  if (tx.currency === 'USDT' && typeof rateOrMap === 'number' && rateOrMap > 0) {
    return round2((Number(tx.amount) || 0) * rateOrMap);
  }
  return 0; // Unmapped foreign currency: excluded from THB total until rate is set
}

/** Signed THB effect for net daily / monthly display (transfers only affect net by any fee). */
export function signed(tx, fallbackRate = 34.5) {
  if (tx.type === 'income') return txTHB(tx, fallbackRate);
  if (tx.type === 'expense') return -txTHB(tx, fallbackRate);
  if (tx.type === 'transfer' && tx.fee) {
    const fx = tx.currency && tx.currency !== 'THB' ? Number(tx.fxRate || fallbackRate) : 1;
    return -round2(Number(tx.fee) * fx);
  }
  return 0;
}

/** Balance of a wallet in its own currency (THB or USDT). */
export function walletBalance(wallet, txs, before = null) {
  let b = Number(wallet.initialBalance) || 0;
  const wCur = wallet.currency || 'THB';

  for (const t of txs) {
    if (t.deletedAt) continue;
    if (before && new Date(t.date) >= before) continue;

    if (t.type === 'transfer') {
      if (t.walletId === wallet.id) {
        b -= (Number(t.amount) || 0) + (Number(t.fee) || 0);
      }
      if (t.toWalletId === wallet.id) {
        b += t.toAmount != null ? Number(t.toAmount) : Number(t.amount) || 0;
      }
    } else if (t.walletId === wallet.id) {
      let amt = Number(t.amount) || 0;
      const tCur = t.currency || 'THB';
      if (tCur !== wCur) {
        const fx = Number(t.fxRate || 34.5);
        amt = wCur === 'THB' ? amt * fx : amt / fx;
      }
      b += t.type === 'income' ? amt : -amt;
    }
  }
  return wCur === 'USDT' ? round4(b) : round2(b);
}

export function walletBalanceTHB(wallet, txs, usdtRate = 34.5, before = null) {
  const native = walletBalance(wallet, txs, before);
  return wallet.currency === 'USDT' ? round2(native * (usdtRate || 34.5)) : round2(native);
}

/** Total balance in THB across a set of wallets. */
export function scopeBalance(wallets, txs, before = null, usdtRate = 34.5) {
  return round2(wallets.reduce((s, w) => s + walletBalanceTHB(w, txs, usdtRate, before), 0));
}

export function inMonth(t, y, m) {
  const d = new Date(t.date);
  return d.getFullYear() === y && d.getMonth() === m;
}

/** Period bounds for 'day' | 'week' | 'month' around anchor Date. */
export function periodBounds(mode, anchor) {
  const dt = new Date(anchor);
  if (mode === 'day') {
    const start = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 0, 0, 0, 0);
    const end = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 1, 0, 0, 0, 0);
    return { start, end };
  }
  if (mode === 'week') {
    // Monday-start week (standard Thai / ISO week)
    const day = dt.getDay();
    const diffToMon = (day + 6) % 7;
    const start = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() - diffToMon, 0, 0, 0, 0);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7, 0, 0, 0, 0);
    return { start, end };
  }
  // month
  const start = new Date(dt.getFullYear(), dt.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(dt.getFullYear(), dt.getMonth() + 1, 1, 0, 0, 0, 0);
  return { start, end };
}

export function stepAnchor(mode, anchor, delta) {
  const dt = new Date(anchor);
  if (mode === 'day') dt.setDate(dt.getDate() + delta);
  else if (mode === 'week') dt.setDate(dt.getDate() + delta * 7);
  else dt.setMonth(dt.getMonth() + delta);
  return dt;
}

export function periodNavigatorLabel(mode, anchor, yearFormat) {
  const { start, end } = periodBounds(mode, anchor);
  if (mode === 'day') return shortDate(start, yearFormat);
  if (mode === 'week') {
    const lastDay = new Date(end.getTime() - 1);
    return `${start.getDate()} ${shortDate(lastDay, yearFormat).replace(/^\d+/, `– ${lastDay.getDate()}`)}`;
  }
  return monthLabel(start.getFullYear(), start.getMonth(), yearFormat);
}

export function inPeriod(tx, mode, anchor) {
  if (mode === 'all') return true;
  const { start, end } = periodBounds(mode, anchor);
  const t = new Date(tx.date);
  return t >= start && t < end;
}

export function periodTotals(txs, mode, anchor, usdtRate = 34.5) {
  let income = 0;
  let expense = 0;
  for (const t of txs) {
    if (t.deletedAt || !inPeriod(t, mode, anchor)) continue;
    if (t.type === 'income') income += txTHB(t, usdtRate);
    else if (t.type === 'expense') expense += txTHB(t, usdtRate);
    else if (t.type === 'transfer' && t.fee > 0) {
      const fx = t.currency && t.currency !== 'THB' ? Number(t.fxRate || usdtRate) : 1;
      expense += Number(t.fee) * fx;
    }
  }
  return { income: round2(income), expense: round2(expense), net: round2(income - expense) };
}

/** 7-day daily expense series ending at `anchor` day (for the capsule bar chart). */
export function last7DaysExpense(txs, anchor, usdtRate = 34.5) {
  const base = new Date(anchor);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
    days.push({
      key: dayKey(d),
      label: TH_DAYS_SHORT[d.getDay()],
      date: d,
      expense: 0,
      isAnchor: i === 0,
    });
  }
  const map = new Map(days.map((x) => [x.key, x]));
  for (const t of txs) {
    if (t.deletedAt) continue;
    const slot = map.get(dayKey(t.date));
    if (!slot) continue;
    if (t.type === 'expense') slot.expense = round2(slot.expense + txTHB(t, usdtRate));
    else if (t.type === 'transfer' && t.fee > 0) {
      const fx = t.currency && t.currency !== 'THB' ? Number(t.fxRate || usdtRate) : 1;
      slot.expense = round2(slot.expense + Number(t.fee) * fx);
    }
  }
  const total = round2(days.reduce((s, d) => s + d.expense, 0));
  return { days, total };
}

export function monthTotals(txs, y, m, usdtRate = 34.5) {
  return periodTotals(txs, 'month', new Date(y, m, 1), usdtRate);
}

/** Cumulative daily totals in THB for a month. */
export function cumulativeDaily(txs, y, m, type, usdtRate = 34.5) {
  const n = daysInMonth(y, m);
  const daily = new Array(n).fill(0);
  for (const t of txs) {
    if (t.deletedAt || t.type !== type || !inMonth(t, y, m)) continue;
    daily[new Date(t.date).getDate() - 1] += txTHB(t, usdtRate);
  }
  let acc = 0;
  return daily.map((v) => (acc = round2(acc + v)));
}

/** Average cumulative curve of the 3 months before (y, m), aligned to `len` days. */
export function avgPrev3(txs, y, m, type, len, usdtRate = 34.5) {
  const curves = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(y, m - i, 1);
    curves.push(cumulativeDaily(txs, d.getFullYear(), d.getMonth(), type, usdtRate));
  }
  return Array.from({ length: len }, (_, day) =>
    round2(curves.reduce((s, c) => s + (c[Math.min(day, c.length - 1)] || 0), 0) / 3),
  );
}

/** Category expense total in THB for budgets. */
export function categorySpent(txs, categoryId, y, m, usdtRate = 34.5) {
  let s = 0;
  for (const t of txs) {
    if (!t.deletedAt && t.type === 'expense' && t.categoryId === categoryId && inMonth(t, y, m)) {
      s += txTHB(t, usdtRate);
    }
  }
  return round2(s);
}

export function budgetLevel(spent, amount) {
  const pct = amount > 0 ? (spent / amount) * 100 : 0;
  if (pct >= 100) return { pct, level: 'over' };
  if (pct >= 70) return { pct, level: 'warn' };
  return { pct, level: 'ok' };
}

/** Duplicate transaction check (amount + wallet + close time / matching reference or note). */
export function findDuplicate(txs, draft, excludeId) {
  const t0 = new Date(draft.date).getTime();
  const draftRef = (draft.reference || '').trim().toLowerCase();
  const draftNote = (draft.note || '').trim().toLowerCase();

  return txs.find((t) => {
    if (t.deletedAt || t.id === excludeId || t.type !== draft.type) return false;
    if (round4(t.amount) !== round4(draft.amount) || (t.currency || 'THB') !== (draft.currency || 'THB')) return false;

    const tRef = (t.reference || '').trim().toLowerCase();
    const tNote = (t.note || '').trim().toLowerCase();

    if (draftRef && tRef && draftRef === tRef) return true;

    const closeInTime = Math.abs(new Date(t.date).getTime() - t0) <= 15 * 60 * 1000;
    if (!closeInTime) return false;

    return draftRef === tRef && draftNote === tNote;
  });
}

/** Collect all unique tags across active transactions for quick-pick suggestions. */
export function collectAllTags(txs) {
  const counts = new Map();
  for (const t of txs) {
    if (t.deletedAt) continue;
    for (const tag of t.tags || []) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
}
