import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, FileSpreadsheet, Plus } from 'lucide-react';
import { useStore } from '../lib/store';
import { inMonth, monthTotals, txTHB, walletBalance, walletBalanceTHB, scopeBalance } from '../lib/calc';
import { fmtTHB, fmtCurrency, HIDDEN, maskLast4, monthLabel, monthKey, round2, TH_MONTHS_SHORT } from '../lib/format';
import { GROUPS } from '../lib/logos';
import { CHANNELS, inferChannelFromWallet } from '../lib/channels';
import { CategoryIcon, WalletLogo, useUi, STROKE, Icon } from '../components/ui';
import { WalletForm } from '../components/forms';
import Budgets from './Budgets';

const COLORS = { expense: '#FF5C6C', income: '#19B5FF' };

function compact(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return (a / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (a >= 1e3) return (a / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(a));
}

function MonthlyBarChart({ series }) {
  const W = 320, H = 175, P = { l: 46, r: 8, t: 12, b: 30 };
  const max = Math.max(1, ...series.flatMap((m) => [m.income, m.expense])) * 1.12;
  const slot = (W - P.l - P.r) / series.length;
  const bw = Math.min(15, slot / 2.8);
  const y = (v) => P.t + (1 - v / max) * (H - P.t - P.b);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="กราฟรายรับ-รายจ่ายรายเดือน">
      {[0, 0.5, 1].map((f, i) => (
        <g key={i}>
          <line x1={P.l} x2={W - P.r} y1={y(max * f)} y2={y(max * f)} stroke="rgba(255,255,255,.06)" />
          <text x={P.l - 6} y={y(max * f) + 4} textAnchor="end" fill="#8F99AB" fontSize="13" fontFamily="JetBrains Mono">{compact(max * f)}</text>
        </g>
      ))}
      {series.map((m, i) => {
        const cx = P.l + slot * i + slot / 2;
        return (
          <g key={i}>
            <rect x={cx - bw - 1.5} y={y(m.income)} width={bw} height={Math.max(0, y(0) - y(m.income))} rx="3.5" fill={COLORS.income} opacity={m.active ? 1 : 0.72} />
            <rect x={cx + 1.5} y={y(m.expense)} width={bw} height={Math.max(0, y(0) - y(m.expense))} rx="3.5" fill={COLORS.expense} opacity={m.active ? 1 : 0.72} />
            <text x={cx} y={H - 8} textAnchor="middle" fill={m.active ? 'var(--gold)' : '#8F99AB'} fontWeight={m.active ? '600' : '400'} fontSize="13" fontFamily="IBM Plex Sans Thai">
              {m.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function Summary({ defaultView = 'wallets' }) {
  const { activeTx, activeWallets, transactions, categories, wallets, settings, usdtRate, exportCsv } = useStore();
  const { toast } = useUi();
  const [view, setView] = useState(defaultView); // 'wallets' | 'summary' | 'budgets'
  const [wForm, setWForm] = useState(null);
  const now = new Date();
  const [sel, setSel] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [catType, setCatType] = useState('expense');
  const [exporting, setExporting] = useState(false);
  const hide = settings.hideBalance;
  const yf = settings.yearFormat;

  const shiftMonth = (delta) => {
    const d = new Date(sel.y, sel.m + delta, 1);
    setSel({ y: d.getFullYear(), m: d.getMonth() });
  };

  const monthTx = useMemo(() => activeTx.filter((t) => inMonth(t, sel.y, sel.m)), [activeTx, sel]);
  const totals = useMemo(() => monthTotals(activeTx, sel.y, sel.m, usdtRate), [activeTx, sel, usdtRate]);
  const net = round2(totals.income - totals.expense);

  const series = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => {
        const d = new Date(sel.y, sel.m - 5 + i, 1);
        const yy = d.getFullYear();
        const mm = d.getMonth();
        return {
          ...monthTotals(activeTx, yy, mm, usdtRate),
          label: TH_MONTHS_SHORT[mm],
          active: yy === sel.y && mm === sel.m,
        };
      }),
    [activeTx, sel, usdtRate],
  );

  const catRows = useMemo(() => {
    const map = new Map();
    for (const t of monthTx) {
      if (t.type === catType) map.set(t.categoryId, (map.get(t.categoryId) || 0) + txTHB(t, usdtRate));
    }
    return [...map.entries()]
      .map(([id, v]) => ({ cat: categories.find((c) => c.id === id), v: round2(v) }))
      .sort((a, b) => b.v - a.v);
  }, [monthTx, catType, categories, usdtRate]);

  const catTotal = catRows.reduce((s, r) => s + r.v, 0);

  const channelRows = useMemo(() => {
    return CHANNELS.map((ch) => {
      let inc = 0;
      let exp = 0;
      for (const t of monthTx) {
        if (t.type === 'transfer') continue;
        const w = wallets.find((x) => x.id === t.walletId);
        const code = t.channel || inferChannelFromWallet(w);
        if (code !== ch.code) continue;
        const v = txTHB(t, usdtRate);
        if (t.type === 'income') inc += v;
        else exp += v;
      }
      return { ...ch, income: round2(inc), expense: round2(exp) };
    }).filter((r) => r.income > 0 || r.expense > 0);
  }, [monthTx, wallets, usdtRate]);

  const handleExport = async (onlyMonth) => {
    if (exporting) return;
    setExporting(true);
    try {
      const mk = onlyMonth ? monthKey(sel.y, sel.m) : '';
      await exportCsv(mk);
      toast(onlyMonth ? `ส่งออก CSV เดือน${monthLabel(sel.y, sel.m, yf, true)}แล้ว` : 'ส่งออก CSV ทั้งหมดแล้ว');
    } catch (err) {
      toast(err.message || 'ส่งออก CSV ไม่สำเร็จ');
    } finally {
      setExporting(false);
    }
  };

  let acc = 0;
  const R = 52;
  const C = 2 * Math.PI * R;
  const grandTotal = scopeBalance(activeWallets, transactions, null, usdtRate);

  return (
    <main className="screen stack" style={{ gap: 16 }}>
      <header className="between" style={{ paddingTop: 4 }}>
        <h1 className="h1">
          {view === 'wallets' ? 'บัญชีวอลเล็ท' : view === 'summary' ? 'สรุปรายเดือน' : 'งบประมาณ'}
        </h1>
        {view === 'wallets' && (
          <button className="btn-ghost" onClick={() => setWForm({})}>
            <Plus size={16} strokeWidth={STROKE} /> เพิ่มบัญชี
          </button>
        )}
      </header>

      <div className="period-seg" role="tablist">
        <button role="tab" aria-selected={view === 'wallets'} className={view === 'wallets' ? 'on' : ''} onClick={() => setView('wallets')}>บัญชี</button>
        <button id="tab-summary-sub" role="tab" aria-selected={view === 'summary'} className={view === 'summary' ? 'on' : ''} onClick={() => setView('summary')}>สรุป & CSV</button>
        <button id="tab-budgets-sub" role="tab" aria-selected={view === 'budgets'} className={view === 'budgets' ? 'on' : ''} onClick={() => setView('budgets')}>งบประมาณ</button>
      </div>

      {view === 'wallets' ? (
        <div className="stack" style={{ gap: 14 }}>
          <section className="card hero-starry" style={{ padding: '18px' }}>
            <span className="label">ยอดรวมทุกบัญชี (บาท)</span>
            <div className="num-xl" style={{ marginTop: 4 }}>{hide ? HIDDEN : fmtTHB(grandTotal)}</div>
          </section>
          {GROUPS.map((g) => {
            const list = activeWallets.filter((w) => w.group === g.group);
            if (!list.length) return null;
            return (
              <section key={g.group} className="card" style={{ padding: '10px 12px' }}>
                <span className="label" style={{ paddingLeft: 4 }}>{g.label}</span>
                <div className="list">
                  {list.map((w) => {
                    const b = walletBalance(w, transactions);
                    const bThb = walletBalanceTHB(w, transactions, usdtRate);
                    return (
                      <button key={w.id} className="item" onClick={() => setWForm(w)}>
                        <WalletLogo code={w.providerCode} />
                        <div className="col grow" style={{ gap: 0 }}>
                          <span className="truncate">{w.name}</span>
                          <span className="label-xs num">{w.providerCode} · {w.currency || 'THB'}{w.last4 ? ` · ${maskLast4(w.last4)}` : ''}</span>
                        </div>
                        <div className="col" style={{ alignItems: 'flex-end', gap: 0 }}>
                          <span className="num-md" style={{ color: b < 0 ? 'var(--expense)' : 'var(--text)' }}>
                            {hide ? HIDDEN : fmtCurrency(b, w.currency)}
                          </span>
                          {w.currency === 'USDT' && !hide && <span className="label-xs num">≈ {fmtTHB(bThb)}</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
          {wForm && <WalletForm initial={wForm.id ? wForm : null} onClose={() => setWForm(null)} />}
        </div>
      ) : view === 'budgets' ? (
        <Budgets embedded />
      ) : (
        <>
          <section className="card between" style={{ padding: '10px 12px' }}>
            <button className="icon-btn plain" onClick={() => shiftMonth(-1)} aria-label="เดือนก่อนหน้า">
              <ChevronLeft size={20} strokeWidth={STROKE} />
            </button>
            <span style={{ fontWeight: 600, fontSize: 16 }}>{monthLabel(sel.y, sel.m, yf)}</span>
            <button className="icon-btn plain" onClick={() => shiftMonth(1)} aria-label="เดือนถัดไป">
              <ChevronRight size={20} strokeWidth={STROKE} />
            </button>
          </section>

          <section className="card stack" style={{ gap: 10 }}>
            <div className="between">
              <div className="col" style={{ gap: 0 }}>
                <span className="label-xs">รายรับเดือนนี้ (บาท)</span>
                <span className="num-lg income">{hide ? '••••' : fmtTHB(totals.income)}</span>
              </div>
              <div className="col" style={{ gap: 0, alignItems: 'flex-end' }}>
                <span className="label-xs">รายจ่ายเดือนนี้ (บาท)</span>
                <span className="num-lg expense">{hide ? '••••' : fmtTHB(totals.expense)}</span>
              </div>
            </div>
            <div className="between" style={{ paddingTop: 10, borderTop: '1px solid var(--line-2)' }}>
              <span className="label">คงเหลือสุทธิ ({monthTx.length} รายการ)</span>
              <span className={`num-md ${net >= 0 ? 'income' : 'expense'}`}>{hide ? '••••' : fmtTHB(net)}</span>
            </div>
            <div className="row" style={{ gap: 10, marginTop: 2 }}>
              <button id="btn-export-csv" className="btn-gold grow" style={{ minHeight: 46, fontSize: 14 }} disabled={exporting} onClick={() => handleExport(true)}>
                <Download size={18} strokeWidth={STROKE} /> ส่งออก CSV เดือนนี้
              </button>
              <button id="btn-export-csv-all" className="btn-ghost" disabled={exporting} onClick={() => handleExport(false)}>
                <FileSpreadsheet size={18} strokeWidth={STROKE} /> ทั้งหมด
              </button>
            </div>
          </section>

          <section className="card stack" style={{ gap: 10 }}>
            <div className="between">
              <h2 className="h2">กราฟรายรับ-รายจ่ายรายเดือน</h2>
              <span className="label-xs">6 เดือน</span>
            </div>
            <MonthlyBarChart series={series} />
            <div className="legend">
              <span><i style={{ background: COLORS.income }} />รายรับ</span>
              <span><i style={{ background: COLORS.expense }} />รายจ่าย</span>
            </div>
          </section>

          <section className="card stack" style={{ gap: 12 }}>
            <div className="between">
              <h2 className="h2">สัดส่วนตามหมวดหมู่</h2>
              <div className="seg" style={{ width: 176 }}>
                <button className={catType === 'expense' ? 'on t-expense' : ''} onClick={() => setCatType('expense')}>รายจ่าย</button>
                <button className={catType === 'income' ? 'on t-income' : ''} onClick={() => setCatType('income')}>รายรับ</button>
              </div>
            </div>

            {catRows.length === 0 ? (
              <div className="empty">ไม่มีรายการ{catType === 'expense' ? 'รายจ่าย' : 'รายรับ'}ในเดือนนี้</div>
            ) : (
              <>
                <div style={{ position: 'relative', width: 164, height: 164, margin: '4px auto' }}>
                  <svg viewBox="0 0 140 140" width="164" height="164" style={{ transform: 'rotate(-90deg)' }} role="img" aria-label="สัดส่วนตามหมวดหมู่">
                    <circle cx="70" cy="70" r={R} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="16" />
                    {catRows.map((r, i) => {
                      const len = (r.v / catTotal) * C;
                      const el = (
                        <circle
                          key={i}
                          cx="70"
                          cy="70"
                          r={R}
                          fill="none"
                          stroke={r.cat?.color || '#7A8497'}
                          strokeWidth="16"
                          strokeDasharray={`${len} ${C - len}`}
                          strokeDashoffset={-acc}
                        />
                      );
                      acc += len;
                      return el;
                    })}
                  </svg>
                  <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
                    <div className="col" style={{ gap: 0, alignItems: 'center' }}>
                      <span className="label-xs">รวม</span>
                      <span className={`num-md ${catType}`}>{hide ? '••••' : fmtTHB(catTotal)}</span>
                    </div>
                  </div>
                </div>

                <div className="list">
                  {catRows.map((r, i) => (
                    <div key={i} className="item" style={{ cursor: 'default' }}>
                      <CategoryIcon cat={r.cat} />
                      <div className="col grow" style={{ gap: 4 }}>
                        <div className="between">
                          <span className="truncate">{r.cat?.name || 'ไม่ระบุ'}</span>
                          <span className={`num-md ${catType}`}>{hide ? '••••' : fmtTHB(r.v)}</span>
                        </div>
                        <div className="between" style={{ gap: 10 }}>
                          <div className="progress grow"><i style={{ width: `${(r.v / catTotal) * 100}%`, background: r.cat?.color || '#7A8497' }} /></div>
                          <span className="label-xs num" style={{ width: 52, textAlign: 'right' }}>{((r.v / catTotal) * 100).toFixed(1)}%</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          {channelRows.length > 0 && (
            <section className="card stack" style={{ gap: 8 }}>
              <h2 className="h2">สรุปตามช่องทาง</h2>
              <div className="list">
                {channelRows.map((ch) => (
                  <div key={ch.code} className="item" style={{ cursor: 'default' }}>
                    <span className="icon-btn" style={{ color: 'var(--gold)' }}><Icon name={ch.icon} size={18} /></span>
                    <span className="grow">{ch.label}</span>
                    <div className="col" style={{ alignItems: 'flex-end', gap: 0 }}>
                      {ch.income > 0 && <span className="num-md income">{hide ? '••••' : `+ ${fmtTHB(ch.income)}`}</span>}
                      {ch.expense > 0 && <span className="num-md expense">{hide ? '••••' : `- ${fmtTHB(ch.expense)}`}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
