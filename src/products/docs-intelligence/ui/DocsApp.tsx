import { useMemo, useState } from 'react';
import { AppFrame, StartPanel, StorageStatus } from '../../../components/app/AppFrame';
import { EmptyState, Spinner } from '../../../components/ui/Feedback';
import { FileDrop } from '../../../components/ui/FileDrop';
import { Icon } from '../../../components/ui/Icon';
import { ConfirmDialog, Modal } from '../../../components/ui/Modal';
import { Tabs } from '../../../components/ui/Tabs';
import { useToast } from '../../../components/ui/Toast';
import { useIdbState } from '../../../hooks/useIdbState';
import { toCsv } from '../../../lib/csv';
import { fetchDemoFile } from '../../../lib/demo';
import { downloadFile, stamp } from '../../../lib/download';
import { decodeText, looksBinary, readFileBuffer, validateFile } from '../../../lib/files';
import { clearProductData } from '../../../lib/storage';
import { computeChecks } from '../logic/checks';
import { applyCustomRules, isScanLike } from '../logic/extract';
import { buildDocFromCsv, buildDocFromText } from '../logic/parse';
import { DOC_STATUS_LABELS, DOC_TYPE_LABELS, FIELD_KEYS, FIELD_LABELS, type CustomRule, type DocRecord } from '../logic/types';
import { DocDetail } from './DocDetail';
import { RulesTab } from './RulesTab';
import './docs.css';

interface DocsState {
  docs: DocRecord[];
  rules: CustomRule[];
  activeId: string | null;
}
const INITIAL: DocsState = { docs: [], rules: [], activeId: null };
const MAX_DOCS = 200;
type TabKey = 'docs' | 'rules';

async function readDocFile(file: File, rules: CustomRule[]): Promise<DocRecord> {
  const ext = validateFile(file, { extensions: ['txt', 'csv', 'pdf', 'md', 'tsv'], maxBytes: 15 * 1024 * 1024 });
  const buf = await readFileBuffer(file);
  if (ext === 'pdf') {
    const { extractPdfText } = await import('../logic/pdf');
    const { text, pages, truncated } = await extractPdfText(buf);
    if (isScanLike(text, pages)) {
      throw new Error(`«${file.name}» похож на скан: в PDF нет текстового слоя. Распознавание изображений (OCR) в демо не подключено — это отдельный модуль.`);
    }
    const doc = buildDocFromText(text, file.name, 'pdf', rules);
    if (truncated) doc.history.push({ at: Date.now(), text: 'Обработаны первые 50 страниц PDF' });
    return doc;
  }
  const { text } = decodeText(buf);
  if (looksBinary(text)) throw new Error(`«${file.name}» не похож на текстовый файл.`);
  if (!text.trim()) throw new Error(`«${file.name}» пустой.`);
  if (ext === 'csv' || ext === 'tsv') return buildDocFromCsv(text, file.name);
  return buildDocFromText(text, file.name, 'txt', rules);
}

