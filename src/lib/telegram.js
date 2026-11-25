export const tg = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;

export function initTelegram() {
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    tg.setHeaderColor?.('#07080C');
    tg.setBackgroundColor?.('#07080C');
    tg.setBottomBarColor?.('#07080C');
    tg.disableVerticalSwipes?.();
  } catch {
    /* older clients */
  }
}

export function telegramUser() {
  const u = tg?.initDataUnsafe?.user;
  if (!u) return null;
  return {
    id: u.id,
    name: [u.first_name, u.last_name].filter(Boolean).join(' '),
    username: u.username,
    photo: u.photo_url,
  };
}

export function haptic(kind = 'light') {
  try {
    if (kind === 'success' || kind === 'warning' || kind === 'error') tg?.HapticFeedback?.notificationOccurred(kind);
    else tg?.HapticFeedback?.impactOccurred(kind);
  } catch {
    /* noop */
  }
}
