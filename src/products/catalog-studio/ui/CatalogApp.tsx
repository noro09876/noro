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
import { useUndo } from '../../../hooks/useUndo';
import { toCsv } from '../../../lib/csv';
import { fetchDemoFile } from '../../../lib/demo';
import { downloadFile, safeFilename, stamp } from '../../../lib/download';
import { clearProductData } from '../../../lib/storage';
import { loadTabularFile, type LoadedTable } from '../../../lib/tabular';
import { detectCatalogColumns } from '../logic/columns';
import { exportHeaders, issuesToRecords, productsFromTable, productsToRecords } from '../logic/io';
import { detectIssues, issueSummary } from '../logic/issues';
import { newRule } from '../logic/rules';
import { CATALOG_FIELDS, DEFAULT_CHECKS, FIELD_LABELS, type CatalogField, type CheckSettings, type IssueKind, type Product, type Rule } from '../logic/types';
import { IssuesTab } from './IssuesTab';
import { ProductsTab } from './ProductsTab';
import { RulesTab } from './RulesTab';
import './catalog.css';

interface CatalogState {
  rows: Product[];
  headers: string[];
  mapping: Record<CatalogField, string> | null;
  checks: CheckSettings;
  rules: Rule[];
  source: { name: string; at: number; demo: boolean } | null;
}
const INITIAL: CatalogState = { rows: [], headers: [], mapping: null, checks: DEFAULT_CHECKS, rules: [newRule('trim'), newRule('normalizePrice')], source: null };
type TabKey = 'issues' | 'products' | 'rules';

const MAP_FIELDS: MappingField<CatalogField>[] = CATALOG_FIELDS.map((f) => ({ key: f, label: FIELD_LABELS[f], required: f === 'name' }));

