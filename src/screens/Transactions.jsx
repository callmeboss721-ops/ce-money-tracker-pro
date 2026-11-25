import { useMemo, useState } from 'react';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  CalendarDays,
  Check,
  Image as ImageIc,
  X,
  Filter,
  Tag,
  Plus,
} from 'lucide-react';
import { useStore } from '../lib/store';
import {
  inPeriod,
  stepAnchor,
  periodNavigatorLabel,
  signed,
  txTHB,
  collectAllTags,
  inMonth,
} from '../lib/calc';
import {
  fmtTHB,
  fmtCurrency,
  TH_DAYS,
  TH_DAYS_SHORT,
  TH_MONTHS,
  yearOf,
  dayKey,
  daysInMonth,
  timeLabel,
  fullDate,
  round2,
} from '../lib/format';
import { CHANNELS, channelInfo, inferChannelFromWallet } from '../lib/channels';
import { CategoryIcon, WalletLogo, Sheet, useUi, STROKE } from '../components/ui';

export function TxRow({ tx, onClick, showDate }) {
  const { categories, wallets, settings } = useStore();
  const { openSlip } = useUi();
  const isTransfer = tx.type === 'transfer';
  const cat = categories.find((c) => c.id === tx.categoryId);
  const wallet = wallets.find((w) => w.id === tx.walletId);
  const toWallet = tx.toWalletId ? wallets.find((w) => w.id === tx.toWalletId) : null;
  const ch = channelInfo(tx.channel || inferChannelFromWallet(wallet));

  const titleText = isTransfer
    ? `${wallet?.name || 'ต้นทาง'} → ${toWallet?.name || 'ปลายทาง'}`
    : cat?.name || 'ไม่ระบุหมวด';

  const detailText = [
    !isTransfer ? ch.label : 'โอนระหว่างวอลเล็ท',
    tx.reference ? `#${tx.reference}` : null,
    tx.tags?.length ? tx.tags.map((t) => `#${t}`).join(' ') : null,
    tx.note || null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="item" style={{ gap: 10 }}>
      <button type="button" className="row grow" style={{ textAlign: 'left', minWidth: 0, gap: 12 }} onClick={onClick}>
        <CategoryIcon cat={cat} transfer={isTransfer} walletCode={wallet?.providerCode} />
        <div className="col grow" style={{ gap: 1 }}>
          <span className="truncate" style={{ fontWeight: 500 }}>{titleText}</span>
          <span className="label-xs truncate">
            {showDate ? `${fullDate(tx.date, settings.yearFormat)} · ` : `${timeLabel(tx.date)} · `}
            {detailText}
          </span>
        </div>
      </button>
      {tx.slipId && (
        <button
          type="button"
          className="slip-pill"
          aria-label="ดูสลิปเต็มจอ"
          title="แตะดูสลิปเต็มจอ"
          onClick={(e) => {
            e.stopPropagation();
            openSlip({
              slipId: tx.slipId,
              caption: `${titleText} · ${fmtCurrency(tx.amount, tx.currency)}${tx.reference ? ` · #${tx.reference}` : ''}`,
            });
          }}
        >
          <ImageIc size={15} strokeWidth={STROKE} />
          <span>สลิป</span>
        </button>
      )}
      <button type="button" onClick={onClick} className={`num-md ${tx.type}`} style={{ flexShrink: 0, textAlign: 'right' }}>
        {settings.hideBalance ? '••••' : fmtCurrency(tx.amount, tx.currency)}
      </button>
    </div>
  );
}

const PERIODS = [
  { id: 'day', label: 'วันนี้' },
  { id: 'week', label: 'สัปดาห์' },
  { id: 'month', label: 'เดือน' },
];

