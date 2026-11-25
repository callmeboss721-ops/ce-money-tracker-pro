import { useRef, useState } from 'react';
import {
  ChevronRight,
  Wallet,
  Tags,
  Repeat,
  FileBarChart,
  ShieldCheck,
  Trash2,
  BellRing,
  CalendarRange,
  DatabaseBackup,
  Plus,
  Download,
  Upload,
  CheckCircle2,
  RefreshCw,
  FileLock2,
  Coins,
} from 'lucide-react';
import { useStore } from '../lib/store';
import { telegramUser } from '../lib/telegram';
import { walletBalance, walletBalanceTHB } from '../lib/calc';
import { fmtTHB, fmtCurrency, HIDDEN, maskLast4, yearOf } from '../lib/format';
import { GROUPS, findProvider } from '../lib/logos';
import { Sheet, WalletLogo, CategoryIcon, Switch, useUi, STROKE } from '../components/ui';
import { WalletForm, CategoryForm } from '../components/forms';

export const DISCLAIMER = 'เครื่องหมายการค้าเป็นของเจ้าของแต่ละราย แอปนี้ไม่ได้เกี่ยวข้องหรือได้รับการรับรองจากธนาคาร';

const QUICK_SOURCES = [
  { code: 'KBANK', label: 'K PLUS', group: 'bank', currency: 'THB' },
  { code: 'MAKE', label: 'MAKE', group: 'bank', currency: 'THB' },
  { code: 'KTC', label: 'KTC', group: 'bank', currency: 'THB' },
  { code: 'SCB', label: 'SCB', group: 'bank', currency: 'THB' },
  { code: 'BBL', label: 'BBL', group: 'bank', currency: 'THB' },
  { code: 'KTB', label: 'KTB', group: 'bank', currency: 'THB' },
  { code: 'BAY', label: 'Krungsri', group: 'bank', currency: 'THB' },
  { code: 'TTB', label: 'TTB', group: 'bank', currency: 'THB' },
  { code: 'TRUEMONEY', label: 'TrueMoney', group: 'ewallet', currency: 'THB' },
  { code: 'USDT', label: 'USDT', group: 'crypto', currency: 'USDT' },
  { code: 'OTHER_BANK', label: 'ธนาคารอื่น', group: 'bank', currency: 'THB' },
];