export default function CatalogApp() {
  const toast = useToast();
  const store = useIdbState<CatalogState>('catalog-studio:state', INITIAL);
  const { value: state, setValue: setState, loaded } = store;
  const undo = useUndo<Product[]>();
  const [tab, setTab] = useState<TabKey>('issues');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ table: LoadedTable; mapping: Record<CatalogField, string> } | null>(null);
  const [kind, setKind] = useState<IssueKind | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const mapped = useMemo(() => new Set(CATALOG_FIELDS.filter((f) => state.mapping?.[f])), [state.mapping]);
  const issues = useMemo(() => detectIssues(state.rows, state.checks, mapped), [state.rows, state.checks, mapped]);
  const summary = useMemo(() => issueSummary(issues), [issues]);

  const commit = (label: string, next: Product[], message?: string) => {
    undo.push(label, state.rows);
    setState((s) => ({ ...s, rows: next }));
    if (message)
      toast.success(message, {
        action: {
          label: 'Отменить',
          onClick: () =>
            setState((s) => {
              const prev = undo.undo(s.rows);
              return prev ? { ...s, rows: prev.snapshot } : s;
            }),
        },
      });
  };
  const doUndo = () => {
    const prev = undo.undo(state.rows);
    if (prev) {
      setState((s) => ({ ...s, rows: prev.snapshot }));
      toast.info(`Отменено: ${prev.label}`);
    }
  };
  const doRedo = () => {
    const next = undo.redo(state.rows);
    if (next) {
      setState((s) => ({ ...s, rows: next.snapshot }));
      toast.info(`Повторено: ${next.label}`);
    }
  };

  const importTable = (table: LoadedTable, mapping: Record<CatalogField, string>, demo: boolean) => {
    if (!mapping.name && !mapping.sku) {
      toast.error('Выберите хотя бы колонку названия или артикула.');
      return;
    }
    const rows = productsFromTable(table, mapping);
    if (!rows.length) {
      toast.error('В файле нет непустых строк.');
      return;
    }
    undo.clear();
    setState((s) => ({ ...s, rows, headers: table.headers, mapping, source: { name: table.fileName, at: Date.now(), demo } }));
    setPending(null);
    setKind(null);
    setTab('issues');
    toast.success(`Загружено товаров: ${rows.length.toLocaleString('ru-RU')}`);
    for (const w of table.warnings) toast.info(w);
  };

  const openFile = async (file: File, demo = false) => {
    setBusy(true);
    try {
      const table = await loadTabularFile(file);
      if (table.rows.length > 100000) throw new Error(`В файле ${table.rows.length.toLocaleString('ru-RU')} строк. Демоверсия работает с каталогами до 100 000 строк.`);
      const mapping = detectCatalogColumns(table.headers);
      if (demo) importTable(table, mapping, true);
      else setPending({ table, mapping });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось прочитать файл');
    } finally {
      setBusy(false);
    }
  };

  const exportCatalog = () => {
    if (!state.mapping) return;
    const { headers, fieldOf } = exportHeaders(state.headers, state.mapping, state.rows);
    const base = safeFilename((state.source?.name ?? 'catalog').replace(/\.[^.]+$/, ''));
    downloadFile(`${base}-noro-${stamp()}.csv`, toCsv(headers, productsToRecords(state.rows, headers, fieldOf)), 'text/csv;charset=utf-8');
  };
  const exportIssues = () => {
    const recs = issuesToRecords(issues, state.rows);
    downloadFile(`noro-catalog-issues-${stamp()}.csv`, toCsv(['Строка', 'Артикул', 'Поле', 'Проблема', 'Важность', 'Детали', 'Как исправить'], recs), 'text/csv;charset=utf-8');
  };

  const reset = async () => {
    await clearProductData('catalog-studio');
    undo.clear();
    setState(INITIAL);
    setConfirmReset(false);
    toast.success('Каталог удалён из браузера');
  };

  const hasData = state.rows.length > 0;
  const actions = hasData ? (
    <>
      <button type="button" className="btn btn--ghost btn--sm" onClick={doUndo} disabled={!undo.canUndo} title={undo.undoLabel ? `Отменить: ${undo.undoLabel}` : 'Нечего отменять'} data-testid="cs-undo">
        <Icon name="undo" /> <span className="hide-sm">Отменить</span>
      </button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={doRedo} disabled={!undo.canRedo} aria-label="Повторить">
        <Icon name="redo" />
      </button>
      <UploadButton accept=".csv,.tsv,.txt,.xlsx" onFile={(f) => void openFile(f)} />
      <button type="button" className="btn btn--outline btn--sm" onClick={exportCatalog} data-testid="cs-export">
        <Icon name="download" /> Каталог CSV
      </button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={exportIssues} disabled={!issues.length}>
        <Icon name="download" /> Отчёт
      </button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirmReset(true)} aria-label="Сбросить данные">
        <Icon name="trash" />
      </button>
    </>
  ) : null;

  const problemCount = summary.filter((s) => s.kind !== 'no-description' && s.kind !== 'spaces' && s.kind !== 'caps').reduce((a, s) => a + s.count, 0);

  return (
    <AppFrame
      icon="box"
      name="Catalog Studio"
      source={state.source ? `${state.source.demo ? 'Демо-прайс' : 'Ваш файл'}: ${state.source.name} · ${state.rows.length.toLocaleString('ru-RU')} строк` : 'Каталог не загружен'}
      actions={actions}
      panel={hasData ? { base: 'cs', tabKey: tab } : undefined}
      nav={
        hasData ? (
          <Tabs<TabKey>
            label="Разделы Catalog Studio"
            idBase="cs"
            value={tab}
            onChange={setTab}
            items={[
              { key: 'issues', label: 'Проблемы', icon: 'alert', count: problemCount },
              { key: 'products', label: 'Товары', icon: 'table', count: state.rows.length },
              { key: 'rules', label: 'Правила', icon: 'wand', count: state.rules.filter((r) => r.enabled).length },
            ]}
          />
        ) : null
      }
      status={<StorageStatus saveError={store.saveError} extra={<span><Icon name="plug" size={12} /> Описания: шаблоны · маркетплейсы и 1С не подключены</span>} />}
    >
      {!loaded ? (
        <div className="empty">
          <Spinner />
        </div>
      ) : !hasData ? (
        <StartPanel
          title="Прайс без ошибок перед загрузкой на сайт и маркетплейсы"
          text="Catalog Studio проверит дубли, цены, штрихкоды и артикулы, покажет каждую проблему в строке, исправит типовые ошибки правилами с предпросмотром и отменой."
          steps={['Загрузите CSV или XLSX — колонки определятся автоматически', 'Посмотрите отчёт о проблемах', 'Настройте правила и посмотрите изменения до применения', 'Скачайте исправленный каталог и отчёт']}
          onDemo={() => {
            setBusy(true);
            void fetchDemoFile('catalog-demo.csv')
              .then((f) => openFile(f, true))
              .catch((e: unknown) => {
                toast.error(e instanceof Error ? e.message : 'Не удалось загрузить демо');
                setBusy(false);
              });
          }}
          demoBusy={busy}
          upload={
            <FileDrop accept=".csv,.tsv,.txt,.xlsx" title="Загрузите свой каталог" hint="CSV, TSV или XLSX (первый лист) до 15 МБ. Первая строка — заголовки." busy={busy} onFile={(f) => void openFile(f)}>
              <a className="btn btn--ghost btn--sm" href="/demo/catalog-demo.csv" download>
                <Icon name="download" /> Пример файла
              </a>
            </FileDrop>
          }
        />
      ) : (
        <>
          {tab === 'issues' ? (
            <IssuesTab
              summary={summary}
              total={state.rows.length}
              checks={state.checks}
              setChecks={(checks) => setState((s) => ({ ...s, checks }))}
              mapped={mapped}
              openKind={(k) => {
                setKind(k);
                setTab('products');
              }}
              goRules={() => setTab('rules')}
            />
          ) : null}
          {tab === 'products' ? <ProductsTab rows={state.rows} issues={issues} mapped={mapped} kindFilter={kind} setKindFilter={setKind} commit={commit} /> : null}
          {tab === 'rules' ? <RulesTab rows={state.rows} rules={state.rules} setRules={(rules) => setState((s) => ({ ...s, rules }))} commit={commit} /> : null}
        </>
      )}
      {pending ? (
        <MappingDialog<CatalogField>
          open
          fileName={pending.table.fileName}
          headers={pending.table.headers}
          sample={pending.table.rows.slice(0, 5)}
          fields={MAP_FIELDS}
          initial={pending.mapping}
          warnings={pending.table.warnings}
          rowCount={pending.table.rows.length}
          onCancel={() => setPending(null)}
          onConfirm={(m) => importTable(pending.table, m, false)}
        />
      ) : null}
      <ConfirmDialog
        open={confirmReset}
        title="Удалить каталог из браузера?"
        message="Товары, правила и настройки проверок будут удалены. Действие нельзя отменить — перед удалением можно скачать CSV."
        confirmLabel="Удалить"
        danger
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => void reset()}
      />
    </AppFrame>
  );
}
