import { useMemo, useState } from 'react';
import { PieChart, ReceiptText, Plus, Wallet, SlidersHorizontal, Search, BellOff, ShieldAlert } from 'lucide-react';
import { useStore } from './lib/store';
import { fmtCurrency, dateTimeLabel } from './lib/format';
import { channelInfo, inferChannelFromWallet } from './lib/channels';
import { Sheet, STROKE } from './components/ui';
import { TxForm, TxDetail, WalletForm } from './components/forms';
import Overview from './screens/Overview';
import Transactions, { TxRow } from './screens/Transactions';
import Summary from './screens/Summary';
import Account, { WalletsPage, CategoriesPage } from './screens/Account';
import {
  PinLockScreen,
  RecurringPage,
  AdvancedReportsPage,
  SecurityPinPage,
  TrashAndHistoryPage,
  BotSettingsPage,
} from './screens/Phase3And4';

const TABS = [
  { id: 'overview', label: 'ภาพรวม', icon: PieChart },
  { id: 'transactions', label: 'รายการ', icon: ReceiptText },
  { id: 'plus', label: 'เพิ่ม' },
  { id: 'summary', label: 'บัญชี', icon: Wallet },
  { id: 'account', label: 'ตั้งค่า', icon: SlidersHorizontal },
];

export default function App() {
  const { ready, authError, hasPin, pinUnlocked, reload } = useStore();
  const [tab, setTab] = useState('overview');
  const [summaryMode, setSummaryMode] = useState('wallets');
  const [page, setPage] = useState(null);
  const [txForm, setTxForm] = useState(null);
  const [txView, setTxView] = useState(null);
  const [search, setSearch] = useState(false);
  const [notif, setNotif] = useState(false);
  const [walletForm, setWalletForm] = useState(false);

  if (!ready) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <span className="en gold" style={{ letterSpacing: '0.2em', fontWeight: 600 }}>CE MONEY TRACKER PRO</span>
      </div>
    );
  }

  if (authError) {
    return (
      <div className="app" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div className="card stack" style={{ textAlign: 'center', alignItems: 'center', maxWidth: 360 }}>
          <ShieldAlert size={40} strokeWidth={STROKE} className="gold" />
          <h1 className="h1">ต้องเข้าใช้งานผ่าน Telegram</h1>
          <p className="label" style={{ margin: 0 }}>{authError}</p>
          <button className="btn-gold" onClick={() => reload().then(() => window.location.reload())}>ลองใหม่อีกครั้ง</button>
        </div>
      </div>
    );
  }

  if (hasPin && !pinUnlocked) {
    return <PinLockScreen />;
  }

  const OVERLAY_PAGES = new Set(['wallets', 'categories', 'recurring', 'reports', 'security', 'trash', 'bot']);
  const go = (where) => {
    if (OVERLAY_PAGES.has(where)) setPage(where);
    else if (where === 'budgets') { setSummaryMode('budgets'); setTab('summary'); }
    else if (where === 'summary') { setSummaryMode('summary'); setTab('summary'); }
    else setTab(where);
  };
  const openTx = (t) => setTxView(t);
  const openQuickAdd = (defaultType) => setTxForm({ defaultType });
  const common = {
    go,
    openTx,
    openQuickAdd,
    openSearch: () => setSearch(true),
    openNotifications: () => setNotif(true),
  };

  return (
    <div className="app">
      {tab === 'overview' && <Overview {...common} />}
      {tab === 'transactions' && <Transactions {...common} />}
      {tab === 'summary' && <Summary key={summaryMode} defaultView={summaryMode} {...common} />}
      {tab === 'account' && <Account {...common} />}

      <nav className="nav" aria-label="เมนูหลัก">
        {TABS.map((t) =>
          t.id === 'plus' ? (
            <button key="plus" id="nav-plus" className="nav-plus-wrap" onClick={() => setTxForm({})} aria-label="เพิ่มรายการ">
              <span className="nav-plus-sq">
                <Plus size={22} strokeWidth={2.4} />
              </span>
              <span className="gold" style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.1 }}>{t.label}</span>
            </button>
          ) : (
            <button
              key={t.id}
              id={`nav-${t.id}`}
              className={`nav-item ${tab === t.id ? 'on' : ''}`}
              onClick={() => {
                if (t.id === 'summary') setSummaryMode('wallets');
                setTab(t.id);
                window.scrollTo(0, 0);
              }}
              aria-current={tab === t.id ? 'page' : undefined}
            >
              <t.icon size={20} strokeWidth={STROKE} />
              <span>{t.label}</span>
            </button>
          ),
        )}
      </nav>

      {page === 'wallets' && <WalletsPage onClose={() => setPage(null)} />}
      {page === 'categories' && <CategoriesPage onClose={() => setPage(null)} />}
      {page === 'recurring' && <RecurringPage onClose={() => setPage(null)} />}
      {page === 'reports' && <AdvancedReportsPage onClose={() => setPage(null)} />}
      {page === 'security' && <SecurityPinPage onClose={() => setPage(null)} />}
      {page === 'trash' && <TrashAndHistoryPage onClose={() => setPage(null)} />}
      {page === 'bot' && <BotSettingsPage onClose={() => setPage(null)} />}

      {search && <SearchSheet onClose={() => setSearch(false)} openTx={openTx} />}
      {notif && <NotificationsSheet onClose={() => setNotif(false)} />}
      {txView && (
        <TxDetail
          tx={txView}
          onClose={() => setTxView(null)}
          onEdit={() => { setTxForm(txView); setTxView(null); }}
        />
      )}
      {txForm && (
        <TxForm
          initial={txForm.id ? txForm : null}
          defaultType={txForm.defaultType}
          onClose={() => setTxForm(null)}
          onAddWallet={() => setWalletForm(true)}
        />
      )}
      {walletForm && <WalletForm onClose={() => setWalletForm(false)} />}
    </div>
  );
}

