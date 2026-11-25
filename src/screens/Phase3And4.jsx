import { useMemo, useState } from 'react';
import {
  Lock,
  Delete,
  Plus,
  Play,
  Trash2,
  RotateCcw,
  History,
  Download,
  Send,
  BellRing,
  CheckCircle2,
  ShieldCheck,
} from 'lucide-react';
import { useStore } from '../lib/store';
import { txTHB, collectAllTags } from '../lib/calc';
import { fmtTHB, fmtCurrency, dateTimeLabel, round2 } from '../lib/format';
import { Sheet, CategoryIcon, Switch, useUi, STROKE } from '../components/ui';
import { haptic } from '../lib/telegram';

/* ======================= 1. Luxury PIN Lock Screen ======================= */
export function PinLockScreen() {
  const { verifyPin } = useStore();
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const press = async (d) => {
    if (busy || pin.length >= 6) return;
    const next = pin + d;
    setPin(next);
    setErr('');
    haptic('light');
  };

  const submit = async (code = pin) => {
    if (code.length < 4 || busy) return;
    setBusy(true);
    try {
      await verifyPin(code);
      haptic('success');
    } catch (e) {
      haptic('error');
      setErr(e.message || 'รหัส PIN ไม่ถูกต้อง');
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pin-screen">
      <span className="icon-btn" style={{ width: 56, height: 56, borderRadius: '50%', color: 'var(--gold)' }}>
        <Lock size={26} strokeWidth={STROKE} />
      </span>
      <div className="col" style={{ alignItems: 'center', gap: 4 }}>
        <span className="en gold" style={{ fontWeight: 600, fontSize: 14, letterSpacing: '0.14em' }}>CE MONEY TRACKER PRO</span>
        <h1 className="h1">กรอกรหัส PIN เพื่อปลดล็อก</h1>
        <span className="label-xs" style={{ color: err ? 'var(--expense)' : 'var(--text-3)' }}>
          {err || 'รหัสผ่านตัวเลข 4–6 หลักของคุณ'}
        </span>
      </div>

      <div className="pin-dots" aria-label={`กรอกแล้ว ${pin.length} หลัก`}>
        {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
          <i key={i} className={i < pin.length ? 'filled' : ''} />
        ))}
      </div>

      <div className="pin-pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => (
          <button key={n} id={`pin-key-${n}`} type="button" className="pin-key" onClick={() => press(n)}>
            {n}
          </button>
        ))}
        <button
          type="button"
          className="pin-key"
          style={{ fontSize: 14, fontFamily: 'var(--f-th)', color: 'var(--text-2)' }}
          onClick={() => { setPin(''); setErr(''); }}
        >
          ล้าง
        </button>
        <button id="pin-key-0" type="button" className="pin-key" onClick={() => press('0')}>
          0
        </button>
        <button
          type="button"
          className="pin-key"
          aria-label="ลบตัวเลข"
          onClick={() => setPin((p) => p.slice(0, -1))}
        >
          <Delete size={22} strokeWidth={STROKE} />
        </button>
      </div>

      <button
        id="btn-pin-unlock"
        type="button"
        className="btn-gold"
        style={{ maxWidth: 290 }}
        disabled={pin.length < 4 || busy}
        onClick={() => submit(pin)}
      >
        {busy ? 'กำลังตรวจสอบ…' : 'ปลดล็อก'}
      </button>
    </div>
  );
}

/* ======================= 2. Recurring Transactions Page (รายการประจำ) ======================= */
const FREQ_LABELS = { daily: 'รายวัน', weekly: 'รายสัปดาห์', monthly: 'รายเดือน', yearly: 'รายปี' };