export default function Account({ go }) {
  const {
    serverUser,
    settings,
    updateSettings,
    usdtRate,
    refreshRate,
    saveUsdtRate,
    hasPin,
    botConfigured,
    activeWallets,
    categories,
    activeRecurring,
    transactions,
    wallets,
    budgets,
    recurring,
    saveWallet,
    deleteWallet,
    restoreTrashItem,
    exportCsv,
    exportBackup,
    importBackup,
  } = useStore();
  const { toast, confirm } = useUi();
  const [sub, setSub] = useState(null); // 'display' | 'backup' | 'fx' | 'privacy'
  const [fxCode, setFxCode] = useState('USD');
  const [fxVal, setFxVal] = useState('34.50');
  const tgClientUser = telegramUser();
  const fileRef = useRef();

  const fullName =
    [serverUser?.firstName, serverUser?.lastName].filter(Boolean).join(' ') ||
    tgClientUser?.name ||
    'ผู้ใช้';
  const username = serverUser?.username || tgClientUser?.username || '';
  const photo = serverUser?.photoUrl || tgClientUser?.photo || '';
  const isTelegramVerified = serverUser?.authMode === 'telegram';

  const fxRates = { USDT: usdtRate || 34.5, ...(settings.fxRates || {}) };

  const trashCount =
    transactions.filter((t) => t.deletedAt).length +
    wallets.filter((w) => w.deletedAt).length +
    categories.filter((c) => c.deletedAt).length +
    budgets.filter((b) => b.deletedAt).length +
    recurring.filter((r) => r.deletedAt).length;

  const toggleSource = async (src, turnOn) => {
    const activeMatch = activeWallets.find((w) => w.providerCode === src.code);
    if (turnOn && !activeMatch) {
      const deletedMatch = wallets.find((w) => w.providerCode === src.code && w.deletedAt);
      if (deletedMatch) {
        await restoreTrashItem('wallet', deletedMatch.id);
      } else {
        const prov = findProvider(src.code);
        await saveWallet({
          providerCode: src.code,
          group: prov?.group || src.group,
          name: prov?.th || src.label,
          currency: src.currency,
          initialBalance: 0,
        });
      }
      toast(`เปิดใช้งาน ${src.label} แล้ว`);
    } else if (!turnOn && activeMatch) {
      if (activeWallets.length <= 1) {
        toast('ต้องมีอย่างน้อย 1 วอลเล็ทที่เปิดใช้งาน');
        return;
      }
      await deleteWallet(activeMatch.id);
      toast(`ปิดการแสดง ${src.label} แล้ว (ประวัติเดิมยังอยู่ครบ)`);
    }
  };

  const saveCustomFx = async () => {
    const code = fxCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const val = parseFloat(String(fxVal).replace(/,/g, ''));
    if (!code || code === 'THB' || !(val > 0)) {
      toast('กรุณาระบุสกุลเงินและเรทที่ถูกต้อง');
      return;
    }
    const nextFx = { ...fxRates, [code]: val };
    await updateSettings({ fxRates: nextFx });
    if (code === 'USDT') await saveUsdtRate(val);
    toast(`บันทึกเรท 1 ${code} = ${val} บาทแล้ว`);
    setSub(null);
  };

  const removeCustomFx = async (code) => {
    if (code === 'USDT') return;
    const nextFx = { ...fxRates };
    delete nextFx[code];
    await updateSettings({ fxRates: nextFx });
    toast(`ลบเรท ${code} แล้ว`);
  };

  const doExport = async () => {
    const blob = await exportBackup();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ce-money-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('ดาวน์โหลดไฟล์สำรองแล้ว');
  };

  const doImport = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const ok = await confirm({ title: 'กู้คืนข้อมูล?', message: 'ระบบจะรวมข้อมูลจากไฟล์เข้ากับข้อมูลปัจจุบัน โดยไม่ลบข้อมูลที่มีอยู่', okText: 'กู้คืน' });
    if (!ok) return;
    try {
      const n = await importBackup(f);
      toast(`กู้คืนสำเร็จ ${n} รายการ`);
    } catch (err) {
      toast(err.message || 'ไฟล์ไม่ถูกต้อง');
    }
  };

  const items = [
    { id: 'wallets', icon: Wallet, label: 'จัดการวอลเล็ทและยอดเริ่มต้น', hint: `${activeWallets.length} บัญชี`, onClick: () => go('wallets') },
    { id: 'categories', icon: Tags, label: 'หมวดหมู่รายรับ-รายจ่าย', hint: `${categories.filter((c) => !c.deletedAt).length} หมวด`, onClick: () => go('categories') },
    { id: 'recurring', icon: Repeat, label: 'รายการประจำ', hint: `${activeRecurring.length} รายการ`, onClick: () => go('recurring') },
    { id: 'reports', icon: FileBarChart, label: 'รายงานและส่งออกขั้นสูง', hint: 'CSV / JSON', onClick: () => go('reports') },
    { id: 'security', icon: ShieldCheck, label: 'ความปลอดภัย (รหัส PIN)', hint: hasPin ? 'เปิด PIN' : 'ตั้งรหัส', onClick: () => go('security') },
    { id: 'trash', icon: Trash2, label: 'ถังขยะและประวัติการแก้ไข', hint: trashCount ? `${trashCount} รายการ` : 'ประวัติ', onClick: () => go('trash') },
    { id: 'bot', icon: BellRing, label: 'บอทแจ้งเตือน Telegram', hint: botConfigured ? 'เชื่อมต่อแล้ว' : 'ตั้งค่า', onClick: () => go('bot') },
    { id: 'display', icon: CalendarRange, label: 'การแสดงผล (ค.ศ. / พ.ศ.)', hint: settings.yearFormat === 'BE' ? 'พ.ศ.' : 'ค.ศ.', onClick: () => setSub('display') },
    { id: 'backup', icon: DatabaseBackup, label: 'สำรองและกู้คืนข้อมูล', onClick: () => setSub('backup') },
    { id: 'privacy', icon: FileLock2, label: 'นโยบายความเป็นส่วนตัว', onClick: () => setSub('privacy') },
  ];

  return (
    <main className="screen stack" style={{ gap: 16 }}>
      <h1 className="h1" style={{ paddingTop: 8 }}>ตั้งค่าและบัญชี</h1>

      {/* 1. โปรไฟล์ */}
      <section className="card row" style={{ gap: 14 }}>
        {photo ? (
          <img src={photo} alt="" width="56" height="56" style={{ borderRadius: '50%', border: '1px solid var(--line)' }} />
        ) : (
          <span style={{ width: 56, height: 56, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, var(--gold-2), var(--gold-3))', color: '#1a1404', fontWeight: 700, fontSize: 22 }}>
            {fullName.slice(0, 1)}
          </span>
        )}
        <div className="col grow" style={{ gap: 2 }}>
          <span className="label-xs">โปรไฟล์ส่วนตัว</span>
          <div className="row" style={{ gap: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 17 }} className="truncate">{fullName}</span>
            {isTelegramVerified && <CheckCircle2 size={16} strokeWidth={STROKE} className="income" />}
          </div>
          <span className="label-xs truncate">
            {username ? `@${username}` : isTelegramVerified ? `Telegram ID: ${serverUser?.telegramId}` : 'เปิดผ่าน Telegram เพื่อเชื่อมบัญชีอัตโนมัติ'}
          </span>
        </div>
      </section>

      {/* 2. แหล่งที่ติดตาม (Tracked Sources Card — Ref Image 3) */}
      <section className="card stack" style={{ gap: 10 }}>
        <div className="between">
          <h2 className="h2">แหล่งที่ติดตาม</h2>
          <span className="pct-badge" style={{ padding: '0 10px', color: 'var(--gold)' }}>ไม่จำกัด</span>
        </div>
        <span className="label-xs" style={{ marginTop: -4 }}>
          Pro ใช้ได้ทุกแหล่ง — เปิดหรือปิดได้ตามต้องการ
        </span>
        <div className="list">
          {QUICK_SOURCES.map((src) => {
            const isOn = activeWallets.some((w) => w.providerCode === src.code);
            return (
              <div key={src.code} className="item" style={{ cursor: 'default', minHeight: 56 }}>
                <WalletLogo code={src.code} />
                <div className="col grow" style={{ gap: 0 }}>
                  <span className="truncate" style={{ fontWeight: 600 }}>{src.label}</span>
                  <span className="label-xs">{isOn ? 'กำลังติดตามอัตโนมัติ' : 'ปิดการติดตามชั่วคราว'}</span>
                </div>
                <Switch on={isOn} onChange={(v) => toggleSource(src, v)} label={`สลับ ${src.label}`} />
              </div>
            );
          })}
        </div>
      </section>

      {/* 3. อัตราแลกเปลี่ยน (+ เพิ่มเรท — Ref Image 3) */}
      <section className="card stack" style={{ gap: 10 }}>
        <div className="between">
          <div className="row" style={{ gap: 8 }}>
            <Coins size={18} strokeWidth={STROKE} className="gold" />
            <h2 className="h2">อัตราแลกเปลี่ยน</h2>
          </div>
          <button
            id="btn-add-fx"
            type="button"
            className="link"
            style={{ minHeight: 34 }}
            onClick={() => { setFxCode('USD'); setFxVal('34.50'); setSub('fx'); }}
          >
            <Plus size={16} strokeWidth={STROKE} /> เพิ่มเรท
          </button>
        </div>
        <span className="label-xs" style={{ marginTop: -4, lineHeight: 1.5 }}>
          ตั้งเรทเองเพื่อแปลงรายการบัตร/สกุลต่างประเทศ รายการที่ยังไม่มีเรทจะแสดงยอดเดิมและไม่ถูกนับในยอดรวม
        </span>
        <div className="list">
          {Object.entries(fxRates).map(([code, rate]) => (
            <div key={code} className="item" style={{ cursor: 'default', minHeight: 48 }}>
              <span className="num" style={{ fontWeight: 700, minWidth: 56 }}>{code}</span>
              <span className="label grow num">1 {code} = ฿ {Number(rate).toFixed(2)}</span>
              {code === 'USDT' ? (
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ minHeight: 34, padding: '0 10px' }}
                  onClick={async () => {
                    const r = await refreshRate();
                    await updateSettings({ fxRates: { ...fxRates, USDT: r.rate } });
                    toast(`อัปเดตเรท 1 USDT = ${r.rate} บาท`);
                  }}
                >
                  <RefreshCw size={14} strokeWidth={STROKE} /> อัปเดต
                </button>
              ) : (
                <button
                  type="button"
                  className="icon-btn plain"
                  style={{ width: 34, height: 34, color: 'var(--expense)' }}
                  onClick={() => removeCustomFx(code)}
                  aria-label={`ลบเรท ${code}`}
                >
                  <Trash2 size={16} strokeWidth={STROKE} />
                </button>
              )}
              <button
                type="button"
                className="btn-ghost"
                style={{ minHeight: 34, padding: '0 10px' }}
                onClick={() => { setFxCode(code); setFxVal(String(rate)); setSub('fx'); }}
              >
                แก้เรท
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* 4. All System Menus */}
      <section className="card" style={{ padding: '6px 12px' }}>
        <div className="list">
          {items.map((it) => (
            <button key={it.id} id={`menu-${it.id}`} className="item" onClick={it.onClick}>
              <span className="icon-btn" style={{ color: 'var(--gold)' }}><it.icon size={20} strokeWidth={STROKE} /></span>
              <span className="grow">{it.label}</span>
              {it.hint && <span className="label-xs">{it.hint}</span>}
              <ChevronRight size={20} strokeWidth={STROKE} className="chev" />
            </button>
          ))}
        </div>
      </section>

      <p className="disclaimer">{DISCLAIMER}</p>
      <p className="label-xs en" style={{ textAlign: 'center', margin: 0 }}>CE Money Tracker Pro · v4.2 Personal Edition</p>

      {/* Add / Edit FX Rate Sheet */}
      {sub === 'fx' && (
        <Sheet title="ตั้งค่าอัตราแลกเปลี่ยน" onClose={() => setSub(null)}>
          <div className="stack">
            <div className="field">
              <label className="label" htmlFor="fx-code">รหัสสกุลเงิน (เช่น USDT, USD, EUR, JPY)</label>
              <input
                id="fx-code"
                className="num"
                placeholder="USD"
                value={fxCode}
                onChange={(e) => setFxCode(e.target.value.toUpperCase())}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="fx-val">อัตราแลกเปลี่ยนเป็นเงินบาท (บาท ต่อ 1 หน่วย)</label>
              <input
                id="fx-val"
                inputMode="decimal"
                className="num"
                placeholder="34.50"
                value={fxVal}
                onChange={(e) => setFxVal(e.target.value.replace(/[^\d.,]/g, ''))}
              />
            </div>
            <button id="btn-save-fx" className="btn-gold" onClick={saveCustomFx}>บันทึกอัตราแลกเปลี่ยน</button>
          </div>
        </Sheet>
      )}

      {/* Display Sheet */}
      {sub === 'display' && (
        <Sheet title="การแสดงผลและโทนสี" onClose={() => setSub(null)}>
          <div className="stack">
            <div className="card">
              <span className="label">โทนสีของแอป (Theme)</span>
              <div className="seg" style={{ marginTop: 10 }}>
                <button className={(settings.theme || 'lavender') === 'lavender' ? 'on' : ''} onClick={() => updateSettings({ theme: 'lavender' })}>
                  OhMyMoney (ม่วงพาสเทล)
                </button>
                <button className={settings.theme === 'gold' ? 'on' : ''} onClick={() => updateSettings({ theme: 'gold' })}>
                  Luxury Gold (สีทอง)
                </button>
              </div>
            </div>

            <div className="card">
              <span className="label">รูปแบบปีปฏิทิน</span>
              <div className="seg" style={{ marginTop: 10 }}>
                <button className={settings.yearFormat === 'BE' ? 'on' : ''} onClick={() => updateSettings({ yearFormat: 'BE' })}>พ.ศ. ({yearOf(new Date().getFullYear(), 'BE')})</button>
                <button className={settings.yearFormat !== 'BE' ? 'on' : ''} onClick={() => updateSettings({ yearFormat: 'CE' })}>ค.ศ. ({new Date().getFullYear()})</button>
              </div>
            </div>

            <div className="card between">
              <div className="col" style={{ gap: 0 }}>
                <span>ซ่อนยอดเงิน</span>
                <span className="label-xs">แสดงเป็น ••••• ทุกหน้าจอ</span>
              </div>
              <Switch on={settings.hideBalance} onChange={(v) => updateSettings({ hideBalance: v })} label="ซ่อนยอดเงิน" />
            </div>
          </div>
        </Sheet>
      )}

      {/* Backup Sheet */}
      {sub === 'backup' && (
        <Sheet title="สำรองและกู้คืนข้อมูล" onClose={() => setSub(null)}>
          <div className="stack">
            <p className="muted" style={{ margin: 0, fontWeight: 300 }}>
              ส่งออกรายการเป็นไฟล์ CSV หรือดาวน์โหลดไฟล์สำรอง JSON การกู้คืนจะรวมข้อมูลเข้าด้วยกันโดยไม่ลบของเดิม
            </p>
            <button className="btn-gold" onClick={() => { exportCsv(''); toast('ส่งออก CSV ทั้งหมดแล้ว'); }}>
              <Download size={18} strokeWidth={STROKE} /> ส่งออกรายการทั้งหมด (CSV)
            </button>
            <button className="btn-ghost" style={{ width: '100%' }} onClick={doExport}>
              <Download size={18} strokeWidth={STROKE} /> ดาวน์โหลดไฟล์สำรอง (JSON)
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={doImport} />
            <button className="btn-ghost" style={{ width: '100%' }} onClick={() => fileRef.current.click()}>
              <Upload size={18} strokeWidth={STROKE} /> กู้คืนจากไฟล์ JSON
            </button>
          </div>
        </Sheet>
      )}

      {/* Privacy Policy Page matching Ref Images 4–6 */}
      {sub === 'privacy' && <PrivacyPolicySheet onClose={() => setSub(null)} />}
    </main>
  );
}

