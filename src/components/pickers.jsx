import { useMemo, useState } from 'react';
import { Search, Check, Plus } from 'lucide-react';
import { GROUPS, getProviders } from '../lib/logos';
import { CATEGORY_COLORS } from '../lib/categories';
import { ICON_NAMES } from '../lib/iconSet';
import { useStore } from '../lib/store';
import { walletBalance } from '../lib/calc';
import { fmtCurrency, maskLast4, HIDDEN } from '../lib/format';
import { Sheet, WalletLogo, CategoryIcon, Icon, STROKE } from './ui';

/** Choose a provider (bank / e-wallet / crypto / cash) from logos.json. */
export function ProviderPicker({ value, onPick, onClose }) {
  const [tab, setTab] = useState(GROUPS.find((g) => getProviders()[g.group].some((p) => p.code === value))?.group || 'bank');
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const all = getProviders();
    const src = q.trim() ? Object.values(all).flat() : all[tab];
    const s = q.trim().toLowerCase();
    return s ? src.filter((p) => [p.th, p.en, p.code].some((x) => x?.toLowerCase().includes(s))) : src;
  }, [tab, q]);

  return (
    <Sheet title="เลือกผู้ให้บริการ" onClose={onClose}>
      <div className="stack">
        <div className="seg" role="tablist">
          {GROUPS.map((g) => (
            <button key={g.group} role="tab" aria-selected={tab === g.group} className={tab === g.group && !q ? 'on' : ''} onClick={() => { setTab(g.group); setQ(''); }}>
              {g.label}
            </button>
          ))}
        </div>
        <div style={{ position: 'relative' }}>
          <Search size={18} strokeWidth={STROKE} style={{ position: 'absolute', left: 14, top: 15, color: 'var(--text-3)' }} />
          <input id="provider-search" placeholder="ค้นหาธนาคาร / วอลเล็ท" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 42 }} />
        </div>
        <div className="grid-providers">
          {list.map((p) => (
            <button key={p.code} className={`prov ${value === p.code ? 'on' : ''}`} onClick={() => onPick(p)}>
              <WalletLogo code={p.code} />
              <span className="th">{p.th}</span>
              <span className="code">{p.code}</span>
            </button>
          ))}
        </div>
        {list.length === 0 && <div className="empty">ไม่พบรายการที่ค้นหา</div>}
      </div>
    </Sheet>
  );
}

/** Choose one of the user's wallets. */
export function WalletSelect({ value, excludeId, title = 'เลือกวอลเล็ท', onPick, onClose, onAdd }) {
  const { activeWallets, transactions, settings } = useStore();
  const shown = activeWallets.filter((w) => w.id !== excludeId);
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="list">
        {shown.map((w) => (
          <button key={w.id} className="item" onClick={() => onPick(w)}>
            <WalletLogo code={w.providerCode} />
            <div className="col grow">
              <span className="truncate">{w.name}</span>
              <span className="label-xs num">{w.currency || 'THB'}{w.last4 ? ` · ${maskLast4(w.last4)}` : ''}</span>
            </div>
            <span className="num-md">{settings.hideBalance ? HIDDEN : fmtCurrency(walletBalance(w, transactions), w.currency)}</span>
            {value === w.id && <Check size={20} strokeWidth={STROKE} className="gold" />}
          </button>
        ))}
      </div>
      {onAdd && (
        <button className="btn-ghost" style={{ width: '100%', marginTop: 12 }} onClick={onAdd}>
          <Plus size={18} strokeWidth={STROKE} /> เพิ่มวอลเล็ทใหม่
        </button>
      )}
    </Sheet>
  );
}

/** Grid of categories (circle icon + name). */
export function CategoryGrid({ type, value, onPick }) {
  const { categories } = useStore();
  const list = categories.filter((c) => c.type === type && !c.deletedAt);
  return (
    <div className="grid-cats">
      {list.map((c) => (
        <button key={c.id} type="button" className={value === c.id ? 'on' : ''} onClick={() => onPick(c)} aria-pressed={value === c.id}>
          <CategoryIcon cat={c} />
          <span>{c.name}</span>
        </button>
      ))}
    </div>
  );
}

export function IconPicker({ value, onPick }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? ICON_NAMES.filter((n) => n.includes(s)) : ICON_NAMES;
  }, [q]);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <input id="icon-search" placeholder="ค้นหาไอคอน (ภาษาอังกฤษ เช่น car, food)" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="icon-grid">
        {shown.map((n) => (
          <button key={n} type="button" className={value === n ? 'on' : ''} onClick={() => onPick(n)} aria-label={n} title={n}>
            <Icon name={n} />
          </button>
        ))}
      </div>
    </div>
  );
}

export function ColorPicker({ value, onPick }) {
  return (
    <div className="swatches">
      {CATEGORY_COLORS.map((c) => (
        <button key={c} type="button" className={value === c ? 'on' : ''} style={{ background: c }} onClick={() => onPick(c)} aria-label={`สี ${c}`} />
      ))}
    </div>
  );
}
