import { useMemo, useState } from 'react';
import { AppFrame, StartPanel, StorageStatus } from '../../../components/app/AppFrame';
import { MappingDialog, type MappingField } from '../../../components/app/MappingDialog';
import { Spinner } from '../../../components/ui/Feedback';
import { FileDrop } from '../../../components/ui/FileDrop';
import { Icon } from '../../../components/ui/Icon';
import { ConfirmDialog } from '../../../components/ui/Modal';
import { Tabs } from '../../../components/ui/Tabs';
import { UploadButton } from '../../../components/ui/UploadButton';
import { useToast } from '../../../components/ui/Toast';
import { useIdbState } from '../../../hooks/useIdbState';
import { toCsv } from '../../../lib/csv';
import { fetchDemoFile } from '../../../lib/demo';
import { downloadFile, safeFilename, stamp } from '../../../lib/download';
import { fmtInt } from '../../../lib/format';
import { clearProductData } from '../../../lib/storage';
import { loadTabularFile, type LoadedTable } from '../../../lib/tabular';
import { breakdown, bucketLabel, computeKpis, detectAnomalies, filterMask, presetPeriod, previousPeriod, series } from '../logic/analytics';
import { buildDataset, dayToIso, dayToRu, detectBiColumns, toDay } from '../logic/dataset';
import { buildHtmlReport } from '../logic/report';
import { BI_FIELDS, DIM_LABELS, DIMENSIONS, FIELD_LABELS, type BiField, type Dataset, type Dimension, type Filters, type Granularity, type PresetKey } from '../logic/types';
import { Overview } from './Overview';
import { AnomaliesTab, ChangesTab, MethodTab, PivotTab } from './Tabs2';
import './bi.css';

interface DataState {
  ds: Dataset | null;
  source: { name: string; at: number; demo: boolean } | null;
}
interface ViewState {
  preset: PresetKey;
  custom: { from: string; to: string } | null;
  granularity: Granularity;
  compare: boolean;
  filters: Filters;
  threshold: number;
}
const INITIAL_DATA: DataState = { ds: null, source: null };
const INITIAL_VIEW: ViewState = { preset: '90', custom: null, granularity: 'day', compare: true, filters: {}, threshold: 3.5 };
type TabKey = 'overview' | 'pivot' | 'anomalies' | 'changes' | 'method';

const MAP_FIELDS: MappingField<BiField>[] = BI_FIELDS.map((f) => ({
  key: f,
  label: FIELD_LABELS[f],
  required: f === 'date' || f === 'revenue',
  hint: f === 'orders' ? 'Для агрегированных таблиц: сколько заказов в строке' : f === 'orderId' ? 'Для построчных данных: идентификатор заказа' : undefined,
}));

const PRESETS: Array<[PresetKey, string]> = [
  ['7', '7 дней'],
  ['30', '30 дней'],
  ['90', '90 дней'],
  ['365', 'Год'],
  ['all', 'Всё'],
  ['custom', 'Свой'],
];

