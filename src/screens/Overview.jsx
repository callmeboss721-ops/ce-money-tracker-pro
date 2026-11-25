import { useMemo, useState } from 'react';
import { Eye, EyeOff, Search, Bell, ChevronRight, ChevronLeft, Plus, Coins } from 'lucide-react';
import { useStore } from '../lib/store';
import {
  scopeBalance,
  walletBalance,
  walletBalanceTHB,
  periodTotals,
  stepAnchor,
  periodNavigatorLabel,
  last7DaysExpense,
  inPeriod,
  txTHB,
} from '../lib/calc';
import { fmtTHB, fmtCurrency, HIDDEN, TH_DAYS, maskLast4, round2 } from '../lib/format';
import { WalletLogo, CategoryIcon, STROKE } from '../components/ui';
import { TxRow } from './Transactions';

const PERIODS = [
  { id: 'day', label: 'วันนี้' },
  { id: 'week', label: 'สัปดาห์' },
  { id: 'month', label: 'เดือน' },
];

export default function Overview({ go, openSearch, openNotifications, openTx, openQuickAdd }) {
  const { activeWallets, transactions, activeTx, categories, notifications, settings, usdtRate, updateSettings } = useStore();
  const [period, setPeriod] = useState('day'); // 'day' | 'week' | 'month' — matches Ref image 1 default!
  const [anchor, setAnchor] = useState(() => new Date());

  const hide = settings.hideBalance;
  const yf = settings.yearFormat;
  const unread = notifications.filter((n) => !n.read).length;

  const fxMap = useMemo(() => ({ USDT: usdtRate || 34.5, ...(settings?.fxRates || {}) }), [usdtRate, settings]);
  const totalWalletTHB = scopeBalance(activeWallets, transactions, null, usdtRate);
  const pTotals = useMemo(() => periodTotals(activeTx, period, anchor, fxMap), [activeTx, period, anchor, fxMap]);
  const week7 = useMemo(() => last7DaysExpense(activeTx, anchor, fxMap), [activeTx, anchor, fxMap]);

  // Top categories in selected period
  const periodCats = useMemo(() => {
    const map = new Map();
    for (const t of activeTx) {
      if (t.type !== 'expense' || !inPeriod(t, period, anchor)) continue;
      const valThb = txTHB(t, fxMap);
      if (valThb <= 0) continue;
      map.set(t.categoryId, (map.get(t.categoryId) || 0) + valThb);
    }
    const rows = [...map.entries()]
      .map(([id, val]) => ({ cat: categories.find((c) => c.id === id), val: round2(val) }))
      .sort((a, b) => b.val - a.val);
    const sum = rows.reduce((s, r) => s + r.val, 0);
    return { rows, sum };
  }, [activeTx, period, anchor, fxMap, categories]);

  const maxBar = Math.max(1, ...week7.days.map((d) => d.expense));
  const todayName = TH_DAYS[new Date().getDay()];
  const periodBadge = PERIODS.find((p) => p.id === period)?.label || '';

  return (
    <main className="screen stack" style={{ gap: 15 }}>
      {/* Header matching Ref 1 */}
      <header className="between" style={{ paddingTop: 4 }}>
        <div className="row" style={{ gap: 12, minWidth: 0 }}>
          <span
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              display: 'grid',
              placeItems: 'center',
              background: 'linear-gradient(135deg, rgba(242,213,122,0.22), rgba(212,175,55,0.08))',
              border: '1px solid var(--line)',
              color: 'var(--gold)',
              flexShrink: 0,
            }}
          >
            <Coins size={22} strokeWidth={STROKE} />
          </span>
          <div className="col" style={{ gap: 1, minWidth: 0 }}>
            <h1 className="en gold truncate" style={{ margin: 0, fontWeight: 800, fontSize: 15, letterSpacing: '0.12em' }}>
              CE MONEY TRACKER
            </h1>
            <span className="label-xs">{todayName}</span>
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button id="btn-search" className="icon-btn" onClick={openSearch} aria-label="ค้นหา">
            <Search size={20} strokeWidth={STROKE} />
          </button>
          <button id="btn-bell" className="icon-btn" onClick={openNotifications} aria-label={`การแจ้งเตือน ${unread} รายการที่ยังไม่อ่าน`}>
            <Bell size={20} strokeWidth={STROKE} />
            {unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
          </button>
        </div>
      </header>

      {/* Period segmented pills: วันนี้ | สัปดาห์ | เดือน */}
      <div className="period-seg" role="tablist" aria-label="เลือกช่วงเวลา">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            id={`ov-period-${p.id}`}
            role="tab"
            aria-selected={period === p.id}
            className={period === p.id ? 'on' : ''}
            onClick={() => {
              setPeriod(p.id);
              setAnchor(new Date());
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Date / Week / Month stepper */}
      <div className="period-nav">
        <button className="icon-btn plain" onClick={() => setAnchor((a) => stepAnchor(period, a, -1))} aria-label="ย้อนกลับ">
          <ChevronLeft size={20} strokeWidth={STROKE} />
        </button>
        <span className="title">{periodNavigatorLabel(period, anchor, yf)}</span>
        <button className="icon-btn plain" onClick={() => setAnchor((a) => stepAnchor(period, a, 1))} aria-label="ถัดไป">
          <ChevronRight size={20} strokeWidth={STROKE} />
        </button>
      </div>

      {/* Starry Hero Summary Card (Ref 1 + Total Balance) */}
      <section className="card hero-starry" style={{ padding: '20px 18px' }}>
        <div className="between">
          <span className="label">รายจ่ายรวม</span>
          <div className="row" style={{ gap: 6 }}>
            <span
              style={{
                padding: '3px 10px',
                borderRadius: 999,
                background: 'rgba(255,255,255,0.08)',
                fontSize: 14,
                color: 'var(--text-2)',
              }}
            >
              {periodBadge}
            </span>
            <button id="btn-eye" className="icon-btn plain" style={{ width: 36, height: 36 }} onClick={() => updateSettings({ hideBalance: !hide })} aria-label={hide ? 'แสดงยอด' : 'ซ่อนยอด'}>
              {hide ? <EyeOff size={18} strokeWidth={STROKE} /> : <Eye size={18} strokeWidth={STROKE} />}
            </button>
          </div>
        </div>

        <div className="num-xl" style={{ marginTop: 6 }}>
          {hide ? HIDDEN : fmtTHB(pTotals.expense)}
        </div>

        <div className="hero-split">
          <div className="col" style={{ gap: 2 }}>
            <span className="label-xs">รายรับ</span>
            <span className="num-md" style={{ color: 'var(--ok)' }}>
              {hide ? '••••' : fmtTHB(pTotals.income)}
            </span>
          </div>
          <i />
          <div className="col" style={{ gap: 2 }}>
            <span className="label-xs">สุทธิ</span>
            <span className={`num-md ${pTotals.net >= 0 ? 'income' : 'expense'}`}>
              {hide ? '••••' : `${pTotals.net < 0 ? '-' : '+'}${fmtTHB(pTotals.net)}`}
            </span>
          </div>
        </div>

        <div className="between" style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <span className="label-xs">ยอดคงเหลือรวมทุกวอลเล็ท</span>
          <span id="total-wallet-balance" className="num-md gold">
            {hide ? HIDDEN : fmtTHB(totalWalletTHB)}
          </span>
        </div>
      </section>

      {/* Quick shortcut buttons: + รายรับ and + รายจ่าย */}
      <div className="quick-grid">
        <button id="btn-quick-income" className="btn-quick inc" onClick={() => openQuickAdd('income')}>
          <Plus size={20} strokeWidth={2.2} /> รายรับ
        </button>
        <button id="btn-quick-expense" className="btn-quick exp" onClick={() => openQuickAdd('expense')}>
          <Plus size={20} strokeWidth={2.2} /> รายจ่าย
        </button>
      </div>

      {/* 7-Day Capsule Bar Chart Card (exact Ref 1 style) */}
      <section className="card">
        <div className="between">
          <h2 className="h2">รายจ่าย 7 วันล่าสุด</h2>
          <span className="num-md gold">{hide ? '••••' : fmtTHB(week7.total)}</span>
        </div>
        <div className="capsule-chart" role="img" aria-label="กราฟรายจ่าย 7 วันล่าสุด">
          {week7.days.map((d) => {
            const hPct = d.expense > 0 ? Math.max(18, Math.round((d.expense / maxBar) * 92)) : 16;
            return (
              <button
                key={d.key}
                type="button"
                className="cap-col"
                title={`${d.label}: ${fmtTHB(d.expense)}`}
                onClick={() => {
                  setPeriod('day');
                  setAnchor(d.date);
                }}
              >
                <span className={`cap-bar ${d.isAnchor ? 'active' : ''}`} style={{ height: `${hPct}px` }} />
                <span className="label-xs" style={{ color: d.isAnchor ? 'var(--gold)' : 'var(--text-3)', fontWeight: d.isAnchor ? 600 : 300 }}>
                  {d.label}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Categories breakdown for selected period (Ref 1) */}
      <section className="card">
        <div className="card-title">
          <h2 className="h2">หมวดหมู่ ({periodBadge})</h2>
          <button className="link" onClick={() => go('summary')}>
            ดูทั้งหมด <ChevronRight size={16} strokeWidth={STROKE} />
          </button>
        </div>
        {periodCats.rows.length === 0 ? (
          <div className="empty" style={{ padding: '18px 14px' }}>
            ยังไม่มีรายจ่ายใน{periodBadge === 'วันนี้' ? 'วันนี้' : `ช่วง${periodBadge}นี้`}
          </div>
        ) : (
          <div className="list">
            {periodCats.rows.slice(0, 5).map((r, idx) => {
              const pct = periodCats.sum > 0 ? Math.round((r.val / periodCats.sum) * 100) : 0;
              return (
                <div key={idx} className="item" style={{ cursor: 'default' }}>
                  <CategoryIcon cat={r.cat} />
                  <div className="col grow" style={{ gap: 6 }}>
                    <div className="between">
                      <span className="truncate" style={{ fontWeight: 500 }}>{r.cat?.name || 'อื่นๆ'}</span>
                      <div className="row" style={{ gap: 8 }}>
                        <span className="num-md">{hide ? '••••' : fmtTHB(r.val)}</span>
                        <span className="label-xs num">{pct}%</span>
                      </div>
                    </div>
                    <div className="progress">
                      <i style={{ width: `${pct}%`, background: r.cat?.color || 'var(--gold)' }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 5 Recent transactions */}
      <section className="card">
        <div className="card-title">
          <h2 className="h2">5 รายการล่าสุด</h2>
          <button className="link" onClick={() => go('transactions')}>
            ดูทั้งหมด <ChevronRight size={16} strokeWidth={STROKE} />
          </button>
        </div>
        {activeTx.length === 0 ? (
          <div className="empty" style={{ padding: '20px 14px' }}>
            แตะปุ่ม "+ รายรับ" หรือ "+ รายจ่าย" เพื่อบันทึกรายการแรก
          </div>
        ) : (
          <div className="list">
            {activeTx.slice(0, 5).map((t) => (
              <TxRow key={t.id} tx={t} onClick={() => openTx(t)} showDate />
            ))}
          </div>
        )}
      </section>

      {/* Wallets summary */}
      <section className="card">
        <div className="card-title">
          <h2 className="h2">บัญชีและวอลเล็ท</h2>
          <button id="link-wallets" className="link" onClick={() => go('wallets')}>
            ดูทั้งหมด <ChevronRight size={16} strokeWidth={STROKE} />
          </button>
        </div>
        <div className="list">
          {activeWallets.slice(0, 4).map((w) => {
            const b = walletBalance(w, transactions);
            const bThb = walletBalanceTHB(w, transactions, usdtRate);
            return (
              <div key={w.id} className="item" style={{ cursor: 'default' }}>
                <WalletLogo code={w.providerCode} />
                <div className="col grow" style={{ gap: 0 }}>
                  <span className="truncate">{w.name}</span>
                  <span className="label-xs num">
                    {w.currency || 'THB'}{w.last4 ? ` · ${maskLast4(w.last4)}` : ''}
                  </span>
                </div>
                <div className="col" style={{ alignItems: 'flex-end', gap: 0 }}>
                  <span className="num-md" style={{ color: b < 0 ? 'var(--expense)' : 'var(--text)' }}>
                    {hide ? HIDDEN : fmtCurrency(b, w.currency)}
                  </span>
                  {w.currency === 'USDT' && !hide && <span className="label-xs num">≈ {fmtTHB(bThb)}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
