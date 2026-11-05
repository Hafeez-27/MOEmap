export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const md = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^#+\s*(.+)$/gm, '<b>$1</b>');
export const COL = { good: '#1F7A4D', watch: '#C99700', risk: '#D9622B', critical: '#C8372D' };
export const MAPCOL = { good: '#5FBF8C', watch: '#E0A800', risk: '#D9622B', critical: '#C8372D' };
export const INK = '#16233B', BOY = '#2457A6', GIRL = '#A8306F', LOAN = '#D98200';
export const pct = (v, d = 0) => v == null || isNaN(v) ? '–' : `${v.toFixed(d)}%`;
export const num = v => v == null ? '–' : Math.round(v).toLocaleString();
export const genderTag = s => s.type !== 'school' ? '<span class="tag">Non-school</span>' : s.gender === 'B' ? '<span class="tag b">Boys\'</span>' : '<span class="tag g">Girls\'</span>';
export const hbar = h => `<span class="hbar"><i style="width:${h}%;background:${COL[h >= 80 ? 'good' : h >= 60 ? 'watch' : h >= 40 ? 'risk' : 'critical']}"></i></span>${h}`;
// tiny inline sparkline for daily values 0..100
export function spark(vals, w = 70, h = 18) {
  const v = vals.filter(x => x != null); if (v.length < 2) return '<span class="empty">–</span>';
  const pts = vals.map((x, i) => x == null ? null : `${(i / (vals.length - 1) * w).toFixed(1)},${(h - 2 - (Math.max(50, x) - 50) / 50 * (h - 4)).toFixed(1)}`).filter(Boolean).join(' ');
  return `<svg width="${w}" height="${h}" aria-hidden="true"><line x1="0" x2="${w}" y1="${h - 2 - .9 * (h - 4)}" y2="${h - 2 - .9 * (h - 4)}" stroke="#D5DCD6" stroke-dasharray="2 2"/><polyline points="${pts}" fill="none" stroke="#16233B" stroke-width="1.5"/></svg>`;
}
let tt;
export function toast(m, ok) { const t = $('#toast'); t.textContent = m; t.className = 'toast' + (ok ? ' ok' : ''); clearTimeout(tt); tt = setTimeout(() => t.classList.add('hidden'), 4500); }
export function download(name, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
