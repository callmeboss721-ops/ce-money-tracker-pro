import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, Landmark, Smartphone, Bitcoin, Wallet, Repeat, ZoomIn, ZoomOut, Download } from 'lucide-react';
import { logoUrl, findProvider } from '../lib/logos';
import { ICON_MAP } from '../lib/iconSet';
import { useStore } from '../lib/store';

export const ICON_SIZE = 20;
export const STROKE = 1.75;

/** Lucide icon by kebab-case name, with uniform size/stroke. */
export function Icon({ name, size = ICON_SIZE, ...rest }) {
  const Cmp = ICON_MAP[name] || ICON_MAP.ellipsis;
  return <Cmp size={size} strokeWidth={STROKE} aria-hidden="true" {...rest} />;
}

const GROUP_ICON = { bank: Landmark, ewallet: Smartphone, crypto: Bitcoin, cash: Wallet };

/**
 * Official logo only (from /assets/logos). If the file is missing or fails to
 * load: dark-grey circle + abbreviation. Logos are never drawn/guessed.
 */
export function WalletLogo({ code, mini = false }) {
  const p = findProvider(code);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [code]);
  const url = p?.file ? logoUrl(p.file) : null;

  let inner;
  if (url && !failed) {
    inner = (
      <div className="logo-box">
        <img src={url} alt={p.en} loading="lazy" onError={() => setFailed(true)} />
      </div>
    );
  } else if (mini || (p && !p.file && p.icon)) {
    const G = p?.icon ? null : GROUP_ICON[p?.group] || Wallet;
    inner = (
      <div className="logo-fallback" aria-label={p?.th || code}>
        {G ? <G size={mini ? 11 : 20} strokeWidth={STROKE} /> : <Icon name={p.icon} size={mini ? 11 : 20} />}
      </div>
    );
  } else {
    inner = (
      <div className="logo-fallback" aria-label={p?.th || code} style={{ fontSize: (code || '').length > 6 ? 8.5 : 10.5 }}>
        {code}
      </div>
    );
  }
  return mini ? <span className="mini-logo">{inner}</span> : inner;
}

export function CategoryIcon({ cat, transfer, walletCode, size = 40 }) {
  const style = { width: size, height: size, background: transfer ? undefined : cat?.color || '#7A8497' };
  return (
    <span className={`cat-ic ${transfer ? 'repeat' : ''}`} style={style}>
      {transfer ? <Repeat size={size * 0.48} strokeWidth={STROKE} /> : <Icon name={cat?.icon || 'ellipsis'} size={size * 0.48} />}
      {walletCode && <WalletLogo code={walletCode} mini />}
    </span>
  );
}

