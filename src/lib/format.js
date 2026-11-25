export const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
export const TH_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export const TH_DAYS = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'];
export const TH_DAYS_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfUsdt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** ฿ 7,928.92 — always absolute; colour conveys direction (no minus sign). */
export function fmtTHB(n) {
  return '฿ ' + nf2.format(Math.abs(Number(n) || 0));
}

/** USDT up to 4 decimal places (e.g. 125.1234 USDT). */
export function fmtUSDT(n) {
  return nfUsdt.format(Math.abs(Number(n) || 0)) + ' USDT';
}

export function fmtCurrency(n, currency = 'THB') {
  if (!currency || currency === 'THB') return fmtTHB(n);
  if (currency === 'USDT') return fmtUSDT(n);
  return `${nf2.format(Math.abs(Number(n) || 0))} ${currency}`;
}

export const HIDDEN = '฿ ••••••';

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function round4(n) {
  return Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;
}

export function yearOf(y, yearFormat) {
  return yearFormat === 'BE' ? y + 543 : y;
}
export function monthLabel(y, m, yearFormat, short = false) {
  return `${(short ? TH_MONTHS_SHORT : TH_MONTHS)[m]} ${yearOf(y, yearFormat)}`;
}
export function shortDate(d, yearFormat) {
  const dt = new Date(d);
  return `${dt.getDate()} ${TH_MONTHS_SHORT[dt.getMonth()]} ${yearOf(dt.getFullYear(), yearFormat)}`;
}
export function fullDate(d, yearFormat) {
  const dt = new Date(d);
  return `${dt.getDate()} ${TH_MONTHS[dt.getMonth()]} ${yearOf(dt.getFullYear(), yearFormat)}`;
}
export function timeLabel(d) {
  const dt = new Date(d);
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')} น.`;
}
export function dateTimeLabel(d, yearFormat) {
  return `${fullDate(d, yearFormat)} · ${timeLabel(d)}`;
}

/** Value for <input type="datetime-local"> in local time. */
export function toLocalInput(d) {
  const dt = new Date(d);
  const p = (x) => String(x).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}T${p(dt.getHours())}:${p(dt.getMinutes())}`;
}

export function dayKey(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
export function monthKey(y, m) {
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}
export function daysInMonth(y, m) {
  return new Date(y, m + 1, 0).getDate();
}
export function maskLast4(last4) {
  return last4 ? `••••${last4}` : '';
}
