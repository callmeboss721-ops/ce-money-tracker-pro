/**
 * Safe logger — strictly prevents logging full bank account numbers,
 * BOT_TOKEN, Telegram initData signatures, or slip tokens.
 */
export function redact(input) {
  if (input == null) return '';
  let str = typeof input === 'string' ? input : JSON.stringify(input);
  // Redact query/header tokens & secrets
  str = str.replace(/(bot\d+:[A-Za-z0-9_-]+)/gi, '[REDACTED_BOT_TOKEN]');
  str = str.replace(/(hash|token|initData|signature)=([^&\s"]+)/gi, '$1=[REDACTED]');
  // Redact potential bank account / card numbers (8 to 19 digits, with optional spaces or hyphens)
  // while preserving ISO timestamps (e.g. 2026-11-25T09:40:17).
  str = str.replace(/(?<!\d)(?:\d[\s-]?){8,19}(?!\d)/g, (match) => {
    const trimmed = match.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return match;
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length < 8) return match;
    return `••••${digits.slice(-4)}`;
  });
  return str;
}

export const logger = {
  info(msg, meta) {
    console.log(`[INFO] ${new Date().toISOString()} ${redact(msg)}${meta ? ' ' + redact(meta) : ''}`);
  },
  warn(msg, meta) {
    console.warn(`[WARN] ${new Date().toISOString()} ${redact(msg)}${meta ? ' ' + redact(meta) : ''}`);
  },
  error(msg, meta) {
    console.error(`[ERROR] ${new Date().toISOString()} ${redact(msg)}${meta ? ' ' + redact(meta) : ''}`);
  },
};
