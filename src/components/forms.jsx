import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  ImagePlus,
  Trash2,
  Pencil,
  CalendarClock,
  StickyNote,
  Hash,
  Maximize2,
  Plus,
  RefreshCw,
  ArrowDown,
  Tag,
  X,
  History,
  ClipboardPaste,
} from 'lucide-react';
import { useStore } from '../lib/store';
import { findDuplicate, walletBalance, collectAllTags, txTHB } from '../lib/calc';
import { fmtTHB, fmtCurrency, toLocalInput, dateTimeLabel, maskLast4, round2, round4 } from '../lib/format';
import { findProvider } from '../lib/logos';
import { CHANNELS, channelInfo, inferChannelFromWallet } from '../lib/channels';
import { parseBankNotification } from '../lib/bankParser';
import { haptic } from '../lib/telegram';
import { Sheet, WalletLogo, CategoryIcon, useUi, STROKE, Icon } from './ui';
import { CategoryGrid, WalletSelect, ProviderPicker, IconPicker, ColorPicker } from './pickers';

const MAX_SLIP = 5 * 1024 * 1024;

/* ======================= Add / edit transaction (Expense / Income / Transfer + USDT + Tags) ======================= */
export function TxForm({ initial, defaultType, onClose, onAddWallet }) {
  const { activeWallets, categories, activeTx, settings, usdtRate, refreshRate, saveUsdtRate, saveTransaction, getSlipUrl } = useStore();
  const { confirm, toast, openSlip } = useUi();

  const fxMap = useMemo(() => ({ USDT: usdtRate || 34.5, ...(settings?.fxRates || {}) }), [usdtRate, settings]);
  const currencyOptions = useMemo(() => ['THB', ...Object.keys(fxMap).filter((c) => c !== 'THB')], [fxMap]);

  const isEdit = Boolean(initial?.id);
  const [type, setType] = useState(initial?.type || defaultType || 'expense');

  const defaultWallet = activeWallets.find((w) => w.id === initial?.walletId) || activeWallets[0] || null;
  const [walletId, setWalletId] = useState(defaultWallet?.id || null);
  const secondWallet =
    activeWallets.find((w) => w.id === initial?.toWalletId) ||
    activeWallets.find((w) => w.id !== defaultWallet?.id) ||
    null;
  const [toWalletId, setToWalletId] = useState(secondWallet?.id || null);

  const [currency, setCurrency] = useState(initial?.currency || defaultWallet?.currency || 'THB');
  const [amount, setAmount] = useState(isEdit ? String(initial.amount) : '');
  const [fxRate, setFxRate] = useState(String(initial?.fxRate && initial.fxRate !== 1 ? initial.fxRate : fxMap[initial?.currency] || usdtRate || 34.5));
  const [toAmount, setToAmount] = useState(isEdit && initial?.toAmount != null ? String(initial.toAmount) : '');
  const [fee, setFee] = useState(isEdit && initial?.fee ? String(initial.fee) : '');

  const [categoryId, setCategoryId] = useState(initial?.categoryId && initial.categoryId !== 'transfer' ? initial.categoryId : null);
  const [channel, setChannel] = useState(initial?.channel || inferChannelFromWallet(defaultWallet));
  const [date, setDate] = useState(toLocalInput(initial?.date || new Date()));
  const [reference, setReference] = useState(initial?.reference || '');
  const [note, setNote] = useState(initial?.note || '');
  const [tags, setTags] = useState(initial?.tags || []);
  const [tagInput, setTagInput] = useState('');

  const [slipFile, setSlipFile] = useState(undefined);
  const [slipPreview, setSlipPreview] = useState(null);
  const [pickWallet, setPickWallet] = useState(null); // null | 'from' | 'to'
  const [catModal, setCatModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fetchingRate, setFetchingRate] = useState(false);
  const fileRef = useRef();

  const knownTags = useMemo(() => collectAllTags(activeTx), [activeTx]);

  useEffect(() => {
    let url;
    if (initial?.slipId && slipFile === undefined) {
      getSlipUrl(initial.slipId).then((u) => setSlipPreview((url = u)));
    }
    return () => url && URL.revokeObjectURL(url);
  }, [initial, getSlipUrl]); // eslint-disable-line

  useEffect(() => {
    if (type !== 'transfer') {
      const c = categories.find((x) => x.id === categoryId && !x.deletedAt);
      if (c && c.type !== type) setCategoryId(null);
    }
  }, [type]); // eslint-disable-line

  const wallet = activeWallets.find((w) => w.id === walletId);
  const toWallet = activeWallets.find((w) => w.id === toWalletId);
  const destCur = toWallet?.currency || 'THB';
  const crossCurrency = type === 'transfer' && wallet && toWallet && currency !== destCur;
  const needsFx = currency !== 'THB' || crossCurrency;

  const amt = parseFloat(String(amount).replace(/,/g, '')) || 0;
  const rateNum = parseFloat(String(fxRate).replace(/,/g, '')) || fxMap[currency] || usdtRate || 34.5;
  const feeNum = parseFloat(String(fee).replace(/,/g, '')) || 0;
  const computedThb = currency !== 'THB' ? round2(amt * rateNum) : round2(amt);

  const autoDestAmt = useMemo(() => {
    if (!amt || type !== 'transfer') return 0;
    if (currency === destCur) return amt;
    return currency !== 'THB' && destCur === 'THB' ? round2(amt * rateNum) : round4(amt / rateNum);
  }, [amt, type, currency, destCur, rateNum]);

  const selectChannel = (chCode) => {
    setChannel(chCode);
    const ch = channelInfo(chCode);
    const match =
      activeWallets.find((w) => w.providerCode === ch.defaultProvider) ||
      activeWallets.find((w) => w.group === ch.group);
    if (match) {
      setWalletId(match.id);
      setCurrency(match.currency || (chCode === 'USDT' ? 'USDT' : 'THB'));
    } else if (chCode === 'USDT') {
      setCurrency('USDT');
    }
  };

  const handleRefreshRate = async () => {
    setFetchingRate(true);
    try {
      const res = await refreshRate();
      setFxRate(String(res.rate));
      toast(res.source === 'live' ? `อัปเดตเรทล่าสุด ${res.rate} บาท/USDT` : `ใช้เรทที่บันทึกไว้ ${res.rate} บาท/USDT`);
    } catch {
      toast('ไม่สามารถดึงเรทได้');
    } finally {
      setFetchingRate(false);
    }
  };

  const addTag = (raw) => {
    const clean = String(raw || '').trim().replace(/^#+/, '').slice(0, 30);
    if (!clean) return;
    if (!tags.includes(clean)) setTags([...tags, clean]);
    setTagInput('');
  };

  const valid =
    amt > 0 &&
    walletId &&
    date &&
    (type === 'transfer' ? toWalletId && toWalletId !== walletId : Boolean(categoryId));

  const onFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!['image/jpeg', 'image/png'].includes(f.type)) return toast('รองรับเฉพาะไฟล์ JPG หรือ PNG');
    if (f.size > MAX_SLIP) return toast('ไฟล์ต้องมีขนาดไม่เกิน 5MB');
    setSlipFile(f);
    setSlipPreview(URL.createObjectURL(f));
  };

  const [parseOpen, setParseOpen] = useState(false);
  const [rawSms, setRawSms] = useState('');

  const applyParsedSms = (txt) => {
    const p = parseBankNotification(txt);
    if (!p) {
      toast('ไม่พบยอดเงินในข้อความ กรุณาตรวจสอบข้อความแจ้งเตือน');
      return;
    }
    setType(p.type);
    setAmount(String(p.amount));
    setCurrency(p.currency);
    if (p.currency !== 'THB') {
      setFxRate(fxMap[p.currency] ? String(fxMap[p.currency]) : '');
    } else {
      setFxRate('1');
    }
    setCategoryId(p.categoryId);
    setNote(p.note);
    const matchW = activeWallets.find((w) => w.providerCode === p.providerCode);
    if (matchW) {
      setWalletId(matchW.id);
      setChannel(inferChannelFromWallet(matchW));
    }
    setParseOpen(false);
    setRawSms('');
    haptic('success');
    toast(`ดึงข้อมูลจาก ${p.providerCode} สำเร็จ`);
  };

  const save = async () => {
    if (!valid || saving) return;
    if (tagInput.trim()) addTag(tagInput);
    const finalTags = tagInput.trim()
      ? [...new Set([...tags, tagInput.trim().replace(/^#+/, '')])]
      : tags;

    const explicitRate = parseFloat(String(fxRate).replace(/,/g, ''));
    const effectiveFx = currency === 'THB' ? 1 : explicitRate > 0 ? explicitRate : 0;

    const draft = {
      id: isEdit ? initial.id : undefined,
      type,
      amount: amt,
      currency,
      fxRate: effectiveFx,
      amountTHB: currency === 'THB' ? round2(amt) : effectiveFx > 0 ? round2(amt * effectiveFx) : null,
      categoryId: type === 'transfer' ? 'transfer' : categoryId,
      walletId,
      toWalletId: type === 'transfer' ? toWalletId : null,
      toAmount:
        type === 'transfer'
          ? toAmount && parseFloat(toAmount) > 0
            ? parseFloat(toAmount)
            : autoDestAmt
          : null,
      fee: type === 'transfer' ? feeNum : 0,
      channel,
      date: new Date(date).toISOString(),
      reference: reference.trim(),
      note: note.trim(),
      tags: finalTags,
    };

    const dup = findDuplicate(activeTx, draft, isEdit ? initial.id : undefined);
    if (dup) {
      haptic('warning');
      const ok = await confirm({
        title: 'อาจเป็นรายการซ้ำ',
        message: `พบรายการยอด ${fmtCurrency(dup.amount, dup.currency)} เวลาหรือเลขอ้างอิงตรงกับรายการเดิม${dup.reference ? ` (อ้างอิง: ${dup.reference})` : ''} ต้องการบันทึกซ้ำหรือไม่?`,
        okText: 'บันทึกต่อ',
      });
      if (!ok) return;
    }

    setSaving(true);
    try {
      if (currency === 'USDT' && effectiveFx > 0) await saveUsdtRate(effectiveFx).catch(() => {});
      await saveTransaction(draft, slipFile);
      haptic('success');
      toast(isEdit ? 'บันทึกการแก้ไขแล้ว' : 'บันทึกรายการแล้ว');
      onClose();
    } catch (err) {
      toast(err.message || 'บันทึกไม่สำเร็จ');
      setSaving(false);
    }
  };

  return (
    <Sheet title={isEdit ? 'แก้ไขรายการ' : 'บันทึกรายการ'} onClose={onClose}>
      <div className="stack">
        {/* 3 Tabs: รายจ่าย | รายรับ | โอน */}
        <div className="seg" role="tablist">
          <button type="button" role="tab" aria-selected={type === 'expense'} className={type === 'expense' ? 'on t-expense' : ''} onClick={() => setType('expense')}>รายจ่าย</button>
          <button type="button" role="tab" aria-selected={type === 'income'} className={type === 'income' ? 'on t-income' : ''} onClick={() => setType('income')}>รายรับ</button>
          <button type="button" id="tab-transfer" role="tab" aria-selected={type === 'transfer'} className={type === 'transfer' ? 'on t-transfer' : ''} onClick={() => setType('transfer')}>โอน</button>
        </div>

        {/* Auto-parse Bank / LINE Notification button (Ref automatic tracking workflow) */}
        {!isEdit && (
          <div className="stack" style={{ gap: 8 }}>
            <button
              type="button"
              id="btn-toggle-autoparse"
              className="btn-ghost"
              style={{ width: '100%' }}
              onClick={() => setParseOpen((o) => !o)}
            >
              <ClipboardPaste size={17} strokeWidth={STROKE} /> วางข้อความแจ้งเตือนธนาคาร / LINE อัตโนมัติ
            </button>
            {parseOpen && (
              <div className="card stack" style={{ gap: 8, padding: 12 }}>
                <span className="label-xs">
                  รองรับ K PLUS, MAKE, KTC, SCB Connect, BBL, KTB, Krungsri, TTB, TrueMoney และสกุลเงินต่างประเทศ
                </span>
                <textarea
                  id="autoparse-input"
                  rows={3}
                  placeholder="วางข้อความ เช่น รายการเงินออก 455.00 บาท จาก K PLUS ชำระค่า Grab หรือ ใช้บัตร KTC USD 19.99 ที่ OPENAI"
                  value={rawSms}
                  onChange={(e) => setRawSms(e.target.value)}
                />
                <button type="button" id="btn-run-autoparse" className="btn-gold" style={{ minHeight: 42 }} onClick={() => applyParsedSms(rawSms)}>
                  อ่านยอดและกรอกอัตโนมัติ
                </button>
              </div>
            )}
          </div>
        )}

        {/* Amount + Currency (THB / USDT / custom FX) */}
        <div className="card" style={{ padding: '12px 16px' }}>
          <div className="between" style={{ flexWrap: 'wrap', gap: 6 }}>
            <span className="label">จำนวนเงิน ({currency === 'THB' ? 'บาท' : currency})</span>
            <div className="seg" style={{ minWidth: 132, padding: 2 }}>
              {currencyOptions.map((c) => (
                <button
                  key={c}
                  type="button"
                  id={`cur-${c}`}
                  style={{ minHeight: 32, padding: '0 8px', fontSize: 14 }}
                  className={currency === c ? 'on' : ''}
                  onClick={() => {
                    setCurrency(c);
                    if (c !== 'THB' && fxMap[c]) setFxRate(String(fxMap[c]));
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <span className={`num-lg ${type}`}>{currency === 'THB' ? '฿' : currency === 'USDT' ? '₮' : currency}</span>
            <input
              id="tx-amount"
              className={`amount-input ${type}`}
              inputMode="decimal"
              placeholder={currency === 'USDT' ? '0.0000' : '0.00'}
              value={amount}
              autoFocus={!isEdit}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))}
            />
          </div>
          {currency !== 'THB' && amt > 0 && (
            <div className="between" style={{ paddingTop: 6, borderTop: '1px solid var(--line-2)' }}>
              <span className="label-xs">คิดเป็นเงินบาท</span>
              <span className="num-md gold">≈ {fmtTHB(computedThb)}</span>
            </div>
          )}
        </div>

        {/* Foreign currency / Cross-currency exchange rate */}
        {needsFx && (
          <div className="card" style={{ padding: '10px 14px' }}>
            <div className="between">
              <label className="label" htmlFor="tx-fx-rate">เรทแลกเปลี่ยน (บาท / 1 {currency === 'THB' ? destCur : currency})</label>
              {currency === 'USDT' && (
                <button type="button" className="link" style={{ minHeight: 32 }} onClick={handleRefreshRate} disabled={fetchingRate}>
                  <RefreshCw size={14} strokeWidth={STROKE} /> {fetchingRate ? 'กำลังดึง…' : 'ดึงเรทล่าสุด'}
                </button>
              )}
            </div>
            <input
              id="tx-fx-rate"
              inputMode="decimal"
              className="num"
              value={fxRate}
              onChange={(e) => setFxRate(e.target.value.replace(/[^\d.,]/g, ''))}
            />
          </div>
        )}

        {/* Transfer Wallets OR Category + Channel */}
        {type === 'transfer' ? (
          <div className="stack" style={{ gap: 10 }}>
            <div className="field">
              <span className="label">โอนจากวอลเล็ท (ต้นทาง)</span>
              <button id="tx-from-wallet" type="button" className="pick-btn" onClick={() => setPickWallet('from')}>
                {wallet ? <WalletLogo code={wallet.providerCode} /> : <span className="logo-fallback">—</span>}
                <span className="col grow">
                  <span className="truncate">{wallet?.name || 'เลือกวอลเล็ทต้นทาง'}</span>
                  <span className="label-xs num">{wallet?.currency || 'THB'}{wallet?.last4 ? ` · ${maskLast4(wallet.last4)}` : ''}</span>
                </span>
                <ChevronRight size={20} strokeWidth={STROKE} className="chev" />
              </button>
            </div>

            <div className="row" style={{ justifyContent: 'center' }}>
              <span className="icon-btn" style={{ width: 36, height: 36, borderRadius: '50%', color: 'var(--gold)' }}>
                <ArrowDown size={18} strokeWidth={STROKE} />
              </span>
            </div>

            <div className="field">
              <span className="label">ไปยังวอลเล็ท (ปลายทาง)</span>
              <button id="tx-to-wallet" type="button" className="pick-btn" onClick={() => setPickWallet('to')}>
                {toWallet ? <WalletLogo code={toWallet.providerCode} /> : <span className="logo-fallback">—</span>}
                <span className="col grow">
                  <span className="truncate">{toWallet?.name || 'เลือกวอลเล็ทปลายทาง'}</span>
                  <span className="label-xs num">{toWallet?.currency || 'THB'}{toWallet?.last4 ? ` · ${maskLast4(toWallet.last4)}` : ''}</span>
                </span>
                <ChevronRight size={20} strokeWidth={STROKE} className="chev" />
              </button>
            </div>

            {activeWallets.length < 2 && (
              <button type="button" className="btn-ghost" onClick={onAddWallet}>
                <Plus size={18} strokeWidth={STROKE} /> เพิ่มวอลเล็ทที่สองเพื่อโอนเงิน
              </button>
            )}

            {crossCurrency && (
              <div className="field">
                <label className="label" htmlFor="tx-to-amount">ยอดที่ได้รับปลายทาง ({destCur})</label>
                <input
                  id="tx-to-amount"
                  inputMode="decimal"
                  className="num"
                  placeholder={String(autoDestAmt || '0')}
                  value={toAmount}
                  onChange={(e) => setToAmount(e.target.value.replace(/[^\d.,]/g, ''))}
                />
                <span className="label-xs">คำนวณตามเรทอัตโนมัติ: {fmtCurrency(autoDestAmt, destCur)}</span>
              </div>
            )}

            <div className="field">
              <label className="label" htmlFor="tx-fee">ค่าธรรมเนียมโอน ({currency}, ไม่บังคับ)</label>
              <input id="tx-fee" inputMode="decimal" className="num" placeholder="0.00" value={fee} onChange={(e) => setFee(e.target.value.replace(/[^\d.,]/g, ''))} />
            </div>
          </div>
        ) : (
          <>
            <div className="field">
              <div className="between">
                <span className="label">หมวดหมู่</span>
                <button type="button" className="link" style={{ minHeight: 34 }} onClick={() => setCatModal(true)}>
                  <Plus size={15} strokeWidth={STROKE} /> เพิ่มหมวด
                </button>
              </div>
              <CategoryGrid type={type} value={categoryId} onPick={(c) => setCategoryId(c.id)} />
            </div>

            <div className="field">
              <span className="label">ช่องทางชำระเงิน</span>
              <div className="channel-grid" role="radiogroup" aria-label="ช่องทาง">
                {CHANNELS.map((ch) => (
                  <button
                    key={ch.code}
                    type="button"
                    id={`ch-${ch.code}`}
                    role="radio"
                    aria-checked={channel === ch.code}
                    className={`ch-btn ${channel === ch.code ? 'on' : ''}`}
                    onClick={() => selectChannel(ch.code)}
                  >
                    <Icon name={ch.icon} size={18} />
                    <span>{ch.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <span className="label">บัญชี / วอลเล็ท</span>
              <button id="tx-wallet" type="button" className="pick-btn" onClick={() => setPickWallet('from')}>
                {wallet ? <WalletLogo code={wallet.providerCode} /> : <span className="logo-fallback">—</span>}
                <span className="col grow">
                  <span className="truncate">{wallet?.name || 'เลือกวอลเล็ท'}</span>
                  <span className="label-xs num">{wallet?.currency || 'THB'}{wallet?.last4 ? ` · ${maskLast4(wallet.last4)}` : ''}</span>
                </span>
                <ChevronRight size={20} strokeWidth={STROKE} className="chev" />
              </button>
            </div>
          </>
        )}

        <div className="field">
          <label className="label" htmlFor="tx-date"><CalendarClock size={14} strokeWidth={STROKE} style={{ verticalAlign: -2 }} /> วันที่-เวลา</label>
          <input id="tx-date" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        {/* Phase 2: Tags */}
        <div className="field">
          <label className="label" htmlFor="tx-tags"><Tag size={14} strokeWidth={STROKE} style={{ verticalAlign: -2 }} /> แท็ก (ไม่บังคับ)</label>
          <div className="row" style={{ gap: 8 }}>
            <input
              id="tx-tags"
              placeholder="พิมพ์ชื่อแท็ก เช่น ลูกค้าA, ทริปญี่ปุ่น"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addTag(tagInput);
                }
              }}
            />
            <button type="button" id="btn-add-tag" className="btn-ghost" onClick={() => addTag(tagInput)}>เพิ่ม</button>
          </div>
          {tags.length > 0 && (
            <div className="tag-list" style={{ marginTop: 4 }}>
              {tags.map((tg) => (
                <span key={tg} className="tag-chip">
                  #{tg}
                  <button type="button" onClick={() => setTags(tags.filter((x) => x !== tg))} aria-label={`ลบแท็ก ${tg}`} style={{ display: 'grid', placeItems: 'center' }}>
                    <X size={14} strokeWidth={STROKE} />
                  </button>
                </span>
              ))}
            </div>
          )}
          {knownTags.filter((t) => !tags.includes(t)).length > 0 && (
            <div className="tag-list" style={{ marginTop: 2 }}>
              {knownTags
                .filter((t) => !tags.includes(t))
                .slice(0, 6)
                .map((tg) => (
                  <button key={tg} type="button" className="tag-chip sug" onClick={() => addTag(tg)}>
                    + #{tg}
                  </button>
                ))}
            </div>
          )}
        </div>

        <div className="field">
          <label className="label" htmlFor="tx-ref"><Hash size={14} strokeWidth={STROKE} style={{ verticalAlign: -2 }} /> อ้างอิง / เลขที่สลิป (ไม่บังคับ)</label>
          <input id="tx-ref" placeholder="เช่น 202611250001 หรือรหัสอ้างอิง" value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>

        <div className="field">
          <label className="label" htmlFor="tx-note"><StickyNote size={14} strokeWidth={STROKE} style={{ verticalAlign: -2 }} /> โน้ต / รายละเอียด (ไม่บังคับ)</label>
          <textarea id="tx-note" rows={2} placeholder="รายละเอียดเพิ่มเติม" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <div className="field">
          <span className="label">แนบสลิป (JPG/PNG ไม่เกิน 5MB)</span>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png" hidden onChange={onFile} />
          {slipPreview ? (
            <div className="stack" style={{ gap: 8 }}>
              <div style={{ position: 'relative' }}>
                <img
                  className="slip-prev"
                  src={slipPreview}
                  alt="ตัวอย่างสลิป"
                  style={{ cursor: 'zoom-in' }}
                  onClick={() => openSlip({ src: slipPreview, caption: 'ตัวอย่างสลิปก่อนบันทึก' })}
                />
                <button
                  type="button"
                  className="slip-pill"
                  style={{ position: 'absolute', right: 8, bottom: 8, background: 'rgba(7,8,12,0.82)' }}
                  onClick={() => openSlip({ src: slipPreview, caption: 'ตัวอย่างสลิปก่อนบันทึก' })}
                >
                  <Maximize2 size={14} strokeWidth={STROKE} /> ขยายเต็มจอ
                </button>
              </div>
              <div className="row">
                <button type="button" className="btn-ghost grow" onClick={() => fileRef.current.click()}><ImagePlus size={18} strokeWidth={STROKE} /> เปลี่ยนรูป</button>
                <button type="button" className="btn-ghost grow" style={{ color: '#ff8a95', borderColor: 'rgba(255,92,108,.35)', background: 'rgba(255,92,108,.06)' }} onClick={() => { setSlipFile(null); setSlipPreview(null); }}>
                  <Trash2 size={18} strokeWidth={STROKE} /> เอาออก
                </button>
              </div>
            </div>
          ) : (
            <button id="tx-slip" type="button" className="empty" style={{ padding: 18, width: '100%' }} onClick={() => fileRef.current.click()}>
              <ImagePlus size={22} strokeWidth={STROKE} className="gold" />
              แตะเพื่อเลือกรูปสลิป (แสดงตัวอย่างก่อนบันทึก)
            </button>
          )}
        </div>

        <button id="tx-save" className="btn-gold" disabled={!valid || saving} onClick={save}>
          {saving ? 'กำลังบันทึก…' : 'บันทึกรายการ'}
        </button>
      </div>

      {pickWallet && (
        <WalletSelect
          title={pickWallet === 'to' ? 'เลือกวอลเล็ทปลายทาง' : 'เลือกวอลเล็ท'}
          value={pickWallet === 'to' ? toWalletId : walletId}
          excludeId={pickWallet === 'to' ? walletId : undefined}
          onClose={() => setPickWallet(null)}
          onPick={(w) => {
            if (pickWallet === 'to') {
              setToWalletId(w.id);
            } else {
              setWalletId(w.id);
              setCurrency(w.currency || 'THB');
              setChannel(inferChannelFromWallet(w));
              if (toWalletId === w.id) {
                const alt = activeWallets.find((x) => x.id !== w.id);
                setToWalletId(alt?.id || null);
              }
            }
            setPickWallet(null);
          }}
          onAdd={onAddWallet ? () => { setPickWallet(null); onAddWallet(); } : undefined}
        />
      )}

      {catModal && (
        <CategoryForm
          type={type}
          onClose={() => setCatModal(false)}
          onSaved={(newId) => {
            if (newId) setCategoryId(newId);
          }}
        />
      )}
    </Sheet>
  );
}

/* ======================= Transaction detail + Edit History ======================= */
export function TxDetail({ tx, onClose, onEdit }) {
  const { categories, wallets, settings, usdtRate, deleteTransaction, getSlipUrl, fetchTxHistory } = useStore();
  const { confirm, toast, openSlip } = useUi();
  const [slip, setSlip] = useState(null);
  const [hist, setHist] = useState([]);
  const [showHist, setShowHist] = useState(false);

  const isTransfer = tx.type === 'transfer';
  const cat = categories.find((c) => c.id === tx.categoryId);
  const wallet = wallets.find((w) => w.id === tx.walletId);
  const toWallet = tx.toWalletId ? wallets.find((w) => w.id === tx.toWalletId) : null;
  const ch = channelInfo(tx.channel || inferChannelFromWallet(wallet));

  useEffect(() => {
    let url;
    getSlipUrl(tx.slipId).then((u) => setSlip((url = u)));
    fetchTxHistory(tx.id).then(setHist).catch(() => {});
    return () => url && URL.revokeObjectURL(url);
  }, [tx.id, tx.slipId, getSlipUrl, fetchTxHistory]);

  const del = async () => {
    const ok = await confirm({
      title: 'ยืนยันการลบรายการ?',
      message: `${isTransfer ? 'รายการโอน' : cat?.name || ''} ${fmtCurrency(tx.amount, tx.currency)} — ย้ายไปถังขยะ (กู้คืนได้ในหน้าบัญชี)`,
      okText: 'ลบรายการ',
      danger: true,
    });
    if (!ok) return;
    await deleteTransaction(tx.id);
    haptic('success');
    toast('ย้ายรายการไปถังขยะแล้ว');
    onClose();
  };

  const caption = `${isTransfer ? 'โอนเงิน' : cat?.name || ''} · ${fmtCurrency(tx.amount, tx.currency)}${tx.reference ? ` · #${tx.reference}` : ''}`;
  const actionLabel = { create: 'สร้างรายการ', update: 'แก้ไขข้อมูล', delete: 'ย้ายไปถังขยะ', restore: 'กู้คืนรายการ' };

  return (
    <Sheet title="รายละเอียดรายการ" onClose={onClose}>
      <div className="stack">
        <div className="col" style={{ alignItems: 'center', gap: 8, padding: '6px 0 4px' }}>
          <CategoryIcon cat={cat} transfer={isTransfer} size={56} />
          <span className="label">
            {isTransfer ? 'โอนระหว่างวอลเล็ท' : `${tx.type === 'income' ? 'รายรับ' : 'รายจ่าย'} · ${cat?.name}`}
          </span>
          <span className={`num-xl ${tx.type}`}>{fmtCurrency(tx.amount, tx.currency)}</span>
          {tx.currency === 'USDT' && (
            <span className="label-xs num">≈ {fmtTHB(txTHB(tx, usdtRate))} (เรท {tx.fxRate})</span>
          )}
        </div>

        <div className="card">
          {isTransfer ? (
            <>
              <Row label="โอนจาก">{wallet?.name || '—'}</Row>
              <Row label="ไปยัง">{toWallet?.name || '—'}</Row>
              {tx.toAmount != null && toWallet && toWallet.currency !== tx.currency && (
                <Row label="ปลายทางได้รับ"><span className="num">{fmtCurrency(tx.toAmount, toWallet.currency)}</span></Row>
              )}
              {tx.fee > 0 && <Row label="ค่าธรรมเนียม"><span className="num expense">{fmtCurrency(tx.fee, tx.currency)}</span></Row>}
            </>
          ) : (
            <>
              <Row label="ช่องทาง"><span className="ch-tag">{ch.label}</span></Row>
              <Row label="บัญชี / วอลเล็ท">
                <span className="row" style={{ gap: 8 }}>
                  {wallet && <WalletLogo code={wallet.providerCode} mini={false} />}
                  <span className="col" style={{ alignItems: 'flex-end' }}>
                    <span>{wallet?.name || '—'}</span>
                    {wallet?.last4 && <span className="label-xs num">{maskLast4(wallet.last4)}</span>}
                  </span>
                </span>
              </Row>
            </>
          )}
          <Row label="วันที่-เวลา">{dateTimeLabel(tx.date, settings.yearFormat)}</Row>
          <Row label="อ้างอิง">{tx.reference ? <span className="num">{tx.reference}</span> : <span className="label-xs">—</span>}</Row>
          <Row label="โน้ต">{tx.note || <span className="label-xs">—</span>}</Row>
          {tx.tags?.length > 0 && (
            <Row label="แท็ก">
              <div className="tag-list" style={{ justifyContent: 'flex-end' }}>
                {tx.tags.map((tg) => <span key={tg} className="tag-chip">#{tg}</span>)}
              </div>
            </Row>
          )}
        </div>

        {slip && (
          <div className="field">
            <div className="between">
              <span className="label">สลิปแนบ (ส่วนตัว)</span>
              <button type="button" id="btn-expand-slip" className="slip-pill" onClick={() => openSlip({ src: slip, caption })}>
                <Maximize2 size={14} strokeWidth={STROKE} /> ดูสลิปเต็มจอ
              </button>
            </div>
            <img className="slip-prev" src={slip} alt="สลิปที่แนบ" style={{ cursor: 'zoom-in' }} onClick={() => openSlip({ src: slip, caption })} />
          </div>
        )}

        {/* Phase 3: Edit History */}
        {hist.length > 0 && (
          <div className="card" style={{ padding: '10px 14px' }}>
            <button type="button" className="between" style={{ width: '100%', minHeight: 36 }} onClick={() => setShowHist((s) => !s)}>
              <span className="row" style={{ gap: 8 }}>
                <History size={16} strokeWidth={STROKE} className="gold" />
                <span className="label">ประวัติการแก้ไข ({hist.length})</span>
              </span>
              <span className="label-xs gold">{showHist ? 'ซ่อน' : 'ดูประวัติ'}</span>
            </button>
            {showHist && (
              <div className="list" style={{ marginTop: 8 }}>
                {hist.map((h) => (
                  <div key={h.id} className="col" style={{ padding: '6px 0', borderTop: '1px solid var(--line-2)', gap: 2 }}>
                    <div className="between">
                      <span style={{ fontSize: 14, fontWeight: 500 }}>{actionLabel[h.action] || h.action}</span>
                      <span className="label-xs">{dateTimeLabel(h.changedAt, settings.yearFormat)}</span>
                    </div>
                    {h.summary && <span className="label-xs">{h.summary}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="row">
          <button id="btn-tx-delete" className="btn-danger grow" onClick={del}><Trash2 size={18} strokeWidth={STROKE} /> ลบ</button>
          <button id="btn-tx-edit" className="btn-gold grow" onClick={onEdit}><Pencil size={18} strokeWidth={STROKE} /> แก้ไข</button>
        </div>
      </div>
    </Sheet>
  );
}

function Row({ label, children }) {
  return (
    <div className="between" style={{ minHeight: 48, padding: '6px 0', borderBottom: '1px solid var(--line-2)' }}>
      <span className="label">{label}</span>
      <span style={{ textAlign: 'right' }}>{children}</span>
    </div>
  );
}

/* ======================= Wallet form (supports THB & USDT) ======================= */
export function WalletForm({ initial, onClose }) {
  const { saveWallet, deleteWallet, transactions } = useStore();
  const { confirm, toast } = useUi();
  const [code, setCode] = useState(initial?.providerCode || null);
  const [name, setName] = useState(initial?.name || '');
  const [currency, setCurrency] = useState(initial?.currency || 'THB');
  const [last4, setLast4] = useState(initial?.last4 || '');
  const [initBal, setInitBal] = useState(initial ? String(initial.initialBalance ?? 0) : '');
  const [picker, setPicker] = useState(!initial);
  const p = code ? findProvider(code) : null;

  const save = async () => {
    if (!code) return;
    await saveWallet({
      id: initial?.id,
      providerCode: code,
      group: p?.group || 'cash',
      name: name.trim() || p?.th || code,
      currency,
      last4: last4 || null,
      initialBalance: parseFloat(String(initBal).replace(/,/g, '')) || 0,
    });
    haptic('success');
    toast('บันทึกวอลเล็ทแล้ว');
    onClose();
  };
  const del = async () => {
    const ok = await confirm({ title: 'ลบวอลเล็ทนี้?', message: 'วอลเล็ทจะถูกย้ายไปถังขยะ (กู้คืนได้) ส่วนประวัติธุรกรรมเดิมยังเก็บไว้ครบ', okText: 'ลบ', danger: true });
    if (!ok) return;
    await deleteWallet(initial.id);
    toast('ย้ายวอลเล็ทไปถังขยะแล้ว');
    onClose();
  };

  return (
    <Sheet title={initial ? 'แก้ไขวอลเล็ท' : 'เพิ่มวอลเล็ท'} onClose={onClose}>
      <div className="stack">
        <button type="button" className="pick-btn" onClick={() => setPicker(true)}>
          {code ? <WalletLogo code={code} /> : <span className="logo-fallback">?</span>}
          <span className="col grow">
            <span>{p?.th || 'เลือกธนาคาร / วอลเล็ท'}</span>
            {p && <span className="label-xs num">{p.code}</span>}
          </span>
          <ChevronRight size={20} strokeWidth={STROKE} className="chev" />
        </button>

        <div className="field">
          <span className="label">สกุลเงินของวอลเล็ท</span>
          <div className="seg">
            <button type="button" className={currency === 'THB' ? 'on' : ''} onClick={() => setCurrency('THB')}>บาท (THB)</button>
            <button type="button" className={currency === 'USDT' ? 'on' : ''} onClick={() => setCurrency('USDT')}>USDT</button>
          </div>
        </div>

        <div className="field">
          <label className="label" htmlFor="w-name">ชื่อที่แสดง</label>
          <input id="w-name" placeholder={p?.th || 'เช่น บัญชีออมทรัพย์'} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {p?.group !== 'cash' && (
          <div className="field">
            <label className="label" htmlFor="w-last4">เลขบัญชี 4 ตัวท้าย (ไม่บังคับ)</label>
            <input
              id="w-last4"
              inputMode="numeric"
              placeholder="เช่น 1234"
              value={last4}
              onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(-4))}
              className="num"
            />
            <span className="label-xs">เก็บเพียง 4 ตัวท้ายเพื่อความปลอดภัย แสดงเป็น {maskLast4(last4 || '1234')}</span>
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor="w-init">ยอดเริ่มต้น ({currency})</label>
          <input id="w-init" inputMode="decimal" className="num" placeholder="0.00" value={initBal} onChange={(e) => setInitBal(e.target.value.replace(/[^\d.,-]/g, ''))} />
          {initial && <span className="label-xs">ยอดปัจจุบัน {fmtCurrency(walletBalance({ ...initial, currency, initialBalance: parseFloat(initBal) || 0 }, transactions), currency)}</span>}
        </div>
        <button className="btn-gold" disabled={!code} onClick={save}>บันทึก</button>
        {initial && <button className="btn-danger" onClick={del}><Trash2 size={18} strokeWidth={STROKE} /> ลบวอลเล็ท</button>}
      </div>
      {picker && (
        <ProviderPicker
          value={code}
          onClose={() => setPicker(false)}
          onPick={(prov) => {
            setCode(prov.code);
            if (!name || name === p?.th) setName(prov.th);
            if (prov.code === 'USDT') setCurrency('USDT');
            setPicker(false);
          }}
        />
      )}
    </Sheet>
  );
}

/* ======================= Category form ======================= */
export function CategoryForm({ initial, type, onClose, onSaved }) {
  const { saveCategory, deleteCategory } = useStore();
  const { confirm, toast } = useUi();
  const [name, setName] = useState(initial?.name || '');
  const [icon, setIcon] = useState(initial?.icon || 'ellipsis');
  const [color, setColor] = useState(initial?.color || '#4C8DFF');
  const t = initial?.type || type;

  const save = async () => {
    if (!name.trim()) return;
    const id = await saveCategory({ id: initial?.id, type: t, name: name.trim(), icon, color });
    toast('บันทึกหมวดหมู่แล้ว');
    onSaved?.(id);
    onClose();
  };
  const del = async () => {
    const ok = await confirm({ title: 'ลบหมวดหมู่นี้?', message: 'หมวดหมู่จะย้ายไปถังขยะ (กู้คืนได้) รายการเดิมที่ใช้หมวดนี้ยังแสดงตามปกติ', okText: 'ลบ', danger: true });
    if (!ok) return;
    await deleteCategory(initial.id);
    toast('ย้ายหมวดหมู่ไปถังขยะแล้ว');
    onClose();
  };

  return (
    <Sheet title={initial ? 'แก้ไขหมวดหมู่' : `เพิ่มหมวด${t === 'income' ? 'รายรับ' : 'รายจ่าย'}`} onClose={onClose}>
      <div className="stack">
        <div className="row" style={{ justifyContent: 'center', padding: '4px 0' }}>
          <CategoryIcon cat={{ icon, color }} size={64} />
        </div>
        <div className="field">
          <label className="label" htmlFor="c-name">ชื่อหมวดหมู่</label>
          <input id="c-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น ค่าเซิร์ฟเวอร์" />
        </div>
        <div className="field">
          <span className="label">สี</span>
          <ColorPicker value={color} onPick={setColor} />
        </div>
        <div className="field">
          <span className="label">ไอคอน</span>
          <IconPicker value={icon} onPick={setIcon} />
        </div>
        <button className="btn-gold" disabled={!name.trim()} onClick={save}>บันทึก</button>
        {initial && <button className="btn-danger" onClick={del}><Trash2 size={18} strokeWidth={STROKE} /> ลบหมวดหมู่</button>}
      </div>
    </Sheet>
  );
}

/* ======================= Budget form ======================= */
export function BudgetForm({ initial, onClose }) {
  const { categories, activeBudgets, saveBudget, deleteBudget } = useStore();
  const { confirm, toast } = useUi();
  const [categoryId, setCategoryId] = useState(initial?.categoryId || null);
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const used = new Set(activeBudgets.filter((b) => b.id !== initial?.id).map((b) => b.categoryId));
  const amt = parseFloat(String(amount).replace(/,/g, ''));
  const options = categories.filter((c) => c.type === 'expense' && !c.deletedAt && !used.has(c.id));

  const save = async () => {
    if (!(amt > 0) || !categoryId) return;
    await saveBudget({ id: initial?.id, categoryId, amount: amt });
    haptic('success');
    toast('บันทึกงบประมาณแล้ว');
    onClose();
  };
  const del = async () => {
    const ok = await confirm({ title: 'ลบงบประมาณนี้?', okText: 'ลบ', danger: true });
    if (!ok) return;
    await deleteBudget(initial.id);
    toast('ย้ายงบประมาณไปถังขยะแล้ว');
    onClose();
  };

  return (
    <Sheet title={initial ? 'แก้ไขงบประมาณ' : 'เพิ่มงบประมาณ'} onClose={onClose}>
      <div className="stack">
        <div className="card" style={{ padding: '12px 16px' }}>
          <span className="label">งบต่อเดือน (บาท)</span>
          <div className="row" style={{ gap: 6 }}>
            <span className="num-lg gold">฿</span>
            <input id="b-amount" className="amount-input" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))} />
          </div>
        </div>
        <div className="field">
          <span className="label">หมวดรายจ่าย</span>
          {initial ? (
            <div className="pick-btn"><CategoryIcon cat={categories.find((c) => c.id === categoryId)} /><span>{categories.find((c) => c.id === categoryId)?.name}</span></div>
          ) : options.length ? (
            <div className="grid-cats">
              {options.map((c) => (
                <button key={c.id} type="button" className={categoryId === c.id ? 'on' : ''} onClick={() => setCategoryId(c.id)}>
                  <CategoryIcon cat={c} />
                  <span>{c.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty">ทุกหมวดมีงบประมาณแล้ว</div>
          )}
        </div>
        <button className="btn-gold" disabled={!(amt > 0) || !categoryId} onClick={save}>บันทึก</button>
        {initial && <button className="btn-danger" onClick={del}><Trash2 size={18} strokeWidth={STROKE} /> ลบงบประมาณ</button>}
      </div>
    </Sheet>
  );
}