export function Sheet({ title, onClose, children, full = false, left, right }) {
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    const bb = tg?.BackButton;
    if (!bb || !tg.initData) return;
    bb.show();
    bb.onClick(onClose);
    return () => {
      bb.offClick(onClose);
      bb.hide();
    };
  }, [onClose]);
  return createPortal(
    <>
      <div className="backdrop" onClick={onClose} />
      <section className={`sheet ${full ? 'full' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        {!full && <div className="sheet-grip" />}
        <header className="sheet-head" style={full ? { paddingTop: 12 } : undefined}>
          {left || (
            <button className="icon-btn plain" onClick={onClose} aria-label="ปิด">
              {full ? <ChevronLeft size={22} strokeWidth={STROKE} /> : <X size={22} strokeWidth={STROKE} />}
            </button>
          )}
          <h2 className="h1">{title}</h2>
          {right || <span style={{ width: 44 }} />}
        </header>
        <div className="sheet-body">{children}</div>
      </section>
    </>,
    document.body,
  );
}

// ---------- confirm dialog, toast & full-screen slip viewer ----------
const UiCtx = createContext(null);
export const useUi = () => useContext(UiCtx);

export function UiProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const [toast, setToast] = useState(null);
  const [slipModal, setSlipModal] = useState(null); // { src, slipId, caption }

  const confirm = useCallback(
    (opts) =>
      new Promise((resolve) => {
        setDialog({ ...opts, resolve });
      }),
    [],
  );
  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(window.__toastT);
    window.__toastT = setTimeout(() => setToast(null), 2200);
  }, []);

  const openSlip = useCallback((opts) => {
    setSlipModal(opts);
  }, []);

  const close = (v) => {
    dialog?.resolve(v);
    setDialog(null);
  };

  return (
    <UiCtx.Provider value={{ confirm, toast: showToast, openSlip }}>
      {children}
      {dialog &&
        createPortal(
          <>
            <div className="backdrop dialog-backdrop" onClick={() => close(false)} />
            <div className="dialog" role="alertdialog" aria-modal="true">
              <h3 className="h1" style={{ marginBottom: 8 }}>{dialog.title}</h3>
              {dialog.message && <p className="muted" style={{ margin: '0 0 18px', fontWeight: 300 }}>{dialog.message}</p>}
              <div className="row" style={{ gap: 10 }}>
                <button className="btn-ghost grow" style={{ color: 'var(--text-2)', borderColor: 'var(--line-2)', background: 'transparent' }} onClick={() => close(false)}>
                  {dialog.cancelText || 'ยกเลิก'}
                </button>
                {dialog.danger ? (
                  <button className="btn-danger grow" style={{ minHeight: 44 }} onClick={() => close(true)}>
                    {dialog.okText || 'ยืนยัน'}
                  </button>
                ) : (
                  <button className="btn-gold grow" style={{ minHeight: 44 }} onClick={() => close(true)}>
                    {dialog.okText || 'ยืนยัน'}
                  </button>
                )}
              </div>
            </div>
          </>,
          document.body,
        )}
      {slipModal && <SlipLightbox {...slipModal} onClose={() => setSlipModal(null)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </UiCtx.Provider>
  );
}

function SlipLightbox({ src: initialSrc, slipId, caption, onClose }) {
  const { getSlipUrl } = useStore();
  const [src, setSrc] = useState(initialSrc || null);
  const [loading, setLoading] = useState(!initialSrc && Boolean(slipId));
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    let revoked = null;
    if (!initialSrc && slipId) {
      setLoading(true);
      getSlipUrl(slipId)
        .then((u) => {
          revoked = u;
          setSrc(u);
        })
        .finally(() => setLoading(false));
    }
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [initialSrc, slipId, getSlipUrl, onClose]);

  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="ดูสลิปขยายเต็มจอ">
      <div className="lightbox-bar">
        <div className="col grow" style={{ gap: 0 }}>
          <span style={{ fontWeight: 600 }}>รูปสลิป</span>
          {caption && <span className="label-xs truncate">{caption}</span>}
        </div>
        <div className="row" style={{ gap: 8 }}>
          {src && (
            <>
              <button className="icon-btn" onClick={() => setZoomed((z) => !z)} aria-label={zoomed ? 'ย่อ' : 'ขยาย'}>
                {zoomed ? <ZoomOut size={20} strokeWidth={STROKE} /> : <ZoomIn size={20} strokeWidth={STROKE} />}
              </button>
              <a className="icon-btn" href={src} download="slip.png" aria-label="ดาวน์โหลดสลิป">
                <Download size={20} strokeWidth={STROKE} />
              </a>
            </>
          )}
          <button id="btn-close-lightbox" className="icon-btn" onClick={onClose} aria-label="ปิดรูปสลิป">
            <X size={22} strokeWidth={STROKE} />
          </button>
        </div>
      </div>
      <div className="lightbox-stage" onClick={(e) => e.target === e.currentTarget && onClose()}>
        {loading ? (
          <span className="label">กำลังโหลดสลิปแบบส่วนตัว…</span>
        ) : src ? (
          <img
            src={src}
            alt="สลิปเต็มจอ"
            className={zoomed ? 'zoomed' : ''}
            onClick={() => setZoomed((z) => !z)}
          />
        ) : (
          <span className="label">ไม่พบไฟล์สลิปหรือไม่มีสิทธิ์เข้าถึง</span>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function Switch({ on, onChange, label }) {
  return <button role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />;
}