function PrivacyPolicySheet({ onClose }) {
  const sections = [
    {
      n: 1,
      title: 'การใช้งานเฉพาะเจ้าของบัญชี',
      body: 'CE Money Tracker Pro ออกแบบสำหรับการบันทึกรายรับ-รายจ่ายส่วนบุคคล ตรวจสอบตัวตนด้วยลายเซ็นดิจิทัล Telegram initData (HMAC-SHA256) ที่ฝั่งเซิร์ฟเวอร์ทุกคำขอ และรองรับการล็อกเฉพาะ OWNER_TELEGRAM_ID รวมถึงรหัส PIN ส่วนตัว',
    },
    {
      n: 2,
      title: 'การจัดเก็บข้อมูลและสลิปแบบส่วนตัว',
      body: 'ข้อมูลธุรกรรม วอลเล็ท หมวดหมู่ และงบประมาณถูกจัดเก็บในฐานข้อมูล SQLite แยกตามรหัสผู้ใช้ ไฟล์รูปสลิปถูกเก็บแยกในพื้นที่ Private นอกโฟลเดอร์สาธารณะ เข้าดูได้เฉพาะเจ้าของบัญชีเท่านั้น และเก็บเลขบัญชีเฉพาะ 4 ตัวท้าย',
    },
    {
      n: 3,
      title: 'การไม่แชร์ข้อมูลและไม่มีโฆษณา',
      body: 'แอปไม่มีโฆษณา ไม่มี SDK ติดตามพฤติกรรมของบุคคลที่สาม และไม่แชร์ ขาย หรือส่งต่อข้อมูลทางการเงินของคุณให้แก่บุคคลภายนอก',
    },
    {
      n: 4,
      title: 'ไฟล์สำรองข้อมูลและ CSV',
      body: 'คุณสามารถส่งออกข้อมูลทั้งหมดเป็นไฟล์ JSON และส่งออกรายงานเป็นไฟล์ CSV (UTF-8) ได้ด้วยตนเองตลอดเวลา',
    },
    {
      n: 5,
      title: 'การปกป้องข้อมูลจากการลบโดยไม่ตั้งใจ',
      body: 'การลบรายการในแอปเป็นการย้ายไปยังถังขยะ (Soft Delete) พร้อมบันทึกประวัติการแก้ไข (Audit History) เพื่อให้คุณกู้คืนข้อมูลกลับมาได้เสมอ และการอัปเดตเวอร์ชันจะไม่ลบข้อมูลเดิมของคุณ',
    },
  ];

  return (
    <Sheet title="นโยบายความเป็นส่วนตัว" onClose={onClose} full>
      <div className="stack" style={{ gap: 18 }}>
        <section className="card stack" style={{ gap: 8, background: 'linear-gradient(145deg, rgba(212,175,55,0.12), rgba(11,22,48,0.85))' }}>
          <div className="row" style={{ gap: 8 }}>
            <ShieldCheck size={20} strokeWidth={STROKE} className="gold" />
            <span style={{ fontWeight: 600 }}>ข้อมูลส่วนตัวสำหรับคุณเท่านั้น</span>
          </div>
          <p className="label" style={{ margin: 0 }}>
            CE Money Tracker Pro เป็นแอปบันทึกรายรับ-รายจ่ายส่วนบุคคล ข้อมูลและรูปสลิปทั้งหมดอยู่ภายใต้การควบคุมของคุณ ไม่มีโฆษณาและไม่มีการวิเคราะห์ข้อมูลโดยบุคคลที่สาม
          </p>
        </section>

        {sections.map((s) => (
          <div key={s.n} className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
            <span className="step-num">{s.n}</span>
            <div className="col grow" style={{ gap: 4 }}>
              <h3 className="h2">{s.title}</h3>
              <p className="label" style={{ margin: 0, lineHeight: 1.6 }}>{s.body}</p>
            </div>
          </div>
        ))}

        <section className="card stack" style={{ gap: 8 }}>
          <h3 className="h2 en">Privacy Policy — English Summary</h3>
          <p className="label" style={{ margin: 0, lineHeight: 1.6 }}>
            CE Money Tracker Pro is a private personal finance tracker built as a Telegram Mini App. Every request is authenticated on the server via Telegram initData HMAC-SHA256 verification (plus optional PIN lock). All records and attached slip images are stored privately in an isolated SQLite database and private slip storage accessible only to the account owner. There are no ads, no third-party analytics, and full JSON backup & CSV export are available anytime.
          </p>
        </section>

        <p className="disclaimer">{DISCLAIMER}</p>
      </div>
    </Sheet>
  );
}