export default function BiApp() {
  const toast = useToast();
  const data = useIdbState<DataState>('business-intelligence:data', INITIAL_DATA, 600);
  const view = useIdbState<ViewState>('business-intelligence:view', INITIAL_VIEW);
  const { ds, source } = data.value;
  const v = view.value;
  const setView = (patch: Partial<ViewState>) => view.setValue((s) => ({ ...s, ...patch }));
  const [tab, setTab] = useState<TabKey>('overview');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ table: LoadedTable; mapping: Record<BiField, string>; demo: boolean } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const calc = useMemo(() => {
    if (!ds) return null;
    const custom = v.custom ? { from: toDay(new Date(`${v.custom.from}T00:00:00Z`)), to: toDay(new Date(`${v.custom.to}T00:00:00Z`)) } : undefined;
    const period = presetPeriod(ds, v.preset, custom && Number.isFinite(custom.from) && Number.isFinite(custom.to) && custom.from <= custom.to ? custom : undefined);
    const prevP = v.compare ? previousPeriod(ds, period) : null;
    const mask = filterMask(ds, v.filters);
    const kpis = computeKpis(ds, period, mask);
    const prevKpis = prevP ? computeKpis(ds, prevP, mask) : null;
    const g = v.granularity === 'day' && period.to - period.from > 400 ? 'week' : v.granularity;
    const cur = series(ds, period, g, mask);
    const prev = prevP ? series(ds, prevP, g, mask) : null;
    // each breakdown ignores its own filter so the user can add more values (cross-filtering)
    const breakdowns = DIMENSIONS.filter((d) => ds.dims[d]).map((dim) => ({ dim, rows: breakdown(ds, dim, period, prevP, filterMask(ds, v.filters, dim)) }));
    const anomalies = detectAnomalies(ds, period, mask, v.threshold);
    return { period, prevP, mask, kpis, prevKpis, g, cur, prev, breakdowns, anomalies };
  }, [ds, v]);

  const importTable = (table: LoadedTable, mapping: Record<BiField, string>, demo: boolean) => {
    try {
      const built = buildDataset(table, mapping);
      if (built.rows > 200000) throw new Error('Больше 200 000 строк: для демоверсии в браузере это слишком много. Агрегируйте данные по дням.');
      data.setValue({ ds: built, source: { name: table.fileName, at: Date.now(), demo } });
      setView({ filters: {}, preset: built.maxDay - built.minDay > 120 ? '90' : 'all', custom: null });
      setPending(null);
      setTab('overview');
      toast.success(`Загружено строк: ${fmtInt(built.rows)} · ${dayToRu(built.minDay)} — ${dayToRu(built.maxDay)}`);
      const skipped = built.skipped.badDate + built.skipped.badAmount;
      if (skipped) toast.info(`Пропущено строк: ${fmtInt(skipped)} (нераспознанные даты: ${built.skipped.badDate}, суммы: ${built.skipped.badAmount}). Например: ${built.skipped.samples.slice(0, 2).join('; ')}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось обработать данные');
    }
  };

  const openFile = async (file: File, demo = false) => {
    setBusy(true);
    try {
      const table = await loadTabularFile(file);
      const mapping = detectBiColumns(table.headers);
      if (demo) importTable(table, mapping, true);
      else setPending({ table, mapping, demo });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось прочитать файл');
    } finally {
      setBusy(false);
    }
  };
  const loadDemo = async (name: string) => {
    setBusy(true);
    try {
      await openFile(await fetchDemoFile(name), true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось загрузить демо');
      setBusy(false);
    }
  };

  const toggleFilter = (dim: Dimension, key: string) => {
    const cur = v.filters[dim] ?? [];
    setView({ filters: { ...v.filters, [dim]: cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key] } });
  };

  const exportCsv = () => {
    if (!calc) return;
    const rows = calc.cur.buckets.map((b, i) => ({ Период: dayToIso(b), Выручка: Math.round(calc.cur.values[i]! * 100) / 100, 'Прошлый период': calc.prev ? Math.round((calc.prev.values[i] ?? 0) * 100) / 100 : '' }));
    const by = calc.breakdowns.flatMap((b) => b.rows.map((r) => ({ Период: `${DIM_LABELS[b.dim]}: ${r.key}`, Выручка: Math.round(r.revenue * 100) / 100, 'Прошлый период': r.prev == null ? '' : Math.round(r.prev * 100) / 100 })));
    downloadFile(`noro-bi-${stamp()}.csv`, toCsv(['Период', 'Выручка', 'Прошлый период'], [...rows, ...by]), 'text/csv;charset=utf-8');
  };
  const exportHtml = () => {
    if (!calc || !source) return;
    const html = buildHtmlReport({
      source: source.name,
      period: calc.period,
      prev: calc.prevP,
      kpis: calc.kpis,
      prevKpis: calc.prevKpis,
      filters: v.filters,
      series: { labels: calc.cur.buckets.map((b) => bucketLabel(b, calc.g)), values: calc.cur.values },
      breakdowns: calc.breakdowns,
      anomalies: calc.anomalies,
    });
    downloadFile(`noro-bi-report-${safeFilename(source.name.replace(/\.[^.]+$/, ''))}-${stamp()}.html`, html, 'text/html;charset=utf-8');
  };

  const reset = async () => {
    await clearProductData('business-intelligence');
    data.setValue(INITIAL_DATA);
    view.setValue(INITIAL_VIEW);
    setConfirmReset(false);
    toast.success('Данные BI удалены из браузера');
  };

  const filterCount = Object.values(v.filters).reduce((s, x) => s + (x?.length ?? 0), 0);
  const actions = ds ? (
    <>
      <UploadButton accept=".csv,.tsv,.txt,.xlsx" onFile={(f) => void openFile(f)} />
      <button type="button" className="btn btn--outline btn--sm" onClick={exportHtml} data-testid="bi-export-html">
        <Icon name="download" /> HTML-отчёт
      </button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={exportCsv} data-testid="bi-export-csv">
        <Icon name="download" /> CSV
      </button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirmReset(true)} aria-label="Сбросить данные">
        <Icon name="trash" />
      </button>
    </>
  ) : null;

  return (
    <AppFrame
      icon="chart"
      name="Business Intelligence"
      source={ds && source ? `${source.demo ? 'Демо' : 'Ваш файл'}: ${source.name} · ${fmtInt(ds.rows)} строк · ${dayToRu(ds.minDay)}–${dayToRu(ds.maxDay)}` : 'Данные не загружены'}
      actions={actions}
      panel={ds ? { base: 'bi', tabKey: tab } : undefined}
      nav={
        ds ? (
          <Tabs<TabKey>
            label="Разделы BI"
            idBase="bi"
            value={tab}
            onChange={setTab}
            items={[
              { key: 'overview', label: 'Обзор', icon: 'grid' },
              { key: 'pivot', label: 'Таблица', icon: 'table' },
              { key: 'anomalies', label: 'Аномалии', icon: 'zap', count: calc?.anomalies.length || undefined },
              { key: 'changes', label: 'Изменения', icon: 'trend' },
              { key: 'method', label: 'Методика', icon: 'book' },
            ]}
          />
        ) : null
      }
      status={<StorageStatus saveError={data.saveError ?? view.saveError} extra={<span><Icon name="plug" size={12} /> Источник: файл · CRM и БД не подключены · прогнозов нет</span>} />}
    >
      {!data.loaded || !view.loaded ? (
        <div className="empty">
          <Spinner />
        </div>
      ) : !ds || !calc ? (
        <StartPanel
          title="Понятная картина продаж из обычной выгрузки"
          text="Загрузите таблицу продаж: BI посчитает только те показатели, для которых есть данные, сравнит периоды, найдёт необычные дни и покажет, какие категории и каналы дали изменение."
          steps={['Загрузите демо или свою выгрузку CSV/XLSX', 'Проверьте сопоставление колонок', 'Выберите период — сравнение с предыдущим включено', 'Кликайте по разбивкам, чтобы фильтровать всё сразу']}
          onDemo={() => void loadDemo('sales-demo.csv')}
          demoBusy={busy}
          demoLabel="Демо: продажи за год"
          extra={
            <button type="button" className="btn btn--ghost btn--sm" style={{ marginTop: 10 }} onClick={() => void loadDemo('funnel-demo.csv')} disabled={busy} data-testid="demo-funnel">
              <Icon name="flow" /> Демо: воронка по каналам
            </button>
          }
          upload={
            <FileDrop accept=".csv,.tsv,.txt,.xlsx" title="Загрузите свои данные" hint="CSV или XLSX до 15 МБ. Минимум — дата и сумма; лучше с номером заказа, категорией и каналом." busy={busy} onFile={(f) => void openFile(f)}>
              <a className="btn btn--ghost btn--sm" href="/demo/sales-demo.csv" download>
                <Icon name="download" /> Пример файла
              </a>
            </FileDrop>
          }
        />
      ) : (
        <>
          <div className="bi-controls">
            <div className="chip-row" role="group" aria-label="Период">
              {PRESETS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`chip${v.preset === key ? ' chip--active' : ''}`}
                  aria-pressed={v.preset === key}
                  onClick={() => setView({ preset: key, custom: key === 'custom' ? (v.custom ?? { from: dayToIso(calc.period.from), to: dayToIso(calc.period.to) }) : v.custom })}
                  data-testid={`preset-${key}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {v.preset === 'custom' && v.custom ? (
              <div className="bi-range">
                <label className="sr-only" htmlFor="bi-from">
                  С
                </label>
                <input id="bi-from" type="date" className="input input--sm" min={dayToIso(ds.minDay)} max={dayToIso(ds.maxDay)} value={v.custom.from} onChange={(e) => e.target.value && setView({ custom: { ...v.custom!, from: e.target.value } })} />
                <span className="dim">—</span>
                <label className="sr-only" htmlFor="bi-to">
                  По
                </label>
                <input id="bi-to" type="date" className="input input--sm" min={dayToIso(ds.minDay)} max={dayToIso(ds.maxDay)} value={v.custom.to} onChange={(e) => e.target.value && setView({ custom: { ...v.custom!, to: e.target.value } })} />
              </div>
            ) : null}
            <div className="chip-row" role="group" aria-label="Гранулярность">
              {(
                [
                  ['day', 'Дни'],
                  ['week', 'Недели'],
                  ['month', 'Месяцы'],
                ] as const
              ).map(([g, l]) => (
                <button key={g} type="button" className={`chip${v.granularity === g ? ' chip--active' : ''}`} aria-pressed={v.granularity === g} onClick={() => setView({ granularity: g })}>
                  {l}
                </button>
              ))}
            </div>
            <label className="check">
              <input type="checkbox" checked={v.compare} onChange={(e) => setView({ compare: e.target.checked })} />
              <span>Сравнить с прошлым периодом</span>
            </label>
          </div>
          <div className="bi-period dim">
            {dayToRu(calc.period.from)} — {dayToRu(calc.period.to)} ({calc.period.to - calc.period.from + 1} дн.)
            {calc.prevP ? ` · сравнение: ${dayToRu(calc.prevP.from)} — ${dayToRu(calc.prevP.to)}` : v.compare ? ' · предыдущего периода нет в данных' : ''}
            {calc.g !== v.granularity ? ' · для длинного периода показаны недели' : ''}
          </div>
          {filterCount ? (
            <div className="chip-row" aria-label="Активные фильтры">
              {DIMENSIONS.flatMap((d) =>
                (v.filters[d] ?? []).map((key) => (
                  <button key={`${d}:${key}`} type="button" className="chip chip--active" onClick={() => toggleFilter(d, key)} aria-label={`Убрать фильтр ${key}`}>
                    {DIM_LABELS[d]}: {key} <Icon name="x" size={12} />
                  </button>
                )),
              )}
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setView({ filters: {} })}>
                Сбросить фильтры
              </button>
            </div>
          ) : null}
          {calc.kpis.revenue === 0 && filterCount ? <p className="alert alert--warning">По выбранным фильтрам в этом периоде нет продаж.</p> : null}

          {tab === 'overview' ? (
            <Overview
              kpis={calc.kpis}
              prevKpis={calc.prevKpis}
              cur={calc.cur}
              prev={calc.prev}
              granularity={calc.g}
              breakdowns={calc.breakdowns}
              activeFilters={v.filters}
              toggleFilter={toggleFilter}
              anomalies={calc.anomalies}
              openAnomalies={() => setTab('anomalies')}
            />
          ) : null}
          {tab === 'pivot' ? <PivotTab breakdowns={calc.breakdowns} /> : null}
          {tab === 'anomalies' ? <AnomaliesTab anomalies={calc.anomalies} threshold={v.threshold} setThreshold={(threshold) => setView({ threshold })} /> : null}
          {tab === 'changes' ? <ChangesTab breakdowns={calc.breakdowns} hasPrev={Boolean(calc.prevP)} /> : null}
          {tab === 'method' ? <MethodTab /> : null}
        </>
      )}
      {pending ? (
        <MappingDialog<BiField>
          open
          fileName={pending.table.fileName}
          headers={pending.table.headers}
          sample={pending.table.rows.slice(0, 5)}
          fields={MAP_FIELDS}
          initial={pending.mapping}
          warnings={pending.table.warnings}
          rowCount={pending.table.rows.length}
          onCancel={() => setPending(null)}
          onConfirm={(m) => importTable(pending.table, m, pending.demo)}
        />
      ) : null}
      <ConfirmDialog
        open={confirmReset}
        title="Удалить данные BI из браузера?"
        message="Загруженная таблица и настройки отчёта будут удалены. Исходный файл на вашем компьютере не затрагивается."
        confirmLabel="Удалить"
        danger
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => void reset()}
      />
    </AppFrame>
  );
}