function SearchSheet({ onClose, openTx }) {
  const { activeTx, categories, wallets } = useStore();
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return activeTx
      .filter((t) => {
        const cat = categories.find((c) => c.id === t.categoryId);
        const w = wallets.find((x) => x.id === t.walletId);
        const toW = t.toWalletId ? wallets.find((x) => x.id === t.toWalletId) : null;
        const ch = channelInfo(t.channel || inferChannelFromWallet(w)).label;
        return [
          t.reference,
          t.note,
          cat?.name,
          w?.name,
          toW?.name,
          w?.providerCode,
          ch,
          ...(t.tags || []),
          String(t.amount),
          fmtCurrency(t.amount, t.currency),
        ].some((x) => x?.toLowerCase().includes(s));
      })
      .slice(0, 100);
  }, [q, activeTx, categories, wallets]);
  return (
    <Sheet title="ค้นหารายการ" onClose={onClose}>
      <div className="stack">
        <div style={{ position: 'relative' }}>
          <Search size={18} strokeWidth={STROKE} style={{ position: 'absolute', left: 14, top: 15, color: 'var(--text-3)' }} />
          <input id="search-input" autoFocus placeholder="ค้นหาอ้างอิง โน้ต แท็ก หมวด ช่องทาง หรือยอดเงิน" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 42 }} />
        </div>
        {q && results.length === 0 && <div className="empty">ไม่พบรายการ</div>}
        <div className="list">
          {results.map((t) => <TxRow key={t.id} tx={t} showDate onClick={() => { onClose(); openTx(t); }} />)}
        </div>
      </div>
    </Sheet>
  );
}

function NotificationsSheet({ onClose }) {
  const { notifications, markAllRead, settings } = useStore();
  const close = () => {
    markAllRead();
    onClose();
  };
  return (
    <Sheet title="การแจ้งเตือน" onClose={close}>
      {notifications.length === 0 ? (
        <div className="empty"><BellOff size={22} strokeWidth={STROKE} />ยังไม่มีการแจ้งเตือน</div>
      ) : (
        <div className="list">
          {notifications.map((n) => (
            <div key={n.id} className="item" style={{ alignItems: 'flex-start', cursor: 'default' }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, marginTop: 9, background: n.read ? 'transparent' : 'var(--gold)', flexShrink: 0 }} />
              <div className="col grow" style={{ gap: 2 }}>
                <span style={{ fontWeight: 500, color: n.id.endsWith('over') ? '#ff8a95' : 'var(--warn)' }}>{n.title}</span>
                <span className="label">{n.body}</span>
                <span className="label-xs">{dateTimeLabel(n.createdAt, settings.yearFormat)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