export default function Transactions({ openTx, openQuickAdd }) {
  const { activeWallets, activeTx, settings, categories, usdtRate } = useStore();
  const [period, setPeriod] = useState('month'); // 'day' | 'week' | 'month' | 'all' — matches Ref 2!
  const [anchor, setAnchor] = useState(() => new Date());
  const [scope, setScope] = useState('all'); // 'all' or wallet.id
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState('all'); // 'all' | 'expense' | 'income' | 'transfer'
  const [catFilter, setCatFilter] = useState('all');
  const [chFilter, setChFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [dayFilter, setDayFilter] = useState('');

  const [pickCat, setPickCat] = useState(false);
  const [pickCh, setPickCh] = useState(false);
  const [pickTag, setPickTag] = useState(false);
  const [showCal, setShowCal] = useState(false);

  const hide = settings.hideBalance;
  const yf = settings.yearFormat;

  const allTags = useMemo(() => collectAllTags(activeTx), [activeTx]);
  const scopeWallets = scope === 'all' ? activeWallets : activeWallets.filter((w) => w.id === scope);
  const scopeIds = new Set(scopeWallets.map((w) => w.id));
  const scoped = activeTx.filter((t) => scopeIds.has(t.walletId) || (t.toWalletId && scopeIds.has(t.toWalletId)));

  const filteredTx = useMemo(() => {
    const s = q.trim().toLowerCase();
    return scoped.filter((t) => {
      if (dayFilter) {
        if (dayKey(t.date) !== dayFilter) return false;
      } else if (period !== 'all' && !inPeriod(t, period, anchor)) {
        return false;
      }
      if (typeFilter !== 'all' && t.type !== typeFilter) return false;
      if (catFilter !== 'all' && t.categoryId !== catFilter) return false;
      if (tagFilter !== 'all' && !(t.tags || []).includes(tagFilter)) return false;
      const w = activeWallets.find((x) => x.id === t.walletId);
      const ch = t.channel || inferChannelFromWallet(w);
      if (chFilter !== 'all' && ch !== chFilter) return false;
      if (s) {
        const cat = categories.find((c) => c.id === t.categoryId);
        const toW = t.toWalletId ? activeWallets.find((x) => x.id === t.toWalletId) : null;
        const chLabel = channelInfo(ch).label;
        const hit = [
          t.reference,
          t.note,
          cat?.name,
          w?.name,
          toW?.name,
          chLabel,
          ...(t.tags || []),
          String(t.amount),
          fmtCurrency(t.amount, t.currency),
        ].some((x) => x?.toLowerCase().includes(s));
        if (!hit) return false;
      }
      return true;
    });
  }, [scoped, dayFilter, period, anchor, typeFilter, catFilter, tagFilter, chFilter, q, activeWallets, categories]);

  const fxMap = useMemo(() => ({ USDT: usdtRate || 34.5, ...(settings?.fxRates || {}) }), [usdtRate, settings]);

  // Expense Donut Breakdown matching Ref Image 2 (reactive to current filters!)
  const breakdown = useMemo(() => {
    const targetType = typeFilter === 'income' ? 'income' : 'expense';
    const map = new Map();
    for (const t of filteredTx) {
      if (t.type !== targetType) continue;
      const valThb = txTHB(t, fxMap);
      if (valThb <= 0) continue;
      map.set(t.categoryId, (map.get(t.categoryId) || 0) + valThb);
    }
    const sorted = [...map.entries()]
      .map(([id, val]) => ({
        id,
        cat: categories.find((c) => c.id === id),
        val: round2(val),
      }))
      .sort((a, b) => b.val - a.val);

    const total = round2(sorted.reduce((s, r) => s + r.val, 0));
    const catCount = sorted.length;

    // Group tiny tail categories (>5) into "อื่นๆ" per Ref Image 2 caption
    let slices = sorted;
    if (sorted.length > 5) {
      const top5 = sorted.slice(0, 5);
      const restSum = round2(sorted.slice(5).reduce((s, r) => s + r.val, 0));
      slices = [
        ...top5,
        {
          id: '__others__',
          cat: { name: 'อื่นๆ', icon: 'ellipsis', color: '#7A8497' },
          val: restSum,
        },
      ];
    }
    return { targetType, slices, total, catCount };
  }, [filteredTx, typeFilter, categories, fxMap]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const t of filteredTx) {
      const k = dayKey(t.date);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(t);
    }
    return [...map.entries()].map(([k, list]) => ({
      k,
      date: new Date(list[0].date),
      list,
      net: round2(list.reduce((s, t) => s + signed(t, fxMap), 0)),
    }));
  }, [filteredTx, fxMap]);

  const activeFilterCount =
    (q.trim() ? 1 : 0) +
    (typeFilter !== 'all' ? 1 : 0) +
    (catFilter !== 'all' ? 1 : 0) +
    (chFilter !== 'all' ? 1 : 0) +
    (tagFilter !== 'all' ? 1 : 0) +
    (dayFilter ? 1 : 0);

  const clearFilters = () => {
    setQ('');
    setTypeFilter('all');
    setCatFilter('all');
    setChFilter('all');
    setTagFilter('all');
    setDayFilter('');
  };

  const selectedCatObj = categories.find((c) => c.id === catFilter);
  const periodLabel = dayFilter
    ? dayFilter
    : period === 'all'
      ? 'ทุกช่วงเวลา'
      : periodNavigatorLabel(period, anchor, yf);

  let acc = 0;
  const R = 48;
  const C = 2 * Math.PI * R;

  return (
    <main className="screen stack" style={{ gap: 14 }}>
      {/* Header matching Ref Image 2 */}
      <header className="between" style={{ paddingTop: 4 }}>
        <div className="col" style={{ gap: 1 }}>
          <h1 className="h1" style={{ fontSize: 22 }}>รายการ</h1>
          <span className="label-xs">
            {filteredTx.length} รายการ · {periodLabel}
          </span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button id="btn-calendar" className="icon-btn" onClick={() => setShowCal(true)} aria-label="ปฏิทิน">
            <CalendarDays size={20} strokeWidth={STROKE} />
          </button>
          <button className="icon-btn" style={{ borderRadius: '50%' }} onClick={() => openQuickAdd('expense')} aria-label="เพิ่มรายการ">
            <Plus size={20} strokeWidth={STROKE} />
          </button>
        </div>
      </header>

      {/* Period Switcher: วันนี้ | สัปดาห์ | เดือน */}
      <div className="period-seg" role="tablist" aria-label="เลือกช่วงเวลา">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={period === p.id && !dayFilter}
            className={period === p.id && !dayFilter ? 'on' : ''}
            onClick={() => {
              setPeriod(p.id);
              setDayFilter('');
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Period Stepper */}
      {period !== 'all' && !dayFilter && (
        <div className="period-nav">
          <button className="icon-btn plain" onClick={() => setAnchor((a) => stepAnchor(period, a, -1))} aria-label="ก่อนหน้า">
            <ChevronLeft size={20} strokeWidth={STROKE} />
          </button>
          <span className="title">{periodNavigatorLabel(period, anchor, yf)}</span>
          <button className="icon-btn plain" onClick={() => setAnchor((a) => stepAnchor(period, a, 1))} aria-label="ถัดไป">
            <ChevronRight size={20} strokeWidth={STROKE} />
          </button>
        </div>
      )}

      {/* Search bar matching Ref Image 2 */}
      <div style={{ position: 'relative' }}>
        <Search size={18} strokeWidth={STROKE} style={{ position: 'absolute', left: 14, top: 15, color: 'var(--text-3)' }} />
        <input
          id="tx-search-inline"
          placeholder="ค้นหาร้านค้า อ้างอิง หมวดหมู่ หรือจำนวน"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ paddingLeft: 42, paddingRight: q ? 40 : 14, borderRadius: 16 }}
        />
        {q && (
          <button type="button" className="icon-btn plain" style={{ position: 'absolute', right: 2, top: 2 }} onClick={() => setQ('')} aria-label="ล้างคำค้นหา">
            <X size={18} strokeWidth={STROKE} />
          </button>
        )}
      </div>

      {/* Horizontal Wallet / Bank Quick-Filter Pills (matching Ref Image 2: ทั้งหมด | KBANK | TrueMoney | USDT ...) */}
      <div className="wallet-pills" role="region" aria-label="กรองตามบัญชีหรือธนาคาร">
        <button className={`w-pill ${scope === 'all' ? 'on' : ''}`} onClick={() => setScope('all')}>
          ทั้งหมด
        </button>
        {activeWallets.map((w) => (
          <button
            key={w.id}
            className={`w-pill ${scope === w.id ? 'on' : ''}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '0 13px' }}
            onClick={() => setScope(scope === w.id ? 'all' : w.id)}
          >
            <WalletLogo code={w.providerCode} size={20} />
            <span>{w.name}</span>
          </button>
        ))}
      </div>

      {/* Extra filter chips (ประเภท / หมวด / ช่องทาง / แท็ก / วัน / ทุกช่วงเวลา) */}
      <div className="filter-bar" role="region" aria-label="ตัวกรองเพิ่มเติม">
        <button className={`f-chip ${period === 'all' ? 'on' : ''}`} onClick={() => { setPeriod(period === 'all' ? 'month' : 'all'); setDayFilter(''); }}>
          ทุกช่วงเวลา
        </button>
        <button className={`f-chip ${typeFilter === 'expense' ? 'on' : ''}`} onClick={() => setTypeFilter(typeFilter === 'expense' ? 'all' : 'expense')}>รายจ่าย</button>
        <button className={`f-chip ${typeFilter === 'income' ? 'on' : ''}`} onClick={() => setTypeFilter(typeFilter === 'income' ? 'all' : 'income')}>รายรับ</button>
        <button className={`f-chip ${typeFilter === 'transfer' ? 'on' : ''}`} onClick={() => setTypeFilter(typeFilter === 'transfer' ? 'all' : 'transfer')}>โอน</button>

        <button id="filter-cat" className={`f-chip ${catFilter !== 'all' ? 'on' : ''}`} onClick={() => setPickCat(true)}>
          <Filter size={14} strokeWidth={STROKE} />
          <span>{selectedCatObj ? selectedCatObj.name : 'หมวดหมู่'}</span>
          <ChevronDown size={14} strokeWidth={STROKE} />
        </button>

        <button id="filter-ch" className={`f-chip ${chFilter !== 'all' ? 'on' : ''}`} onClick={() => setPickCh(true)}>
          <span>{chFilter !== 'all' ? channelInfo(chFilter).label : 'ช่องทาง'}</span>
          <ChevronDown size={14} strokeWidth={STROKE} />
        </button>

        {allTags.length > 0 && (
          <button id="filter-tag" className={`f-chip ${tagFilter !== 'all' ? 'on' : ''}`} onClick={() => setPickTag(true)}>
            <Tag size={14} strokeWidth={STROKE} />
            <span>{tagFilter !== 'all' ? `#${tagFilter}` : 'แท็ก'}</span>
            <ChevronDown size={14} strokeWidth={STROKE} />
          </button>
        )}

        <label className={`f-chip ${dayFilter ? 'on' : ''}`} style={{ position: 'relative', cursor: 'pointer' }}>
          <CalendarDays size={14} strokeWidth={STROKE} />
          <span>{dayFilter || 'เลือกวัน'}</span>
          <input
            id="filter-day"
            type="date"
            value={dayFilter}
            onChange={(e) => setDayFilter(e.target.value)}
            style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', minHeight: 0, padding: 0, cursor: 'pointer' }}
          />
        </label>

        {activeFilterCount > 0 && (
          <button className="f-chip" style={{ color: '#ff8a95', borderColor: 'rgba(255,92,108,.35)' }} onClick={clearFilters}>
            <X size={14} strokeWidth={STROKE} /> ล้างตัวกรอง
          </button>
        )}
      </div>

      {/* Inline Proportion Donut Card matching Ref Image 2 */}
      {breakdown.slices.length > 0 && (
        <section className="card stack" style={{ gap: 14 }}>
          <div className="col" style={{ gap: 1 }}>
            <h2 className="h2">{breakdown.targetType === 'income' ? 'สัดส่วนรายรับ' : 'สัดส่วนรายจ่าย'}</h2>
            <span className="label-xs">{periodLabel}</span>
          </div>

          <div className="row" style={{ gap: 16 }}>
            <div style={{ position: 'relative', width: 132, height: 132, flexShrink: 0 }}>
              <svg viewBox="0 0 124 124" width="132" height="132" style={{ transform: 'rotate(-90deg)' }} role="img" aria-label="สัดส่วนตามหมวดหมู่">
                <circle cx="62" cy="62" r={R} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="15" />
                {breakdown.slices.map((s, i) => {
                  const len = breakdown.total > 0 ? (s.val / breakdown.total) * C : 0;
                  const el = (
                    <circle
                      key={i}
                      cx="62"
                      cy="62"
                      r={R}
                      fill="none"
                      stroke={s.cat?.color || '#7A8497'}
                      strokeWidth="15"
                      strokeDasharray={`${Math.max(0, len - 1.5)} ${C}`}
                      strokeDashoffset={-acc}
                    />
                  );
                  acc += len;
                  return el;
                })}
              </svg>
              <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center', padding: 14 }}>
                <div className="col" style={{ gap: 0, alignItems: 'center' }}>
                  <span className="label-xs">รวม</span>
                  <span className="num-md" style={{ fontWeight: 800 }}>
                    {hide ? '••••' : new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(breakdown.total)}
                  </span>
                  <span className="label-xs">บาท</span>
                </div>
              </div>
            </div>

            <div className="col grow" style={{ gap: 4 }}>
              <span style={{ fontWeight: 600 }}>{breakdown.catCount} หมวดหมู่</span>
              <span className="label-xs" style={{ lineHeight: 1.45 }}>
                แตะตัวกรองด้านบนเพื่อดูช่วงอื่น หมวดที่เล็กที่สุดจะถูกรวมเป็น “อื่นๆ”
              </span>
              <span className="label-xs gold">ตามตัวกรองที่เลือก</span>
            </div>
          </div>

          <div className="list">
            {breakdown.slices.map((s) => {
              const pct = breakdown.total > 0 ? Math.round((s.val / breakdown.total) * 100) : 0;
              return (
                <button
                  key={s.id}
                  type="button"
                  className="item"
                  style={{ minHeight: 48, padding: '6px 2px' }}
                  onClick={() => s.id !== '__others__' && setCatFilter(catFilter === s.id ? 'all' : s.id)}
                >
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: s.cat?.color || '#7A8497', flexShrink: 0 }} />
                  <CategoryIcon cat={s.cat} size={30} />
                  <span className="grow truncate">{s.cat?.name || 'อื่นๆ'}</span>
                  <span className="num-md">{hide ? '••••' : fmtTHB(s.val)}</span>
                  <span className="pct-badge">{pct}%</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Grouped daily transaction list */}
      {groups.length === 0 ? (
        <div className="empty">
          {activeFilterCount > 0 ? 'ไม่พบรายการที่ตรงกับตัวกรอง' : `ไม่มีรายการในช่วง ${periodLabel}`}
          {activeFilterCount > 0 && <button className="btn-ghost" onClick={clearFilters}>ล้างตัวกรองทั้งหมด</button>}
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.k} id={`day-${g.k}`} className="card" style={{ padding: '12px 14px', scrollMarginTop: 12 }}>
            <div className="day-head">
              <span className="day-num">{String(g.date.getDate()).padStart(2, '0')}</span>
              <div className="col grow" style={{ gap: 0 }}>
                <span style={{ fontWeight: 500 }}>{TH_DAYS[g.date.getDay()]}</span>
                <span className="label-xs">{TH_MONTHS[g.date.getMonth()]} {yearOf(g.date.getFullYear(), yf)}</span>
              </div>
              <span className={`num-md ${g.net >= 0 ? 'income' : 'expense'}`}>{hide ? '••••' : fmtTHB(g.net)}</span>
            </div>
            <div className="list">
              {g.list.map((t) => <TxRow key={t.id} tx={t} onClick={() => openTx(t)} />)}
            </div>
          </section>
        ))
      )}

      {pickCat && (
        <Sheet title="กรองตามหมวดหมู่" onClose={() => setPickCat(false)}>
          <div className="list">
            <button className="item" onClick={() => { setCatFilter('all'); setPickCat(false); }}>
              <span className="grow">ทุกหมวดหมู่</span>
              {catFilter === 'all' && <Check size={20} strokeWidth={STROKE} className="gold" />}
            </button>
            {categories.filter((c) => !c.deletedAt && (typeFilter === 'all' || typeFilter === 'transfer' || c.type === typeFilter)).map((c) => (
              <button key={c.id} className="item" onClick={() => { setCatFilter(c.id); setPickCat(false); }}>
                <CategoryIcon cat={c} />
                <div className="col grow" style={{ gap: 0 }}>
                  <span>{c.name}</span>
                  <span className="label-xs">{c.type === 'income' ? 'รายรับ' : 'รายจ่าย'}</span>
                </div>
                {catFilter === c.id && <Check size={20} strokeWidth={STROKE} className="gold" />}
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {pickCh && (
        <Sheet title="กรองตามช่องทาง" onClose={() => setPickCh(false)}>
          <div className="list">
            <button className="item" onClick={() => { setChFilter('all'); setPickCh(false); }}>
              <span className="grow">ทุกช่องทาง</span>
              {chFilter === 'all' && <Check size={20} strokeWidth={STROKE} className="gold" />}
            </button>
            {CHANNELS.map((ch) => (
              <button key={ch.code} className="item" onClick={() => { setChFilter(ch.code); setPickCh(false); }}>
                <span className="grow">{ch.label}</span>
                {chFilter === ch.code && <Check size={20} strokeWidth={STROKE} className="gold" />}
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {pickTag && (
        <Sheet title="กรองตามแท็ก" onClose={() => setPickTag(false)}>
          <div className="list">
            <button className="item" onClick={() => { setTagFilter('all'); setPickTag(false); }}>
              <span className="grow">ทุกแท็ก</span>
              {tagFilter === 'all' && <Check size={20} strokeWidth={STROKE} className="gold" />}
            </button>
            {allTags.map((tg) => (
              <button key={tg} className="item" onClick={() => { setTagFilter(tg); setPickTag(false); }}>
                <span className="grow">#{tg}</span>
                {tagFilter === tg && <Check size={20} strokeWidth={STROKE} className="gold" />}
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {showCal && (
        <CalendarSheet
          y={anchor.getFullYear()}
          m={anchor.getMonth()}
          tx={scoped.filter((t) => inMonth(t, anchor.getFullYear(), anchor.getMonth()))}
          onClose={() => setShowCal(false)}
          onDay={(k) => { setShowCal(false); setDayFilter(k); }}
          hide={hide}
          yf={yf}
          usdtRate={usdtRate}
        />
      )}
    </main>
  );
}

function compact(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return (a / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (a >= 1e4) return Math.round(a / 1e3) + 'k';
  if (a >= 1e3) return (a / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(a));
}

function CalendarSheet({ y, m, tx, onClose, onDay, hide, yf, usdtRate }) {
  const n = daysInMonth(y, m);
  const lead = new Date(y, m, 1).getDay();
  const net = {};
  for (const t of tx) {
    const k = dayKey(t.date);
    net[k] = (net[k] || 0) + signed(t, usdtRate);
  }
  const todayK = dayKey(new Date());
  return (
    <Sheet title={`${TH_MONTHS[m]} ${yearOf(y, yf)}`} onClose={onClose}>
      <div className="cal">
        {TH_DAYS_SHORT.map((d) => <div key={d} className="dh">{d}</div>)}
        {Array.from({ length: lead }, (_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: n }, (_, i) => {
          const k = dayKey(new Date(y, m, i + 1));
          const v = net[k];
          return (
            <button key={k} className={`dc ${k === todayK ? 'today' : ''}`} onClick={() => v !== undefined && onDay(k)} disabled={v === undefined}>
              <span className="en" style={{ fontWeight: 600 }}>{i + 1}</span>
              {v !== undefined && !hide && <small className={v >= 0 ? 'income' : 'expense'}>{compact(v)}</small>}
            </button>
          );
        })}
      </div>
      <p className="label-xs" style={{ textAlign: 'center', marginTop: 12 }}>แตะวันที่เพื่อกรองเฉพาะรายการของวันนั้น</p>
    </Sheet>
  );
}
