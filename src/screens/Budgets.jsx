import { useState } from 'react';
import { Plus, AlertTriangle, OctagonAlert } from 'lucide-react';
import { useStore } from '../lib/store';
import { categorySpent, budgetLevel } from '../lib/calc';
import { fmtTHB, monthLabel, daysInMonth } from '../lib/format';
import { CategoryIcon, STROKE } from '../components/ui';
import { BudgetForm } from '../components/forms';

const LEVEL_COLOR = { ok: 'var(--ok)', warn: 'var(--warn)', over: 'var(--expense)' };

export default function Budgets({ embedded = false }) {
  const { activeBudgets, categories, transactions, settings, usdtRate } = useStore();
  const [form, setForm] = useState(null); // null | {} | budget
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const hide = settings.hideBalance;

  const rows = activeBudgets
    .map((b) => {
      const cat = categories.find((c) => c.id === b.categoryId);
      const spent = categorySpent(transactions, b.categoryId, y, m, usdtRate);
      return { b, cat, spent, ...budgetLevel(spent, b.amount) };
    })
    .sort((a, b) => b.pct - a.pct);

  const totalBudget = rows.reduce((s, r) => s + r.b.amount, 0);
  const totalSpent = rows.reduce((s, r) => s + r.spent, 0);
  const totalLv = budgetLevel(totalSpent, totalBudget);
  const daysLeft = daysInMonth(y, m) - now.getDate() + 1;

  const content = (
    <>
      <div className="between">
        <span className="label-xs">{monthLabel(y, m, settings.yearFormat)} · เหลือ {daysLeft} วัน</span>
        <button id="btn-add-budget" className="btn-ghost" onClick={() => setForm({})}><Plus size={18} strokeWidth={STROKE} /> เพิ่มงบประมาณ</button>
      </div>

      {rows.length > 0 && (
        <section className="card" style={{ background: 'linear-gradient(135deg, rgba(212,175,55,.12), rgba(11,22,48,.7) 60%), var(--glass)' }}>
          <div className="between">
            <span className="label">ใช้ไปแล้ว / งบรวม</span>
            <span className="label-xs num">{totalLv.pct.toFixed(0)}%</span>
          </div>
          <div className="row" style={{ alignItems: 'baseline', gap: 8, margin: '4px 0 10px', flexWrap: 'wrap' }}>
            <span className="num-lg expense">{hide ? '••••' : fmtTHB(totalSpent)}</span>
            <span className="label num">/ {hide ? '••••' : fmtTHB(totalBudget)}</span>
          </div>
          <div className="progress"><i style={{ width: `${Math.min(100, totalLv.pct)}%`, background: LEVEL_COLOR[totalLv.level] }} /></div>
        </section>
      )}

      {rows.length === 0 ? (
        <div className="empty">
          ยังไม่ได้ตั้งงบประมาณรายหมวด
          <button className="btn-gold" style={{ maxWidth: 240 }} onClick={() => setForm({})}><Plus size={18} strokeWidth={STROKE} /> เพิ่มงบประมาณ</button>
        </div>
      ) : (
        rows.map(({ b, cat, spent, pct, level }) => {
          const left = b.amount - spent;
          return (
            <button key={b.id} className={`card ${level === 'ok' ? '' : level}`} style={{ textAlign: 'left', width: '100%' }} onClick={() => setForm(b)}>
              <div className="row">
                <CategoryIcon cat={cat} />
                <div className="col grow" style={{ gap: 0 }}>
                  <span className="truncate" style={{ fontWeight: 500 }}>{cat?.name}</span>
                  <span className="label-xs">งบ <span className="num">{hide ? '••••' : fmtTHB(b.amount)}</span></span>
                </div>
                {level === 'warn' && <span className="chip warn"><AlertTriangle size={14} strokeWidth={STROKE} />ใกล้ถึงลิมิต</span>}
                {level === 'over' && <span className="chip over"><OctagonAlert size={14} strokeWidth={STROKE} />เกินงบแล้ว</span>}
              </div>
              <div className="progress" style={{ margin: '12px 0 8px' }}>
                <i style={{ width: `${Math.min(100, pct)}%`, background: LEVEL_COLOR[level] }} />
              </div>
              <div className="between">
                <span className="label-xs">ใช้ไป <span className="num">{hide ? '••••' : fmtTHB(spent)}</span> ({pct.toFixed(0)}%)</span>
                {left >= 0 ? (
                  <span className="label" style={{ color: LEVEL_COLOR[level] }}>เหลือ <b className="num">{hide ? '••••' : fmtTHB(left)}</b></span>
                ) : (
                  <span className="label expense">เกินไป <b className="num">{hide ? '••••' : fmtTHB(left)}</b></span>
                )}
              </div>
            </button>
          );
        })
      )}

      {form && <BudgetForm initial={form.id ? form : null} onClose={() => setForm(null)} />}
    </>
  );

  if (embedded) return <div className="stack" style={{ gap: 14 }}>{content}</div>;
  return (
    <main className="screen stack" style={{ gap: 16 }}>
      <h1 className="h1" style={{ paddingTop: 4 }}>งบประมาณ</h1>
      {content}
    </main>
  );
}
