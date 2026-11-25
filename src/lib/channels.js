export const CHANNELS = [
  { code: 'BANK', label: 'โอนธนาคาร', icon: 'landmark', group: 'bank', defaultProvider: 'KBANK' },
  { code: 'TRUEMONEY', label: 'TrueMoney', icon: 'smartphone', group: 'ewallet', defaultProvider: 'TRUEMONEY' },
  { code: 'USDT', label: 'USDT', icon: 'coins', group: 'crypto', defaultProvider: 'USDT' },
  { code: 'CASH', label: 'เงินสด', icon: 'banknote', group: 'cash', defaultProvider: 'CASH' },
];

export function channelInfo(code) {
  return CHANNELS.find((c) => c.code === code) || CHANNELS[3];
}

export function inferChannelFromWallet(wallet) {
  if (!wallet) return 'CASH';
  if (wallet.providerCode === 'TRUEMONEY') return 'TRUEMONEY';
  if (wallet.providerCode === 'USDT' || wallet.group === 'crypto') return 'USDT';
  if (wallet.group === 'bank' || wallet.providerCode === 'PROMPTPAY') return 'BANK';
  if (wallet.group === 'ewallet') return 'TRUEMONEY';
  return 'CASH';
}