/* ---------- Wallets page ---------- */
export function WalletsPage({ onClose }) {
  const { activeWallets, transactions, settings, usdtRate } = useStore();
  const [form, setForm] = useState(null);
  const hide = settings.hideBalance;
  return (
    <Sheet title="วอลเล็ทและบัญชี" onClose={onClose} full right={<button id="btn-add-wallet" className="icon-btn" onClick={() => setForm({})} aria-label="เพิ่มวอลเล็ท"><Plus size={20} strokeWidth={STROKE} /></button>}>
      <div className="stack">
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
                    <button key={w.id} className="item" onClick={() => setForm(w)}>
                      <WalletLogo code={w.providerCode} />
                      <div className="col grow" style={{ gap: 0 }}>
                        <span className="truncate">{w.name}</span>
                        <span className="label-xs">
                          <span className="num">{w.providerCode} · {w.currency || 'THB'}</span>
                          {w.last4 && <span className="num"> · {maskLast4(w.last4)}</span>}
                        </span>
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
        <button className="btn-gold" onClick={() => setForm({})}><Plus size={18} strokeWidth={STROKE} /> เพิ่มวอลเล็ท</button>
        <p className="disclaimer">{DISCLAIMER}</p>
      </div>
      {form && <WalletForm initial={form.id ? form : null} onClose={() => setForm(null)} />}
    </Sheet>
  );
}

