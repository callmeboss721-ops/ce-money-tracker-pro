import bundled from '../../public/assets/logos/logos.json';

export const GROUPS = [
  { key: 'banks', group: 'bank', label: 'ธนาคาร' },
  { key: 'ewallets', group: 'ewallet', label: 'อีวอลเล็ท' },
  { key: 'crypto', group: 'crypto', label: 'คริปโต' },
  { key: 'cash', group: 'cash', label: 'เงินสด' },
];

const BASE = import.meta.env.BASE_URL || './';
export const logoUrl = (file) => {
  if (!file || (typeof window !== 'undefined' && window.__CE_STANDALONE__)) return null;
  return `${BASE}assets/logos/${file}`;
};

function normalize(json) {
  const out = {};
  for (const g of GROUPS) {
    out[g.group] = [...(json[g.key] || [])]
      .map((p) => ({ ...p, group: g.group }))
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  }
  return out;
}

let providers = normalize(bundled);

export async function loadProviders() {
  if (typeof window !== 'undefined' && (window.__CE_STANDALONE__ || window.location.protocol === 'file:')) {
    return providers;
  }
  try {
    const res = await fetch(`${BASE}assets/logos/logos.json`, { cache: 'no-cache' });
    if (res.ok) providers = normalize(await res.json());
  } catch {
    /* fall back to bundled copy */
  }
  return providers;
}
export const getProviders = () => providers;

export function findProvider(code) {
  for (const g of Object.values(providers)) {
    const p = g.find((x) => x.code === code);
    if (p) return p;
  }
  return null;
}