export default function DocsApp() {
  const toast = useToast();
  const store = useIdbState<DocsState>('docs-intelligence:state', INITIAL);
  const { value: state, setValue: setState, loaded } = store;
  const [tab, setTab] = useState<TabKey>('docs');
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [filter, setFilter] = useState<'all' | 'errors' | 'approved'>('all');

  const summaries = useMemo(
    () =>
      state.docs.map((d) => {
        const c = computeChecks(d);
        return { doc: d, errors: c.filter((x) => x.level === 'error').length, warnings: c.filter((x) => x.level === 'warning').length };
      }),
    [state.docs],
  );
  const active = state.docs.find((d) => d.id === state.activeId) ?? state.docs[0] ?? null;
  const list = summaries.filter((s) => (filter === 'errors' ? s.errors > 0 : filter === 'approved' ? s.doc.status === 'approved' : true));

  const addDocs = (docs: DocRecord[]) => {
    if (!docs.length) return;
    setState((s) => ({ ...s, docs: [...docs, ...s.docs].slice(0, MAX_DOCS), activeId: docs[0]!.id }));
    setTab('docs');
  };

  const openFiles = async (files: File[]) => {
    setBusy(true);
    const ok: DocRecord[] = [];
    for (const f of files.slice(0, 20)) {
      try {
        ok.push(await readDocFile(f, state.rules));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Не удалось обработать ${f.name}`);
      }
    }
    if (files.length > 20) toast.info('За один раз обрабатывается до 20 файлов.');
    addDocs(ok);
    if (ok.length) toast.success(`Обработано документов: ${ok.length}`);
    setBusy(false);
  };

  const loadDemo = async () => {
    setBusy(true);
    try {
      const files = await Promise.all(['invoice-418.txt', 'act-112.txt', 'contract-88.txt', 'payments-registry.csv'].map((f) => fetchDemoFile(f)));
      const docs = await Promise.all(files.map((f) => readDocFile(f, state.rules)));
      setState((s) => ({ ...s, docs: [...docs, ...s.docs.filter((d) => !docs.some((x) => x.fileName === d.fileName))], activeId: docs[0]!.id }));
      toast.success('Загружены демо-документы: счёт, акт, договор и реестр платежей');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось загрузить демо');
    } finally {
      setBusy(false);
    }
  };

  const replaceDoc = (doc: DocRecord) => setState((s) => ({ ...s, docs: s.docs.map((d) => (d.id === doc.id ? doc : d)) }));

  /** Applies an edit; tracked edits get a history entry and an undo action. */
  const updateDoc = (doc: DocRecord, historyText?: string) => {
    const prev = state.docs.find((d) => d.id === doc.id);
    replaceDoc({ ...doc, history: historyText ? [...doc.history, { at: Date.now(), text: historyText }].slice(-100) : doc.history });
    if (prev && historyText) toast.show('info', historyText, { action: { label: 'Отменить', onClick: () => replaceDoc(prev) } });
  };

  const removeDoc = (id: string) => {
    const idx = state.docs.findIndex((d) => d.id === id);
    const removed = state.docs[idx];
    if (!removed) return;
    setState((s) => ({ ...s, docs: s.docs.filter((d) => d.id !== id), activeId: null }));
    toast.success(`Документ «${removed.fileName}» удалён`, {
      action: {
        label: 'Отменить',
        onClick: () =>
          setState((s) => {
            const next = [...s.docs];
            next.splice(Math.min(idx, next.length), 0, removed);
            return { ...s, docs: next, activeId: removed.id };
          }),
      },
    });
  };

  const setRules = (rules: CustomRule[]) => {
    setState((s) => ({ ...s, rules, docs: s.docs.map((d) => (d.type === 'registry' ? d : { ...d, custom: applyCustomRules(d.text, rules) })) }));
  };

  const exportFields = () => {
    const headers = ['Файл', 'Тип', 'Статус', 'Ошибок', 'Предупреждений', ...FIELD_KEYS.map((k) => FIELD_LABELS[k]), ...state.rules.map((r) => r.label)];
    const rows = summaries
      .filter((s) => s.doc.type !== 'registry')
      .map(({ doc, errors, warnings }) => {
        const row: Record<string, string | number> = { Файл: doc.fileName, Тип: DOC_TYPE_LABELS[doc.type], Статус: DOC_STATUS_LABELS[doc.status], Ошибок: errors, Предупреждений: warnings };
        for (const k of FIELD_KEYS) row[FIELD_LABELS[k]] = doc.fields[k]?.value ?? '';
        for (const r of state.rules) row[r.label] = doc.custom[r.id]?.value ?? '';
        return row;
      });
    downloadFile(`noro-docs-fields-${stamp()}.csv`, toCsv(headers, rows), 'text/csv;charset=utf-8');
  };
  const exportChecks = () => {
    const rows = state.docs.flatMap((d) => computeChecks(d).map((c) => ({ Файл: d.fileName, Уровень: c.level === 'error' ? 'Ошибка' : c.level === 'warning' ? 'Предупреждение' : 'OK', Проверка: c.title, Детали: c.detail })));
    downloadFile(`noro-docs-checks-${stamp()}.csv`, toCsv(['Файл', 'Уровень', 'Проверка', 'Детали'], rows), 'text/csv;charset=utf-8');
  };

  const reset = async () => {
    await clearProductData('docs-intelligence');
    setState(INITIAL);
    setConfirmReset(false);
    toast.success('Документы удалены из браузера');
  };

  const hasDocs = state.docs.length > 0;
  const actions = hasDocs ? (
    <>
      <button type="button" className="btn btn--outline btn--sm" onClick={exportFields} data-testid="export-fields">
        <Icon name="download" /> Поля CSV
      </button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={exportChecks}>
        <Icon name="download" /> Проверки CSV
      </button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirmReset(true)}>
        <Icon name="trash" /> <span className="hide-sm">Сбросить</span>
      </button>
    </>
  ) : null;

  const uploader = (compact: boolean) => (
    <FileDrop
      accept=".txt,.csv,.pdf,.md,.tsv"
      multiple
      compact={compact}
      title={compact ? 'Добавить документы' : 'Загрузите свои документы'}
      hint="TXT, CSV или PDF с текстовым слоем, до 15 МБ, до 20 файлов за раз. Файлы не покидают браузер."
      busy={busy}
      onFile={(f) => void openFiles([f])}
      onFiles={(fs) => void openFiles(fs)}
    >
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPaste('')}>
        <Icon name="edit" /> Вставить текст
      </button>
      <a className="btn btn--ghost btn--sm" href="/demo/invoice-418.pdf" download>
        <Icon name="download" /> Демо-PDF
      </a>
    </FileDrop>
  );

  return (
    <AppFrame
      icon="scan"
      name="Docs Intelligence"
      source={hasDocs ? `Документов: ${state.docs.length} · с ошибками: ${summaries.filter((s) => s.errors).length}` : 'Документы не загружены'}
      actions={actions}
      panel={hasDocs ? { base: 'di', tabKey: tab } : undefined}
      nav={
        hasDocs ? (
          <Tabs<TabKey>
            label="Разделы Docs Intelligence"
            idBase="di"
            value={tab}
            onChange={setTab}
            items={[
              { key: 'docs', label: 'Документы', icon: 'fileText', count: state.docs.length },
              { key: 'rules', label: 'Свои поля', icon: 'sliders', count: state.rules.length || undefined },
            ]}
          />
        ) : null
      }
      status={<StorageStatus saveError={store.saveError} extra={<span><Icon name="plug" size={12} /> Извлечение: правила и шаблоны · OCR и 1С не подключены</span>} />}
    >
      {!loaded ? (
        <div className="empty">
          <Spinner />
        </div>
      ) : !hasDocs ? (
        <StartPanel
          title="Реквизиты и суммы из документов — с проверкой"
          text="Загрузите счёт, акт, договор или реестр. Система извлечёт поля, проверит ИНН, БИК и счёт по контрольным суммам, пересчитает НДС и итоги, а вы подтвердите результат."
          steps={['Загрузите демо-пакет или свои файлы', 'Откройте документ — ошибки подсвечены с причиной', 'Исправьте значение — проверки пересчитаются сразу', 'Отметьте документ проверенным и выгрузите CSV']}
          onDemo={() => void loadDemo()}
          demoBusy={busy}
          demoLabel="Демо: 4 документа"
          upload={uploader(false)}
        />
      ) : tab === 'rules' ? (
        <RulesTab rules={state.rules} onChange={setRules} />
      ) : (
        <div className="split split--side-l" style={{ alignItems: 'start' }}>
          <div style={{ display: 'grid', gap: 10, minWidth: 0 }}>
            <div className="chip-row" role="group" aria-label="Фильтр документов">
              {(
                [
                  ['all', 'Все'],
                  ['errors', 'С ошибками'],
                  ['approved', 'Проверенные'],
                ] as const
              ).map(([k, l]) => (
                <button key={k} type="button" className={`chip${filter === k ? ' chip--active' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                  {l}
                </button>
              ))}
            </div>
            <ul className="list-reset doc-list" aria-label="Документы">
              {list.map(({ doc, errors, warnings }) => (
                <li key={doc.id} className={doc.id === active?.id ? 'is-active' : undefined}>
                  <button type="button" className="doc-list__main" onClick={() => setState((s) => ({ ...s, activeId: doc.id }))} aria-current={doc.id === active?.id} data-testid="doc-item">
                    <b>{doc.fileName}</b>
                    <small>
                      {DOC_TYPE_LABELS[doc.type]} · {DOC_STATUS_LABELS[doc.status]}
                    </small>
                    <span className="chip-row" style={{ gap: 4 }}>
                      {errors ? <span className="badge badge--critical">{errors} ош.</span> : <span className="badge badge--good">без ошибок</span>}
                      {warnings ? <span className="badge badge--warning">{warnings} пред.</span> : null}
                    </span>
                  </button>
                  <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label={`Удалить ${doc.fileName}`} onClick={() => removeDoc(doc.id)}>
                    <Icon name="x" size={14} />
                  </button>
                </li>
              ))}
              {list.length === 0 ? <li className="dim" style={{ padding: 8, fontSize: 'var(--fs-sm)' }}>Нет документов по фильтру</li> : null}
            </ul>
            {uploader(true)}
          </div>
          <div style={{ minWidth: 0 }}>{active ? <DocDetail key={active.id} doc={active} rules={state.rules} onChange={updateDoc} /> : <EmptyState icon="fileText" title="Выберите документ" />}</div>
        </div>
      )}
      {paste !== null ? (
        <Modal
          open
          title="Вставить текст документа"
          onClose={() => setPaste(null)}
          wide
          footer={
            <>
              <button type="button" className="btn btn--ghost" onClick={() => setPaste(null)}>
                Отмена
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={paste.trim().length < 30}
                onClick={() => {
                  addDocs([buildDocFromText(paste, `Вставленный текст ${new Date().toLocaleTimeString('ru-RU')}`, 'paste', state.rules)]);
                  setPaste(null);
                }}
              >
                Разобрать
              </button>
            </>
          }
        >
          <textarea className="textarea mono" rows={14} value={paste} onChange={(e) => setPaste(e.target.value.slice(0, 200000))} placeholder="Скопируйте текст счёта, акта или договора…" aria-label="Текст документа" />
        </Modal>
      ) : null}
      <ConfirmDialog
        open={confirmReset}
        title="Удалить все документы?"
        message="Документы, результаты проверок, правки и свои поля будут удалены из этого браузера. Перед удалением можно выгрузить CSV."
        confirmLabel="Удалить"
        danger
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => void reset()}
      />
    </AppFrame>
  );
}
