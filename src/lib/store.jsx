import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getAll, get, getMeta, setMeta, uid, requestPersistence, STORES, DB_VERSION } from './db';
import { loadProviders } from './logos';
import { round2, round4 } from './format';
import { apiJson, apiUploadSlip, apiFetchSlipObjectUrl, apiDownloadCsv } from './api';
import { inferChannelFromWallet } from './channels';
import { localEngine, safeSessionGet, safeSessionSet } from './localEngine';

const StoreCtx = createContext(null);
export const useStore = () => useContext(StoreCtx);

const DEFAULT_SETTINGS = { hideBalance: false, yearFormat: 'BE', theme: 'lavender' };

export function StoreProvider({ children }) {
  const [ready, setReady] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [serverUser, setServerUser] = useState(null);
  const [wallets, setWallets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [history, setHistory] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [usdtRate, setUsdtRate] = useState(34.5);
  const [hasPin, setHasPin] = useState(false);
  const [pinUnlocked, setPinUnlocked] = useState(() => safeSessionGet('ce_pin_unlocked') === '1');
  const [botPrefs, setBotPrefs] = useState({ budgetAlerts: true, recurringAlerts: true, dailySummary: false, dailyHour: 20 });
  const [botConfigured, setBotConfigured] = useState(false);
  const isStandaloneRef = useRef(false);

  useEffect(() => {
    const th = settings.theme || 'lavender';
    document.documentElement.dataset.theme = th;
    const bg = th === 'lavender' ? '#120E1C' : '#07080C';
    window.Telegram?.WebApp?.setHeaderColor?.(bg);
    window.Telegram?.WebApp?.setBackgroundColor?.(bg);
  }, [settings.theme]);

  const applyBootstrap = useCallback((data) => {
    if (data.user) setServerUser(data.user);
    setWallets((data.wallets || []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.createdAt || '').localeCompare(b.createdAt || '')));
    setCategories((data.categories || []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
    setTransactions((data.transactions || []).sort((a, b) => (b.date || '').localeCompare(a.date || '')));
    setBudgets(data.budgets || []);
    setRecurring(data.recurring || []);
    setNotifications((data.notifications || []).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')));
    setHistory(data.history || []);
    if (data.settings) setSettings({ ...DEFAULT_SETTINGS, ...data.settings });
    if (data.usdtRate) setUsdtRate(Number(data.usdtRate));
    if (typeof data.hasPin === 'boolean') {
      setHasPin(data.hasPin);
      if (!data.hasPin) setPinUnlocked(true);
    }
    if (data.botPrefs) setBotPrefs(data.botPrefs);
    if (typeof data.botConfigured === 'boolean') setBotConfigured(data.botConfigured);
  }, []);

  const reload = useCallback(async () => {
    const isStaticHost =
      typeof window !== 'undefined' &&
      (window.location.protocol === 'file:' ||
        window.__CE_STANDALONE__ ||
        window.location.hostname.endsWith('.github.io'));
    if (isStandaloneRef.current || isStaticHost) {
      isStandaloneRef.current = true;
      const localData = localEngine.bootstrap();
      applyBootstrap(localData);
      return localData;
    }
    const data = await apiJson('/api/bootstrap');
    applyBootstrap(data);
    return data;
  }, [applyBootstrap]);

  const migrateLocalIfAny = useCallback(
    async (userId) => {
      try {
        const migratedFor = await getMeta('migratedToUser', null);
        if (migratedFor === userId) return;
        const [lw, lc, lt, lb] = await Promise.all([
          getAll('wallets'),
          getAll('categories'),
          getAll('transactions'),
          getAll('budgets'),
        ]);
        const hasUserRecords = lt.length > 0 || lb.length > 0 || lw.length > 1 || lc.some((c) => !c.isDefault);
        if (hasUserRecords) {
          const slipIdMap = new Map();
          for (const t of lt) {
            if (t.slipId && !slipIdMap.has(t.slipId)) {
              const localSlip = await get('slips', t.slipId);
              if (localSlip?.blob) {
                try {
                  const up = await apiUploadSlip(localSlip.blob, localSlip.name || 'slip.png');
                  slipIdMap.set(t.slipId, up.id);
                } catch {
                  /* ignore */
                }
              }
            }
          }
          const mappedTx = lt.map((t) => ({
            ...t,
            channel: t.channel || inferChannelFromWallet(lw.find((w) => w.id === t.walletId)),
            slipId: slipIdMap.get(t.slipId) || t.slipId || null,
          }));
          const synced = await apiJson('/api/sync', {
            method: 'POST',
            body: { wallets: lw, categories: lc, transactions: mappedTx, budgets: lb },
          });
          applyBootstrap(synced);
        }
        await setMeta('migratedToUser', userId);
      } catch {
        /* non-fatal */
      }
    },
    [applyBootstrap],
  );

  useEffect(() => {
    (async () => {
      requestPersistence();
      await loadProviders();
      try {
        const boot = await reload();
        setAuthError(null);
        if (!isStandaloneRef.current && boot?.user?.id) {
          await migrateLocalIfAny(boot.user.id);
        }
      } catch (err) {
        if (err.status === 401 || err.status === 403) {
          setAuthError(err.message || 'ไม่สามารถยืนยันตัวตนกับเซิร์ฟเวอร์ได้');
        } else {
          // Offline / standalone HTML artifact mode — seamlessly switch to localEngine!
          isStandaloneRef.current = true;
          setAuthError(null);
          applyBootstrap(localEngine.bootstrap());
        }
      } finally {
        setReady(true);
      }
    })();
  }, [reload, migrateLocalIfAny, applyBootstrap]);

  // ---------- USDT Rate ----------
  const refreshRate = useCallback(async () => {
    if (isStandaloneRef.current) {
      return { rate: usdtRate || 34.5, source: 'saved' };
    }
    const res = await apiJson('/api/rate');
    if (res.rate) setUsdtRate(Number(res.rate));
    return res;
  }, [usdtRate]);

  const saveUsdtRate = useCallback(async (rate) => {
    if (isStandaloneRef.current) {
      const r = localEngine.saveUsdtRate(rate);
      setUsdtRate(r);
      return r;
    }
    const res = await apiJson('/api/rate', { method: 'PUT', body: { rate: Number(rate) } });
    if (res.rate) setUsdtRate(Number(res.rate));
    return res.rate;
  }, []);

  // ---------- transactions ----------
  const saveTransaction = useCallback(
    async (draft, slip) => {
      if (isStandaloneRef.current) {
        const rec = await localEngine.saveTransaction(draft, slip);
        await reload();
        return rec;
      }
      const prev = draft.id ? transactions.find((t) => t.id === draft.id) : null;
      let slipId = prev?.slipId ?? null;
      if (slip instanceof File || slip instanceof Blob) {
        const uploaded = await apiUploadSlip(slip, slip.name || 'slip.png');
        slipId = uploaded.id;
      } else if (slip === null) {
        slipId = null;
      }
      const cur = String(draft.currency || 'THB').toUpperCase();
      const payload = {
        ...prev,
        ...draft,
        id: draft.id || uid(),
        currency: cur,
        amount: cur === 'USDT' ? round4(draft.amount) : round2(draft.amount),
        slipId,
      };
      if (draft.id) await apiJson(`/api/transactions/${encodeURIComponent(draft.id)}`, { method: 'PUT', body: payload });
      else await apiJson('/api/transactions', { method: 'POST', body: payload });
      await reload();
      return payload;
    },
    [transactions, reload],
  );

  const deleteTransaction = useCallback(
    async (id) => {
      if (isStandaloneRef.current) {
        localEngine.deleteTransaction(id);
        await reload();
        return;
      }
      await apiJson(`/api/transactions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await reload();
    },
    [reload],
  );

  const fetchTxHistory = useCallback(async (txId) => {
    if (isStandaloneRef.current) return localEngine.fetchTxHistory(txId);
    const res = await apiJson(`/api/transactions/${encodeURIComponent(txId)}/history`);
    return res.history || [];
  }, []);

  const getSlipUrl = useCallback(async (slipId) => {
    if (!slipId) return null;
    if (isStandaloneRef.current) return localEngine.getSlipUrl(slipId);
    const remote = await apiFetchSlipObjectUrl(slipId);
    if (remote) return remote;
    try {
      const s = await get('slips', slipId);
      return s?.blob ? URL.createObjectURL(s.blob) : null;
    } catch {
      return null;
    }
  }, []);

  // ---------- wallets ----------
  const saveWallet = useCallback(
    async (w) => {
      if (isStandaloneRef.current) {
        localEngine.saveWallet(w);
        await reload();
        return;
      }
      const last4 = w.last4 ? String(w.last4).replace(/\D/g, '').slice(-4) : null;
      const cur = w.currency === 'USDT' ? 'USDT' : 'THB';
      const payload = {
        ...w,
        id: w.id || uid(),
        currency: cur,
        last4: last4 && last4.length === 4 ? last4 : null,
        initialBalance: cur === 'USDT' ? round4(w.initialBalance || 0) : round2(w.initialBalance || 0),
      };
      if (w.id) await apiJson(`/api/wallets/${encodeURIComponent(w.id)}`, { method: 'PUT', body: payload });
      else await apiJson('/api/wallets', { method: 'POST', body: payload });
      await reload();
    },
    [reload],
  );

  const deleteWallet = useCallback(
    async (id) => {
      if (isStandaloneRef.current) {
        localEngine.deleteWallet(id);
        await reload();
        return;
      }
      await apiJson(`/api/wallets/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await reload();
    },
    [reload],
  );

  // ---------- categories ----------
  const saveCategory = useCallback(
    async (c) => {
      if (isStandaloneRef.current) {
        const id = localEngine.saveCategory(c);
        await reload();
        return id;
      }
      const id = c.id || uid();
      const payload = { ...c, id };
      if (c.id) await apiJson(`/api/categories/${encodeURIComponent(c.id)}`, { method: 'PUT', body: payload });
      else await apiJson('/api/categories', { method: 'POST', body: payload });
      await reload();
      return id;
    },
    [reload],
  );

  const deleteCategory = useCallback(
    async (id) => {
      if (isStandaloneRef.current) {
        localEngine.deleteCategory(id);
        await reload();
        return;
      }
      await apiJson(`/api/categories/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await reload();
    },
    [reload],
  );

  // ---------- budgets ----------
  const saveBudget = useCallback(
    async (b) => {
      if (isStandaloneRef.current) {
        localEngine.saveBudget(b);
        await reload();
        return;
      }
      await apiJson('/api/budgets', { method: 'POST', body: b });
      await reload();
    },
    [reload],
  );

  const deleteBudget = useCallback(
    async (id) => {
      if (isStandaloneRef.current) {
        localEngine.deleteBudget(id);
        await reload();
        return;
      }
      await apiJson(`/api/budgets/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await reload();
    },
    [reload],
  );

  // ---------- recurring ----------
  const saveRecurring = useCallback(
    async (r) => {
      if (isStandaloneRef.current) {
        localEngine.saveRecurring(r);
        await reload();
        return;
      }
      const id = r.id || uid();
      const payload = { ...r, id };
      if (r.id) await apiJson(`/api/recurring/${encodeURIComponent(r.id)}`, { method: 'PUT', body: payload });
      else await apiJson('/api/recurring', { method: 'POST', body: payload });
      await reload();
    },
    [reload],
  );

  const deleteRecurring = useCallback(
    async (id) => {
      if (isStandaloneRef.current) {
        localEngine.deleteRecurring(id);
        await reload();
        return;
      }
      await apiJson(`/api/recurring/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await reload();
    },
    [reload],
  );

  const runRecurringNow = useCallback(
    async (id) => {
      if (isStandaloneRef.current) {
        localEngine.runRecurringNow(id);
        await reload();
        return;
      }
      await apiJson(`/api/recurring/${encodeURIComponent(id)}/run`, { method: 'POST' });
      await reload();
    },
    [reload],
  );

  // ---------- trash restore ----------
  const restoreTrashItem = useCallback(
    async (kind, id) => {
      if (isStandaloneRef.current) {
        localEngine.restoreTrashItem(kind, id);
        await reload();
        return;
      }
      await apiJson('/api/trash/restore', { method: 'POST', body: { kind, id } });
      await reload();
    },
    [reload],
  );

  // ---------- PIN security ----------
  const verifyPin = useCallback(async (pin) => {
    if (isStandaloneRef.current) localEngine.verifyPin(pin);
    else await apiJson('/api/pin/verify', { method: 'POST', body: { pin } });
    safeSessionSet('ce_pin_unlocked', '1');
    setPinUnlocked(true);
  }, []);

  const setPinCode = useCallback(async (currentPin, newPin) => {
    if (isStandaloneRef.current) localEngine.setPinCode(currentPin, newPin);
    else await apiJson('/api/pin/set', { method: 'POST', body: { currentPin, newPin } });
    safeSessionSet('ce_pin_unlocked', '1');
    setHasPin(true);
    setPinUnlocked(true);
  }, []);

  const removePinCode = useCallback(async (currentPin) => {
    if (isStandaloneRef.current) localEngine.removePinCode(currentPin);
    else await apiJson('/api/pin/remove', { method: 'POST', body: { currentPin } });
    safeSessionSet('ce_pin_unlocked', null);
    setHasPin(false);
    setPinUnlocked(true);
  }, []);

  const lockNow = useCallback(() => {
    if (hasPin) {
      safeSessionSet('ce_pin_unlocked', null);
      setPinUnlocked(false);
    }
  }, [hasPin]);

  // ---------- Bot prefs ----------
  const updateBotPrefs = useCallback(
    async (patch) => {
      if (isStandaloneRef.current) {
        const next = { ...botPrefs, ...patch };
        setBotPrefs(next);
        return next;
      }
      const res = await apiJson('/api/bot/prefs', { method: 'PUT', body: patch });
      if (res.botPrefs) setBotPrefs(res.botPrefs);
      return res.botPrefs;
    },
    [botPrefs],
  );

  const sendBotTest = useCallback(async (chatId) => {
    if (isStandaloneRef.current) {
      throw new Error('ฟีเจอร์บอทต้องรันคู่กับเซิร์ฟเวอร์ที่มี BOT_TOKEN');
    }
    return apiJson('/api/bot/test', { method: 'POST', body: { chatId } });
  }, []);

  // ---------- notifications / settings ----------
  const markAllRead = useCallback(async () => {
    if (isStandaloneRef.current) {
      localEngine.markAllRead();
      await reload();
      return;
    }
    await apiJson('/api/notifications/read-all', { method: 'POST' });
    await reload();
  }, [reload]);

  const updateSettings = useCallback(
    async (patch) => {
      const next = { ...settings, ...patch };
      setSettings(next);
      if (isStandaloneRef.current) {
        localEngine.updateSettings(patch);
        await reload();
        return;
      }
      await apiJson('/api/settings', { method: 'PUT', body: patch });
    },
    [settings, reload],
  );

  // ---------- CSV & JSON backup ----------
  const exportCsv = useCallback(async (params = '') => {
    if (isStandaloneRef.current) {
      localEngine.exportCsv(params);
      return;
    }
    await apiDownloadCsv(params);
  }, []);

  const exportBackup = useCallback(async () => {
    if (isStandaloneRef.current) return localEngine.exportBackupBlob();
    const boot = await apiJson('/api/bootstrap');
    const data = {
      app: 'CE Money Tracker Pro',
      dbVersion: DB_VERSION,
      exportedAt: new Date().toISOString(),
      stores: {
        wallets: boot.wallets,
        categories: boot.categories,
        transactions: boot.transactions,
        budgets: boot.budgets,
        recurring: boot.recurring,
        notifications: boot.notifications,
      },
    };
    return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  }, []);

  const importBackup = useCallback(
    async (file) => {
      if (isStandaloneRef.current) {
        const merged = await localEngine.importBackupFile(file);
        await reload();
        return merged;
      }
      const data = JSON.parse(await file.text());
      if (!data?.stores) throw new Error('ไฟล์สำรองไม่ถูกต้อง');
      const s = data.stores;
      const res = await apiJson('/api/sync', {
        method: 'POST',
        body: {
          wallets: s.wallets || [],
          categories: s.categories || [],
          transactions: s.transactions || [],
          budgets: s.budgets || [],
        },
      });
      applyBootstrap(res);
      return res.merged || 0;
    },
    [applyBootstrap, reload],
  );

  const value = useMemo(
    () => ({
      ready,
      authError,
      serverUser,
      wallets,
      categories,
      transactions,
      budgets,
      recurring,
      notifications,
      history,
      settings,
      usdtRate,
      hasPin,
      pinUnlocked,
      botPrefs,
      botConfigured,
      activeWallets: wallets.filter((w) => !w.deletedAt),
      activeTx: transactions.filter((t) => !t.deletedAt),
      activeBudgets: budgets.filter((b) => !b.deletedAt),
      activeRecurring: recurring.filter((r) => !r.deletedAt),
      refreshRate,
      saveUsdtRate,
      saveTransaction,
      deleteTransaction,
      fetchTxHistory,
      getSlipUrl,
      saveWallet,
      deleteWallet,
      saveCategory,
      deleteCategory,
      saveBudget,
      deleteBudget,
      saveRecurring,
      deleteRecurring,
      runRecurringNow,
      restoreTrashItem,
      verifyPin,
      setPinCode,
      removePinCode,
      lockNow,
      updateBotPrefs,
      sendBotTest,
      markAllRead,
      updateSettings,
      exportCsv,
      exportBackup,
      importBackup,
      reload,
      STORES,
    }),
    [
      ready,
      authError,
      serverUser,
      wallets,
      categories,
      transactions,
      budgets,
      recurring,
      notifications,
      history,
      settings,
      usdtRate,
      hasPin,
      pinUnlocked,
      botPrefs,
      botConfigured,
      refreshRate,
      saveUsdtRate,
      saveTransaction,
      deleteTransaction,
      fetchTxHistory,
      getSlipUrl,
      saveWallet,
      deleteWallet,
      saveCategory,
      deleteCategory,
      saveBudget,
      deleteBudget,
      saveRecurring,
      deleteRecurring,
      runRecurringNow,
      restoreTrashItem,
      verifyPin,
      setPinCode,
      removePinCode,
      lockNow,
      updateBotPrefs,
      sendBotTest,
      markAllRead,
      updateSettings,
      exportCsv,
      exportBackup,
      importBackup,
      reload,
    ],
  );

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}
