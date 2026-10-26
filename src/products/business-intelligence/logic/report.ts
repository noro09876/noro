import { fmtInt, fmtMoney, fmtPct } from '../../../lib/format';
import { dayToRu } from './dataset';
import { DIM_LABELS, type Anomaly, type Dimension, type Filters, type Kpis, type Period } from './types';
import type { BreakdownRow } from './analytics';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface ReportInput {
  source: string;
  period: Period;
  prev: Period | null;
  kpis: Kpis;
  prevKpis: Kpis | null;
  filters: Filters;
  series: { labels: string[]; values: number[] };
  breakdowns: Array<{ dim: Dimension; rows: BreakdownRow[] }>;
  anomalies: Anomaly[];
}

function delta(cur: number | null, prev: number | null | undefined): string {
  if (cur == null || prev == null || !prev) return '';
  const d = ((cur - prev) / Math.abs(prev)) * 100;
  return `<span class="${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '+' : '−'}${Math.abs(d).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%</span>`;
}

/** Self-contained HTML report (no external resources) with an inline SVG chart. */
export function buildHtmlReport(r: ReportInput): string {
  const k = r.kpis;
  const p = r.prevKpis;
  const tiles: Array<[string, string, string]> = [
    ['Выручка', fmtMoney(k.revenue), delta(k.revenue, p?.revenue)],
    ...(k.orders != null ? [['Заказы', fmtInt(k.orders), delta(k.orders, p?.orders)] as [string, string, string]] : []),
    ...(k.aov != null ? [['Средний чек', fmtMoney(k.aov), delta(k.aov, p?.aov)] as [string, string, string]] : []),
    ...(k.customers != null ? [['Клиенты', fmtInt(k.customers), delta(k.customers, p?.customers)] as [string, string, string]] : []),
    ...(k.margin != null ? [['Валовая маржа', fmtPct(k.margin * 100), ''] as [string, string, string]] : []),
    ...(k.convLead != null ? [['Конверсия в заявку', fmtPct(k.convLead * 100, 2), ''] as [string, string, string]] : []),
  ];
  const max = Math.max(1, ...r.series.values);
  const W = 760;
  const H = 200;
  const step = r.series.values.length > 1 ? W / (r.series.values.length - 1) : 0;
  const pts = r.series.values.map((v, i) => `${(i * step).toFixed(1)},${(H - (v / max) * (H - 10)).toFixed(1)}`).join(' ');
  const filters = Object.entries(r.filters)
    .filter(([, v]) => v?.length)
    .map(([d, v]) => `${DIM_LABELS[d as Dimension]}: ${v!.map(esc).join(', ')}`)
    .join('; ');
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Отчёт NORO BI · ${dayToRu(r.period.from)}–${dayToRu(r.period.to)}</title>
<style>
body{font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#15181a;max-width:860px;margin:32px auto;padding:0 16px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:28px 0 10px}.muted{color:#5d6662;font-size:13px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-top:16px}
.tile{border:1px solid #dfe3e1;border-radius:10px;padding:12px}.tile b{display:block;font-size:20px;margin-top:2px}
.up{color:#137a46}.down{color:#b3261e}table{border-collapse:collapse;width:100%;font-size:14px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #eceeed}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
svg{width:100%;height:auto;border-bottom:1px solid #dfe3e1}
</style></head><body>
<h1>Отчёт по продажам</h1>
<div class="muted">Источник: ${esc(r.source)} · период ${dayToRu(r.period.from)}–${dayToRu(r.period.to)}${r.prev ? ` · сравнение с ${dayToRu(r.prev.from)}–${dayToRu(r.prev.to)}` : ''}${filters ? ` · фильтры: ${filters}` : ''}</div>
<div class="tiles">${tiles.map(([l, v, d]) => `<div class="tile"><span class="muted">${l}</span><b>${v}</b>${d}</div>`).join('')}</div>
<h2>Динамика выручки</h2>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Динамика выручки"><polyline fill="none" stroke="#5b4fd6" stroke-width="2" points="${pts}"/></svg>
<div class="muted">${esc(r.series.labels[0] ?? '')} — ${esc(r.series.labels.at(-1) ?? '')}, максимум ${fmtMoney(max)}</div>
${r.breakdowns
  .map(
    (b) => `<h2>${DIM_LABELS[b.dim]}</h2><table><thead><tr><th>Значение</th><th class="n">Выручка</th><th class="n">Доля</th><th class="n">К прошлому периоду</th></tr></thead><tbody>${b.rows
      .slice(0, 15)
      .map((x) => `<tr><td>${esc(x.key)}</td><td class="n">${fmtMoney(x.revenue)}</td><td class="n">${fmtPct(x.share * 100)}</td><td class="n">${x.delta == null ? '—' : delta(x.revenue, x.prev)}</td></tr>`)
      .join('')}</tbody></table>`,
  )
  .join('')}
<h2>Аномалии</h2>
${
  r.anomalies.length
    ? `<table><thead><tr><th>Дата</th><th class="n">Выручка</th><th class="n">Обычно</th><th class="n">Отклонение</th><th>Что изменилось сильнее всего</th></tr></thead><tbody>${r.anomalies
        .map((a) => `<tr><td>${dayToRu(a.day)}</td><td class="n">${fmtMoney(a.value)}</td><td class="n">${fmtMoney(a.expected)}</td><td class="n">${a.deltaPct >= 0 ? '+' : '−'}${Math.abs(a.deltaPct).toFixed(0)}%</td><td>${a.drivers.map((d) => `${esc(d.key)} (${d.delta >= 0 ? '+' : '−'}${fmtMoney(Math.abs(d.delta))})`).join(', ') || '—'}</td></tr>`)
        .join('')}</tbody></table>`
    : '<p class="muted">Аномалий не найдено.</p>'
}
<h2>Методика</h2>
<p class="muted">Выручка — сумма колонки выручки. Заказы — число уникальных номеров заказа (или сумма колонки «число заказов»). Средний чек = выручка / заказы. Сравнение — с предыдущим периодом той же длины. Аномалия — день, где выручка отклоняется от медианы соседних ±14 дней более чем на 3,5 робастных стандартных отклонения (MAD × 1,4826). Отчёт сформирован в браузере, данные никуда не отправлялись.</p>
<p class="muted">Сформировано NORO Business Intelligence · ${new Date().toLocaleString('ru-RU')}</p>
</body></html>`;
}
