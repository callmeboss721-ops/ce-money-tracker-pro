/**
 * Thai Bank, Credit Card & LINE Notification Auto-Parser
 * Supports K PLUS, MAKE by KBank, KTC, SCB / SCB Connect, BBL, KTB, Krungsri, TTB, TrueMoney, PromptPay, and generic alerts.
 */
const BANK_PATTERNS = [
  { code: 'MAKE', keywords: [/make\s*by\s*kbank/i, /\bmake\b/i] },
  { code: 'KTC', keywords: [/\bktc\b/i, /บัตรเครดิต\s*ktc/i] },
  { code: 'KBANK', keywords: [/k\s*plus/i, /kbank/i, /กสิกร/i, /k-cyber/i] },
  { code: 'SCB', keywords: [/\bscb\b/i, /ไทยพาณิชย์/i, /scb\s*connect/i] },
  { code: 'BBL', keywords: [/\bbbl\b/i, /กรุงเทพ/i, /bualuang/i] },
  { code: 'KTB', keywords: [/\bktb\b/i, /กรุงไทย/i, /krungthai/i, /เป๋าตัง/i] },
  { code: 'BAY', keywords: [/krungsri/i, /กรุงศรี/i, /\bbay\b/i, /\bkma\b/i] },
  { code: 'TTB', keywords: [/\bttb\b/i, /ทหารไทยธนชาต/i, /ttb\s*touch/i] },
  { code: 'TRUEMONEY', keywords: [/truemoney/i, /ทรูมันนี่/i] },
  { code: 'PROMPTPAY', keywords: [/promptpay/i, /พร้อมเพย์/i] },
];

const CATEGORY_HINTS = [
  { id: 'exp-food', rx: /grab\s*food|lineman|line\s*man|foodpanda|kfc|mcdonald|starbucks|cafe|coffee|กาแฟ|อาหาร|ร้านอาหาร|7-eleven|7-11|cp\s*all/i },
  { id: 'exp-travel', rx: /\bgrab\b|bolt|bts|mrt|ทางด่วน|ปตท|ptt|shell|bangchak|น้ำมัน|เดินทาง|แท็กซี่|taxi/i },
  { id: 'exp-shopping', rx: /shopee|lazada|tiktok\s*shop|central|lotus|big\s*c|ikea|uniqlo|ช้อปปิ้ง/i },
  { id: 'exp-ads', rx: /facebook|meta\s*ads|google\s*ads|tiktok\s*ads|โฆษณา/i },
  { id: 'exp-tools', rx: /openai|chatgpt|claude|github|aws|cloudflare|google\s*cloud|digitalocean|apple\.com|netflix|spotify|youtube/i },
  { id: 'exp-utility', rx: /ค่าไฟ|การไฟฟ้า|ประปา|ais|true\s*move|dtac|3bb|nt\s*broadband|อินเทอร์เน็ต/i },
  { id: 'exp-health', rx: /โรงพยาบาล|คลินิก|ร้านยา|pharmacy|watsons|boots/i },
];

export function parseBankNotification(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return null;

  // 1. Detect bank / source provider
  let providerCode = null;
  for (const b of BANK_PATTERNS) {
    if (b.keywords.some((rx) => rx.test(text))) {
      providerCode = b.code;
      break;
    }
  }

  // 2. Detect Income vs Expense
  const isIncome = /เงินเข้า|รับโอน|ฝากเงิน|ได้รับเงิน|credit|deposit|received/i.test(text) && !/เงินออก|ถอน|ชำระ|โอนเงินให้|หักบัญชี/i.test(text);
  const type = isIncome ? 'income' : 'expense';

  // 3. Detect Currency & Amount
  // Examples: "455.00 บาท", "THB 1,250.50", "USD 19.99", "2,500 JPY", "฿350.00"
  let currency = 'THB';
  let amount = 0;

  const fxBefore = text.match(/\b(THB|USD|USDT|EUR|JPY|GBP|SGD|CNY|HKD|AUD)\s*([\d,]+(?:\.\d{1,4})?)/i);
  const fxAfter = text.match(/([\d,]+(?:\.\d{1,4})?)\s*(บาท|บ\.|THB|USD|USDT|EUR|JPY|GBP|SGD|CNY|HKD|AUD)\b/i);
  const bahtSign = text.match(/฿\s*([\d,]+(?:\.\d{1,2})?)/);

  if (fxBefore) {
    currency = fxBefore[1].toUpperCase();
    amount = parseFloat(fxBefore[2].replace(/,/g, ''));
  } else if (fxAfter) {
    const unit = fxAfter[2].toUpperCase();
    currency = unit === 'บาท' || unit === 'บ.' ? 'THB' : unit;
    amount = parseFloat(fxAfter[1].replace(/,/g, ''));
  } else if (bahtSign) {
    currency = 'THB';
    amount = parseFloat(bahtSign[1].replace(/,/g, ''));
  } else {
    const anyNum = text.match(/(?:จำนวน|ยอด|เงินออก|เงินเข้า|ชำระ)\s*([\d,]+(?:\.\d{1,2})?)/i);
    if (anyNum) amount = parseFloat(anyNum[1].replace(/,/g, ''));
  }

  if (!(amount > 0)) return null;

  // 4. Extract merchant / note
  let note = '';
  const merchantMatch =
    text.match(/(?:ที่|ร้านค้า|ชำระค่า|โอนไปยัง|ไปยัง|จาก)\s*([A-Za-z0-9ก-๙\s._*-]{2,40})/i);
  if (merchantMatch) {
    note = merchantMatch[1].replace(/\s+(วันที่|เวลา|คงเหลือ).*$/i, '').trim();
  } else {
    note = text.replace(/\s+/g, ' ').slice(0, 70);
  }

  // 5. Extract last 4 account digits if present (never store full account number!)
  let last4 = null;
  const maskedAcct = text.match(/[xX*•-]{3,}(\d{4})(?!\d)/);
  if (maskedAcct) last4 = maskedAcct[1];

  // 6. Auto-suggest category
  let categoryId = type === 'income' ? 'inc-sales' : 'exp-other';
  if (type === 'expense') {
    for (const h of CATEGORY_HINTS) {
      if (h.rx.test(text)) {
        categoryId = h.id;
        break;
      }
    }
  }

  return {
    providerCode: providerCode || 'OTHER_BANK',
    type,
    amount,
    currency,
    categoryId,
    note,
    last4,
  };
}