/* ---------- Categories page ---------- */
export function CategoriesPage({ onClose }) {
  const { categories } = useStore();
  const [type, setType] = useState('expense');
  const [form, setForm] = useState(null);
  const list = categories.filter((c) => c.type === type && !c.deletedAt);
  return (
    <Sheet title="หมวดหมู่" onClose={onClose} full right={<button id="btn-add-cat" className="icon-btn" onClick={() => setForm({})} aria-label="เพิ่มหมวดหมู่"><Plus size={20} strokeWidth={STROKE} /></button>}>
      <div className="stack">
        <div className="seg">
          <button className={type === 'expense' ? 'on t-expense' : ''} onClick={() => setType('expense')}>รายจ่าย</button>
          <button className={type === 'income' ? 'on t-income' : ''} onClick={() => setType('income')}>รายรับ</button>
        </div>
        <section className="card" style={{ padding: '6px 12px' }}>
          <div className="list">
            {list.map((c) => (
              <button key={c.id} className="item" onClick={() => setForm(c)}>
                <CategoryIcon cat={c} />
                <span className="grow truncate">{c.name}</span>
                <ChevronRight size={20} strokeWidth={STROKE} className="chev" />
              </button>
            ))}
            <div className="item" style={{ cursor: 'default' }}>
              <CategoryIcon transfer />
              <div className="col grow" style={{ gap: 0 }}>
                <span>รายการโอน</span>
                <span className="label-xs">ใช้สำหรับโอนระหว่างวอลเล็ทในปุ่ม + แท็บ "โอน"</span>
              </div>
            </div>
          </div>
        </section>
        <button className="btn-gold" onClick={() => setForm({})}><Plus size={18} strokeWidth={STROKE} /> เพิ่มหมวด{type === 'income' ? 'รายรับ' : 'รายจ่าย'}</button>
      </div>
      {form && <CategoryForm initial={form.id ? form : null} type={type} onClose={() => setForm(null)} />}
    </Sheet>
  );
}