export function RecurringPage({ onClose }) {
  const { activeRecurring, categories, wallets, saveRecurring, runRecurringNow } = useStore();
  const { toast } = useUi();
  const [form, setForm] = useState(null);

  const handleRunNow = async (r) => {
    await runRecurringNow(r.id);
    haptic('success');
    toast('บันทึกรายการประจำเข้าบัญชีแล้ว');
  };

  return (
    <Sheet
      title="รายการประจำ"
      onClose={onClose}
      full
      right={
        <button id="btn-add-recurring" className="icon-btn" onClick={() => setForm({})} aria-label="เพิ่มรายการประจำ">
          <Plus size={20} strokeWidth={STROKE} />
        </button>
      }
    >
      <div className="stack">
        <p className="label" style={{ margin: 0 }}>
          ระบบจะสร้างรายการให้อัตโนมัติเมื่อถึงกำหนดนัดหมาย หรือกดปุ่มเล่นเพื่อบันทึกทันที
        </p>

        {activeRecurring.length === 0 ? (
          <div className="empty">
            ยังไม่มีรายการประจำ (เช่น ค่าเช่า ค่าเซิร์ฟเวอร์ เงินเดือน)
            <button className="btn-gold" style={{ maxWidth: 240 }} onClick={() => setForm({})}>
              <Plus size={18} strokeWidth={STROKE} /> เพิ่มรายการประจำ
            </button>
          </div>
        ) : (
          activeRecurring.map((r) => {
            const cat = categories.find((c) => c.id === r.categoryId);
            const w = wallets.find((x) => x.id === r.walletId);
            return (
              <div key={r.id} className="card stack" style={{ gap: 10, opacity: r.active ? 1 : 0.6 }}>
                <div className="row">
                  <button type="button" className="row grow" style={{ textAlign: 'left', gap: 12 }} onClick={() => setForm(r)}>
                    <CategoryIcon cat={cat} transfer={r.type === 'transfer'} />
                    <div className="col grow" style={{ gap: 0 }}>
                      <span className="truncate" style={{ fontWeight: 600 }}>{r.note || cat?.name || 'รายการประจำ'}</span>
                      <span className="label-xs">
                        {FREQ_LABELS[r.frequency] || r.frequency} · ถัดไป {r.nextRunDate} · {w?.name || ''}
                      </span>
                    </div>
                  </button>
                  <span className={`num-md ${r.type}`}>{fmtCurrency(r.amount, r.currency)}</span>
                </div>
                <div className="between" style={{ paddingTop: 8, borderTop: '1px solid var(--line-2)' }}>
                  <div className="row" style={{ gap: 8 }}>
                    <Switch
                      on={r.active}
                      onChange={(v) => saveRecurring({ ...r, active: v })}
                      label="เปิดใช้งานรายการประจำ"
                    />
                    <span className="label-xs">{r.active ? 'ทำงานอัตโนมัติ' : 'หยุดชั่วคราว'}</span>
                  </div>
                  <button type="button" className="btn-ghost" style={{ minHeight: 36, padding: '0 12px' }} onClick={() => handleRunNow(r)}>
                    <Play size={14} strokeWidth={STROKE} /> บันทึกตอนนี้
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {form && <RecurringForm initial={form.id ? form : null} onClose={() => setForm(null)} />}
    </Sheet>
  );
}

function RecurringForm({ initial, onClose }) {
  const { activeWallets, categories, usdtRate, saveRecurring, deleteRecurring } = useStore();
  const { confirm, toast } = useUi();
  const [type, setType] = useState(initial?.type || 'expense');
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [currency, setCurrency] = useState(initial?.currency || 'THB');
  const [categoryId, setCategoryId] = useState(initial?.categoryId || categories.find((c) => c.type === 'expense' && !c.deletedAt)?.id || '');
  const [walletId, setWalletId] = useState(initial?.walletId || activeWallets[0]?.id || '');
  const [frequency, setFrequency] = useState(initial?.frequency || 'monthly');
  const [nextRunDate, setNextRunDate] = useState(initial?.nextRunDate || new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState(initial?.note || '');

  const amt = parseFloat(String(amount).replace(/,/g, '')) || 0;
  const cats = categories.filter((c) => c.type === type && !c.deletedAt);

  const save = async () => {
    if (!(amt > 0) || !walletId) return;
    await saveRecurring({
      id: initial?.id,
      type,
      amount: amt,
      currency,
      fxRate: currency === 'USDT' ? usdtRate : 1,
      categoryId: categoryId || cats[0]?.id || 'exp-other',
      walletId,
      frequency,
      nextRunDate,
      note: note.trim(),
      active: initial ? initial.active : true,
    });
    toast('บันทึกรายการประจำแล้ว');
    onClose();
  };

  const del = async () => {
    const ok = await confirm({ title: 'ลบรายการประจำนี้?', message: 'ย้ายไปยังถังขยะ (กู้คืนได้)', okText: 'ลบ', danger: true });
    if (!ok) return;
    await deleteRecurring(initial.id);
    toast('ย้ายรายการประจำไปถังขยะแล้ว');
    onClose();
  };

  return (
    <Sheet title={initial ? 'แก้ไขรายการประจำ' : 'เพิ่มรายการประจำ'} onClose={onClose}>
      <div className="stack">
        <div className="seg">
          <button type="button" className={type === 'expense' ? 'on t-expense' : ''} onClick={() => { setType('expense'); setCategoryId(''); }}>รายจ่าย</button>
          <button type="button" className={type === 'income' ? 'on t-income' : ''} onClick={() => { setType('income'); setCategoryId(''); }}>รายรับ</button>
        </div>

        <div className="field">
          <div className="between">
            <label className="label" htmlFor="rec-amount">จำนวนเงิน ({currency})</label>
            <div className="seg" style={{ width: 128, padding: 2 }}>
              <button type="button" style={{ minHeight: 30 }} className={currency === 'THB' ? 'on' : ''} onClick={() => setCurrency('THB')}>THB</button>
              <button type="button" style={{ minHeight: 30 }} className={currency === 'USDT' ? 'on' : ''} onClick={() => setCurrency('USDT')}>USDT</button>
            </div>
          </div>
          <input id="rec-amount" inputMode="decimal" className="num" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))} />
        </div>

        <div className="field">
          <label className="label" htmlFor="rec-note">ชื่อรายการประจำ / โน้ต</label>
          <input id="rec-note" placeholder="เช่น ค่าเช่าเซิร์ฟเวอร์รายเดือน" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <div className="field">
          <label className="label" htmlFor="rec-freq">ความถี่</label>
          <select id="rec-freq" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
            <option value="daily">รายวัน</option>
            <option value="weekly">รายสัปดาห์</option>
            <option value="monthly">รายเดือน</option>
            <option value="yearly">รายปี</option>
          </select>
        </div>

        <div className="field">
          <label className="label" htmlFor="rec-next">วันที่เริ่ม / รอบถัดไป</label>
          <input id="rec-next" type="date" value={nextRunDate} onChange={(e) => setNextRunDate(e.target.value)} />
        </div>

        <div className="field">
          <label className="label" htmlFor="rec-cat">หมวดหมู่</label>
          <select id="rec-cat" value={categoryId || cats[0]?.id || ''} onChange={(e) => setCategoryId(e.target.value)}>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div className="field">
          <label className="label" htmlFor="rec-wallet">วอลเล็ท</label>
          <select id="rec-wallet" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
            {activeWallets.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.currency})</option>)}
          </select>
        </div>

        <button id="rec-save" className="btn-gold" disabled={!(amt > 0)} onClick={save}>บันทึก</button>
        {initial && <button className="btn-danger" onClick={del}><Trash2 size={18} strokeWidth={STROKE} /> ลบรายการประจำ</button>}
      </div>
    </Sheet>
  );
}

/* ======================= 3. Advanced Reports & Export Page (รายงานและส่งออก) ======================= */
export function AdvancedReportsPage({ onClose }) {
  const { activeTx, activeWallets, categories, usdtRate, exportCsv, exportBackup } = useStore();
  const { toast } = useUi();

  const today = new Date();
  const firstOfMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(todayStr);
  const [type, setType] = useState('all');
  const [walletId, setWalletId] = useState('all');
  const [tag, setTag] = useState('all');

  const allTags = useMemo(() => collectAllTags(activeTx), [activeTx]);

  const filtered = useMemo(() => {
    return activeTx.filter((t) => {
      const ymd = t.date.slice(0, 10);
      if (from && ymd < from) return false;
      if (to && ymd > to) return false;
      if (type !== 'all' && t.type !== type) return false;
      if (walletId !== 'all' && t.walletId !== walletId && t.toWalletId !== walletId) return false;
      if (tag !== 'all' && !(t.tags || []).includes(tag)) return false;
      return true;
    });
  }, [activeTx, from, to, type, walletId, tag]);

  const stats = useMemo(() => {
    let inc = 0;
    let exp = 0;
    const byTag = new Map();
    const byCat = new Map();
    for (const t of filtered) {
      const v = txTHB(t, usdtRate);
      if (t.type === 'income') inc += v;
      else if (t.type === 'expense') {
        exp += v;
        byCat.set(t.categoryId, (byCat.get(t.categoryId) || 0) + v);
      }
      for (const tg of t.tags || []) {
        byTag.set(tg, (byTag.get(tg) || 0) + (t.type === 'income' ? v : -v));
      }
    }
    return {
      income: round2(inc),
      expense: round2(exp),
      net: round2(inc - exp),
      topCats: [...byCat.entries()]
        .map(([id, val]) => ({ cat: categories.find((c) => c.id === id), val: round2(val) }))
        .sort((a, b) => b.val - a.val),
      tagRows: [...byTag.entries()].map(([tg, val]) => ({ tag: tg, val: round2(val) })),
    };
  }, [filtered, usdtRate, categories]);

  const doCsv = async () => {
    await exportCsv({ from, to, type, walletId, tag });
    toast('ดาวน์โหลดไฟล์ CSV ตามเงื่อนไขแล้ว');
  };

  const doJson = async () => {
    const blob = await exportBackup();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ce-money-tracker-backup-${todayStr}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('ดาวน์โหลดไฟล์สำรอง JSON แล้ว');
  };

  return (
    <Sheet title="รายงานและส่งออกขั้นสูง" onClose={onClose} full>
      <div className="stack">
        <section className="card stack" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 10 }}>
            <div className="field grow">
              <label className="label" htmlFor="rep-from">ตั้งแต่วันที่</label>
              <input id="rep-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="field grow">
              <label className="label" htmlFor="rep-to">ถึงวันที่</label>
              <input id="rep-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>

          <div className="row" style={{ gap: 10 }}>
            <div className="field grow">
              <label className="label" htmlFor="rep-wallet">วอลเล็ท</label>
              <select id="rep-wallet" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
                <option value="all">ทุกวอลเล็ท</option>
                {activeWallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div className="field grow">
              <label className="label" htmlFor="rep-tag">แท็ก</label>
              <select id="rep-tag" value={tag} onChange={(e) => setTag(e.target.value)}>
                <option value="all">ทุกแท็ก</option>
                {allTags.map((tg) => <option key={tg} value={tg}>#{tg}</option>)}
              </select>
            </div>
          </div>

          <div className="seg">
            <button type="button" className={type === 'all' ? 'on' : ''} onClick={() => setType('all')}>ทั้งหมด</button>
            <button type="button" className={type === 'expense' ? 'on t-expense' : ''} onClick={() => setType('expense')}>รายจ่าย</button>
            <button type="button" className={type === 'income' ? 'on t-income' : ''} onClick={() => setType('income')}>รายรับ</button>
            <button type="button" className={type === 'transfer' ? 'on t-transfer' : ''} onClick={() => setType('transfer')}>โอน</button>
          </div>
        </section>

        <section className="card stack" style={{ gap: 8 }}>
          <span className="label">ผลลัพธ์ ({filtered.length} รายการ · คำนวณมูลค่าเป็นบาท)</span>
          <div className="between">
            <span className="label-xs">รายรับรวม</span>
            <span className="num-md income">{fmtTHB(stats.income)}</span>
          </div>
          <div className="between">
            <span className="label-xs">รายจ่ายรวม</span>
            <span className="num-md expense">{fmtTHB(stats.expense)}</span>
          </div>
          <div className="between" style={{ paddingTop: 6, borderTop: '1px solid var(--line-2)' }}>
            <span className="label">สุทธิ</span>
            <span className={`num-lg ${stats.net >= 0 ? 'income' : 'expense'}`}>{fmtTHB(stats.net)}</span>
          </div>
          <div className="row" style={{ gap: 10, marginTop: 6 }}>
            <button id="btn-adv-csv" className="btn-gold grow" onClick={doCsv}>
              <Download size={18} strokeWidth={STROKE} /> ส่งออก CSV ตามตัวกรอง
            </button>
            <button className="btn-ghost" onClick={doJson}>JSON</button>
          </div>
        </section>

        {stats.tagRows.length > 0 && (
          <section className="card stack" style={{ gap: 8 }}>
            <h3 className="h2">สรุปยอดสุทธิตามแท็ก</h3>
            <div className="list">
              {stats.tagRows.map((r) => (
                <div key={r.tag} className="between" style={{ minHeight: 40 }}>
                  <span className="tag-chip">#{r.tag}</span>
                  <span className={`num-md ${r.val >= 0 ? 'income' : 'expense'}`}>{fmtTHB(r.val)}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {stats.topCats.length > 0 && (
          <section className="card stack" style={{ gap: 8 }}>
            <h3 className="h2">รายจ่ายสูงสุดตามหมวด</h3>
            <div className="list">
              {stats.topCats.map((r, i) => (
                <div key={i} className="item" style={{ cursor: 'default' }}>
                  <CategoryIcon cat={r.cat} />
                  <span className="grow truncate">{r.cat?.name || 'อื่นๆ'}</span>
                  <span className="num-md expense">{fmtTHB(r.val)}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </Sheet>
  );
}

/* ======================= 4. Security & PIN Page (ความปลอดภัย) ======================= */
export function SecurityPinPage({ onClose }) {
  const { hasPin, setPinCode, removePinCode, lockNow } = useStore();
  const { toast } = useUi();
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSet = async () => {
    if (!/^\d{4,6}$/.test(newPin)) return toast('กรุณาตั้งรหัส PIN ตัวเลข 4–6 หลัก');
    if (newPin !== confirmPin) return toast('รหัส PIN ยืนยันไม่ตรงกัน');
    setBusy(true);
    try {
      await setPinCode(currentPin, newPin);
      toast(hasPin ? 'เปลี่ยนรหัส PIN สำเร็จ' : 'เปิดใช้งานรหัส PIN สำเร็จ');
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
    } catch (e) {
      toast(e.message || 'ตั้งรหัส PIN ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (!currentPin) return toast('กรุณากรอกรหัส PIN ปัจจุบันเพื่อปิดใช้งาน');
    setBusy(true);
    try {
      await removePinCode(currentPin);
      toast('ปิดการใช้รหัส PIN แล้ว');
      setCurrentPin('');
    } catch (e) {
      toast(e.message || 'รหัส PIN ปัจจุบันไม่ถูกต้อง');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="ความปลอดภัยและรหัส PIN" onClose={onClose} full>
      <div className="stack">
        <section className="card stack" style={{ gap: 10 }}>
          <div className="between">
            <div className="row" style={{ gap: 10 }}>
              <ShieldCheck size={22} strokeWidth={STROKE} className="gold" />
              <div className="col" style={{ gap: 0 }}>
                <span style={{ fontWeight: 600 }}>ล็อกแอปด้วยรหัส PIN</span>
                <span className="label-xs">{hasPin ? 'เปิดใช้งานอยู่ (เข้ารหัสแบบ Scrypt)' : 'ยังไม่ได้ตั้งรหัส PIN'}</span>
              </div>
            </div>
            {hasPin && (
              <button
                id="btn-lock-now"
                type="button"
                className="btn-ghost"
                onClick={() => { onClose(); lockNow(); }}
              >
                <Lock size={16} strokeWidth={STROKE} /> ล็อกทันที
              </button>
            )}
          </div>

          {hasPin && (
            <div className="field">
              <label className="label" htmlFor="pin-cur">รหัส PIN ปัจจุบัน</label>
              <input id="pin-cur" type="password" inputMode="numeric" maxLength={6} className="num" placeholder="••••" value={currentPin} onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))} />
            </div>
          )}

          <div className="field">
            <label className="label" htmlFor="pin-new">{hasPin ? 'รหัส PIN ใหม่ (4–6 หลัก)' : 'ตั้งรหัส PIN (ตัวเลข 4–6 หลัก)'}</label>
            <input id="pin-new" type="password" inputMode="numeric" maxLength={6} className="num" placeholder="••••" value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))} />
          </div>

          <div className="field">
            <label className="label" htmlFor="pin-confirm">ยืนยันรหัส PIN อีกครั้ง</label>
            <input id="pin-confirm" type="password" inputMode="numeric" maxLength={6} className="num" placeholder="••••" value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))} />
          </div>

          <button id="btn-save-pin" className="btn-gold" disabled={busy || newPin.length < 4} onClick={handleSet}>
            {hasPin ? 'เปลี่ยนรหัส PIN' : 'ตั้งรหัส PIN'}
          </button>

          {hasPin && (
            <button id="btn-remove-pin" className="btn-danger" disabled={busy || !currentPin} onClick={handleRemove}>
              ปิดใช้งานรหัส PIN
            </button>
          )}
        </section>

        <section className="card stack" style={{ gap: 8 }}>
          <span style={{ fontWeight: 600 }}>มาตรฐานความปลอดภัยระบบ</span>
          <span className="label">• ตรวจ Telegram initData HMAC-SHA256 ด้วย BOT_TOKEN ที่เซิร์ฟเวอร์ทุกครั้ง</span>
          <span className="label">• รหัส PIN จัดเก็บแบบ Salted Scrypt Hash และจำกัดจำนวนครั้งที่เดาผิด</span>
          <span className="label">• ไฟล์สลิปเก็บในพื้นที่ส่วนตัว เข้าดูได้เฉพาะเจ้าของบัญชี</span>
          <span className="label">• ปิดบังเลขบัญชีอัตโนมัติใน Log และเก็บเฉพาะเลขท้าย 4 ตัว</span>
        </section>
      </div>
    </Sheet>
  );
}

/* ======================= 5. Trash & Edit History Page (ถังขยะ + ประวัติการแก้ไข) ======================= */
export function TrashAndHistoryPage({ onClose }) {
  const { transactions, wallets, categories, budgets, recurring, history, settings, restoreTrashItem } = useStore();
  const { toast } = useUi();
  const [tab, setTab] = useState('trash');

  const deletedItems = useMemo(() => {
    const out = [];
    for (const t of transactions) {
      if (t.deletedAt) {
        const c = categories.find((x) => x.id === t.categoryId);
        out.push({
          kind: 'transaction',
          id: t.id,
          title: `${t.type === 'transfer' ? 'โอนเงิน' : c?.name || 'ธุรกรรม'} · ${fmtCurrency(t.amount, t.currency)}`,
          sub: `${t.note || ''} · ลบเมื่อ ${dateTimeLabel(t.deletedAt, settings.yearFormat)}`,
          deletedAt: t.deletedAt,
        });
      }
    }
    for (const w of wallets) {
      if (w.deletedAt) out.push({ kind: 'wallet', id: w.id, title: `วอลเล็ท: ${w.name}`, sub: `ลบเมื่อ ${dateTimeLabel(w.deletedAt, settings.yearFormat)}`, deletedAt: w.deletedAt });
    }
    for (const c of categories) {
      if (c.deletedAt) out.push({ kind: 'category', id: c.id, title: `หมวดหมู่: ${c.name}`, sub: `ลบเมื่อ ${dateTimeLabel(c.deletedAt, settings.yearFormat)}`, deletedAt: c.deletedAt });
    }
    for (const b of budgets) {
      if (b.deletedAt) {
        const c = categories.find((x) => x.id === b.categoryId);
        out.push({ kind: 'budget', id: b.id, title: `งบประมาณ: ${c?.name || ''}`, sub: fmtTHB(b.amount), deletedAt: b.deletedAt });
      }
    }
    for (const r of recurring) {
      if (r.deletedAt) out.push({ kind: 'recurring', id: r.id, title: `รายการประจำ: ${r.note || fmtCurrency(r.amount, r.currency)}`, sub: r.frequency, deletedAt: r.deletedAt });
    }
    return out.sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));
  }, [transactions, wallets, categories, budgets, recurring, settings.yearFormat]);

  const handleRestore = async (item) => {
    await restoreTrashItem(item.kind, item.id);
    haptic('success');
    toast('กู้คืนข้อมูลเรียบร้อยแล้ว');
  };

  const actionLabel = { create: 'สร้างรายการ', update: 'แก้ไขรายการ', delete: 'ย้ายไปถังขยะ', restore: 'กู้คืนจากถังขยะ' };

  return (
    <Sheet title="ถังขยะและประวัติการแก้ไข" onClose={onClose} full>
      <div className="stack">
        <div className="seg">
          <button type="button" className={tab === 'trash' ? 'on' : ''} onClick={() => setTab('trash')}>ถังขยะ ({deletedItems.length})</button>
          <button type="button" id="tab-audit-history" className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>ประวัติการแก้ไข ({history.length})</button>
        </div>

        {tab === 'trash' ? (
          deletedItems.length === 0 ? (
            <div className="empty">ไม่มีรายการในถังขยะ (ข้อมูลทุกรายการที่ลบจะถูกเก็บไว้ที่นี่เพื่อกู้คืนได้เสมอ)</div>
          ) : (
            <section className="card" style={{ padding: '6px 12px' }}>
              <div className="list">
                {deletedItems.map((it) => (
                  <div key={`${it.kind}-${it.id}`} className="item" style={{ cursor: 'default' }}>
                    <div className="col grow" style={{ gap: 2 }}>
                      <span className="truncate" style={{ fontWeight: 500 }}>{it.title}</span>
                      <span className="label-xs truncate">{it.sub}</span>
                    </div>
                    <button
                      type="button"
                      className="btn-ghost btn-restore-item"
                      style={{ minHeight: 38, padding: '0 12px' }}
                      onClick={() => handleRestore(it)}
                    >
                      <RotateCcw size={15} strokeWidth={STROKE} /> กู้คืน
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )
        ) : history.length === 0 ? (
          <div className="empty"><History size={22} strokeWidth={STROKE} />ยังไม่มีประวัติการแก้ไข</div>
        ) : (
          <section className="card" style={{ padding: '6px 12px' }}>
            <div className="list">
              {history.map((h) => (
                <div key={h.id} className="item" style={{ cursor: 'default', alignItems: 'flex-start' }}>
                  <div className="col grow" style={{ gap: 2 }}>
                    <div className="between">
                      <span style={{ fontWeight: 500 }}>{actionLabel[h.action] || h.action}</span>
                      <span className="label-xs">{dateTimeLabel(h.changedAt, settings.yearFormat)}</span>
                    </div>
                    <span className="label-xs">{h.summary}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </Sheet>
  );
}

/* ======================= 6. Phase 4 Telegram Bot Page (บอทแจ้งเตือน) ======================= */
export function BotSettingsPage({ onClose }) {
  const { serverUser, botPrefs, botConfigured, updateBotPrefs, sendBotTest } = useStore();
  const { toast } = useUi();
  const [chatId, setChatId] = useState(serverUser?.telegramId || '');
  const [sending, setSending] = useState(false);

  const toggle = async (patch) => {
    await updateBotPrefs(patch);
    toast('บันทึกการตั้งค่าแจ้งเตือนแล้ว');
  };

  const handleTest = async () => {
    setSending(true);
    try {
      if (chatId) await updateBotPrefs({ telegramChatId: chatId });
      await sendBotTest(chatId);
      haptic('success');
      toast('ส่งข้อความเข้า Telegram สำเร็จ!');
    } catch (e) {
      toast(e.message || 'ส่งข้อความไม่สำเร็จ');
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet title="บอทแจ้งเตือน Telegram" onClose={onClose} full>
      <div className="stack">
        <section className="card row" style={{ gap: 12 }}>
          <BellRing size={24} strokeWidth={STROKE} className={botConfigured ? 'income' : 'gold'} />
          <div className="col grow" style={{ gap: 2 }}>
            <div className="row" style={{ gap: 6 }}>
              <span style={{ fontWeight: 600 }}>สถานะ BOT_TOKEN (ฝั่งเซิร์ฟเวอร์)</span>
              {botConfigured && <CheckCircle2 size={16} strokeWidth={STROKE} className="income" />}
            </div>
            <span className="label-xs">
              {botConfigured
                ? 'เชื่อมต่อ BOT_TOKEN จาก Environment Variable พร้อมส่งแจ้งเตือนแล้ว'
                : 'ยังไม่ได้ตั้งค่า BOT_TOKEN ใน Environment Variable ของเซิร์ฟเวอร์'}
            </span>
          </div>
        </section>

        <section className="card stack" style={{ gap: 12 }}>
          <div className="between">
            <div className="col" style={{ gap: 0 }}>
              <span>แจ้งเตือนงบประมาณ</span>
              <span className="label-xs">ส่ง Telegram เมื่อใช้งบถึง 70% หรือเกิน 100%</span>
            </div>
            <Switch on={Boolean(botPrefs.budgetAlerts)} onChange={(v) => toggle({ budgetAlerts: v })} label="แจ้งเตือนงบประมาณ" />
          </div>

          <div className="between" style={{ paddingTop: 10, borderTop: '1px solid var(--line-2)' }}>
            <div className="col" style={{ gap: 0 }}>
              <span>แจ้งเตือนรายการประจำ</span>
              <span className="label-xs">แจ้งเตือนเมื่อระบบบันทึกรายการประจำให้อัตโนมัติ</span>
            </div>
            <Switch on={Boolean(botPrefs.recurringAlerts)} onChange={(v) => toggle({ recurringAlerts: v })} label="แจ้งเตือนรายการประจำ" />
          </div>

          <div className="between" style={{ paddingTop: 10, borderTop: '1px solid var(--line-2)' }}>
            <div className="col" style={{ gap: 0 }}>
              <span>สรุปยอดรายวันอัตโนมัติ</span>
              <span className="label-xs">ส่งสรุปยอดคงเหลือและรายรับ-รายจ่ายประจำวัน</span>
            </div>
            <Switch on={Boolean(botPrefs.dailySummary)} onChange={(v) => toggle({ dailySummary: v })} label="สรุปยอดรายวัน" />
          </div>

          {botPrefs.dailySummary && (
            <div className="field">
              <label className="label" htmlFor="bot-hour">เวลาส่งสรุปรายวัน</label>
              <select id="bot-hour" value={botPrefs.dailyHour ?? 20} onChange={(e) => toggle({ dailyHour: Number(e.target.value) })}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{String(h).padStart(2, '0')}:00 น.</option>
                ))}
              </select>
            </div>
          )}
        </section>

        <section className="card stack" style={{ gap: 10 }}>
          <span style={{ fontWeight: 600 }}>ทดสอบส่งแจ้งเตือน</span>
          {!serverUser?.telegramId && (
            <div className="field">
              <label className="label" htmlFor="bot-chat-id">Telegram Chat ID (กรณีเปิดนอกแอป Telegram)</label>
              <input id="bot-chat-id" className="num" placeholder="เช่น 123456789" value={chatId} onChange={(e) => setChatId(e.target.value)} />
            </div>
          )}
          <button id="btn-bot-test" className="btn-gold" disabled={sending} onClick={handleTest}>
            <Send size={18} strokeWidth={STROKE} /> {sending ? 'กำลังส่ง…' : 'ส่งสรุปเข้า Telegram ตอนนี้'}
          </button>
        </section>

        <section className="card stack" style={{ gap: 6 }}>
          <span style={{ fontWeight: 600 }}>คำสั่งด่วนในแชทบอท</span>
          <span className="label"><code className="num">/summary</code> — ดูยอดรวมทุกวอลเล็ทและสรุปเดือนนี้ทันที</span>
          <span className="label"><code className="num">/out 150 กาแฟ</code> — บันทึกรายจ่ายด่วนผ่านแชท</span>
          <span className="label"><code className="num">/in 5000 ขายของ</code> — บันทึกรายรับด่วนผ่านแชท</span>
        </section>
      </div>
    </Sheet>
  );
}
