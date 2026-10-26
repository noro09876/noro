import { useMemo, useState } from 'react';
import { AppFrame, StartPanel, StorageStatus } from '../../../components/app/AppFrame';
import { MappingDialog, type MappingField } from '../../../components/app/MappingDialog';
import { ConfirmDialog } from '../../../components/ui/Modal';
import { FileDrop } from '../../../components/ui/FileDrop';
import { Icon } from '../../../components/ui/Icon';
import { Tabs } from '../../../components/ui/Tabs';
import { UploadButton } from '../../../components/ui/UploadButton';
import { useToast } from '../../../components/ui/Toast';
import { Spinner } from '../../../components/ui/Feedback';
import { useIdbState } from '../../../hooks/useIdbState';
import { useUndo } from '../../../hooks/useUndo';
import { fetchDemoFile } from '../../../lib/demo';
import { loadTabularFile, type LoadedTable } from '../../../lib/tabular';
import { clearProductData } from '../../../lib/storage';
import { detectLeadColumns } from '../logic/columns';
import { DEFAULT_DEDUPE, type DedupeRules } from '../logic/dedupe';
import { detectIssues } from '../logic/issues';
import { leadsFromTable } from '../logic/lead';
import { DEFAULT_SCORING, scoreAll } from '../logic/scoring';
import { DEFAULT_TEMPLATES, type MessageTemplate } from '../logic/templates';
import { FIELD_LABELS, LEAD_FIELDS, type Lead, type LeadField, type ScoringConfig } from '../logic/types';
import { FunnelTab } from './FunnelTab';
import { LeadsTab } from './LeadsTab';
import { MessagesTab } from './MessagesTab';
import { QualityTab } from './QualityTab';
import { ScoringTab } from './ScoringTab';

export interface LeadState {
  leads: Lead[];
  scoring: ScoringConfig;
  templates: MessageTemplate[];
  dedupe: DedupeRules;
  source: { name: string; at: number; demo: boolean } | null;
}

const INITIAL: LeadState = { leads: [], scoring: DEFAULT_SCORING, templates: DEFAULT_TEMPLATES, dedupe: DEFAULT_DEDUPE, source: null };

const MAP_FIELDS: MappingField<LeadField>[] = LEAD_FIELDS.map((f) => ({
  key: f,
  label: FIELD_LABELS[f],
  hint: f === 'email' || f === 'phone' ? 'Нужен хотя бы один контакт' : undefined,
}));

type TabKey = 'leads' | 'quality' | 'scoring' | 'messages' | 'funnel';

export default function LeadEngineApp() {
  const toast = useToast();
  const store = useIdbState<LeadState>('lead-engine:state', INITIAL);
  const { value: state, setValue: setState, loaded } = store;
  const undo = useUndo<Lead[]>();
  const [tab, setTab] = useState<TabKey>('leads');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ table: LoadedTable; mapping: Record<LeadField, string>; demo: boolean } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const scores = useMemo(() => scoreAll(state.leads, state.scoring), [state.leads, state.scoring]);
  const issues = useMemo(() => detectIssues(state.leads), [state.leads]);

  /** Applies a change to leads with an undo snapshot. */
  const commitLeads = (label: string, next: Lead[], opts: { toast?: string } = {}) => {
    undo.push(label, state.leads);
    setState((s) => ({ ...s, leads: next }));
    if (opts.toast) {
      toast.success(opts.toast, {
        action: {
          label: 'Отменить',
          onClick: () => {
            setState((s) => {
              const prev = undo.undo(s.leads);
              return prev ? { ...s, leads: prev.snapshot } : s;
            });
          },
        },
      });
    }
  };

  const doUndo = () => {
    const prev = undo.undo(state.leads);
    if (prev) {
      setState((s) => ({ ...s, leads: prev.snapshot }));
      toast.info(`Отменено: ${prev.label}`);
    }
  };
  const doRedo = () => {
    const next = undo.redo(state.leads);
    if (next) {
      setState((s) => ({ ...s, leads: next.snapshot }));
      toast.info(`Повторено: ${next.label}`);
    }
  };

  const openFile = async (file: File, demo = false) => {
    setBusy(true);
    try {
      const table = await loadTabularFile(file);
      const mapping = detectLeadColumns(table.headers);
      if (demo) {
        importTable(table, mapping, true);
      } else {
        setPending({ table, mapping, demo });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось прочитать файл');
    } finally {
      setBusy(false);
    }
  };

  const importTable = (table: LoadedTable, mapping: Record<LeadField, string>, demo: boolean) => {
    if (!mapping.email && !mapping.phone && !mapping.name && !mapping.company) {
      toast.error('Не выбрана ни одна из ключевых колонок: имя, компания, email или телефон.');
      return;
    }
    const leads = leadsFromTable(table, mapping);
    if (leads.length === 0) {
      toast.error('После сопоставления колонок не осталось ни одной непустой записи.');
      return;
    }
    undo.clear();
    setState((s) => ({ ...s, leads, source: { name: table.fileName, at: Date.now(), demo } }));
    setPending(null);
    setTab(demo ? 'quality' : 'leads');
    toast.success(`Импортировано записей: ${leads.length.toLocaleString('ru-RU')}${table.warnings.length ? ' (есть предупреждения)' : ''}`);
    for (const w of table.warnings) toast.info(w);
  };

  const loadDemo = async () => {
    setBusy(true);
    try {
      await openFile(await fetchDemoFile('leads-demo.csv'), true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось загрузить демо');
      setBusy(false);
    }
  };

  const reset = async () => {
    await clearProductData('lead-engine');
    undo.clear();
    setState(INITIAL);
    setConfirmReset(false);
    toast.success('Данные Lead Engine удалены из браузера');
  };

  const hasData = state.leads.length > 0;
  const issueLeadCount = new Set(issues.filter((i) => i.kind !== 'unnormalized').map((i) => i.leadId)).size;

  const actions = hasData ? (
    <>
      <button type="button" className="btn btn--ghost btn--sm" onClick={doUndo} disabled={!undo.canUndo} title={undo.undoLabel ? `Отменить: ${undo.undoLabel}` : 'Нечего отменять'}>
        <Icon name="undo" /> <span className="hide-sm">Отменить</span>
      </button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={doRedo} disabled={!undo.canRedo} aria-label="Повторить">
        <Icon name="redo" />
      </button>
      <UploadButton accept=".csv,.tsv,.txt,.xlsx" onFile={(f) => void openFile(f)} />
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirmReset(true)}>
        <Icon name="trash" /> Сбросить
      </button>
    </>
  ) : null;

  return (
    <AppFrame
      icon="target"
      name="Lead Engine"
      source={state.source ? `${state.source.demo ? 'Демо-база' : 'Ваш файл'}: ${state.source.name} · ${state.leads.length.toLocaleString('ru-RU')} лидов` : 'Нет загруженных данных'}
      actions={actions}
      panel={hasData ? { base: 'le', tabKey: tab } : undefined}
      nav={
        hasData ? (
          <Tabs<TabKey>
            label="Разделы Lead Engine"
            idBase="le"
            value={tab}
            onChange={setTab}
            items={[
              { key: 'leads', label: 'Лиды', icon: 'users', count: state.leads.length },
              { key: 'quality', label: 'Качество данных', icon: 'shieldCheck', count: issueLeadCount },
              { key: 'scoring', label: 'Скоринг', icon: 'sliders' },
              { key: 'messages', label: 'Сообщения', icon: 'send' },
              { key: 'funnel', label: 'Воронка', icon: 'chart' },
            ]}
          />
        ) : null
      }
      status={<StorageStatus saveError={store.saveError} extra={<span><Icon name="plug" size={12} /> Скоринг: правила (локально) · CRM не подключена</span>} />}
    >
      {!loaded ? (
        <div className="empty"><Spinner /></div>
      ) : !hasData ? (
        <StartPanel
          title="Загрузите базу лидов — получите приоритеты"
          text="Lead Engine проверит контакты, найдёт дубли, оценит каждого лида по вашим правилам и подготовит сообщения. Всё считается в браузере."
          steps={['Загрузите CSV или XLSX — колонки определятся автоматически', 'Исправьте проблемы во вкладке «Качество данных»', 'Настройте правила скоринга и получите рейтинг A/B/C', 'Выгрузите результат с сообщениями в CSV']}
          onDemo={() => void loadDemo()}
          demoBusy={busy}
          upload={
            <FileDrop
              accept=".csv,.tsv,.txt,.xlsx"
              title="Загрузите свои данные"
              hint="CSV, TSV или XLSX до 15 МБ. Первая строка — заголовки."
              busy={busy}
              onFile={(f) => void openFile(f)}
            >
              <a className="btn btn--ghost btn--sm" href="/demo/leads-demo.csv" download>
                <Icon name="download" /> Пример файла
              </a>
            </FileDrop>
          }
        />
      ) : (
        <>
          {tab === 'leads' ? <LeadsTab state={state} setState={setState} scores={scores} issues={issues} commitLeads={commitLeads} /> : null}
          {tab === 'quality' ? <QualityTab state={state} setState={setState} issues={issues} commitLeads={commitLeads} goToLeads={() => setTab('leads')} /> : null}
          {tab === 'scoring' ? <ScoringTab state={state} setState={setState} scores={scores} /> : null}
          {tab === 'messages' ? <MessagesTab state={state} setState={setState} scores={scores} commitLeads={commitLeads} /> : null}
          {tab === 'funnel' ? <FunnelTab state={state} scores={scores} /> : null}
        </>
      )}

      {pending ? (
        <MappingDialog<LeadField>
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
        title="Удалить данные Lead Engine?"
        message="База лидов, правила скоринга и шаблоны будут удалены из этого браузера. Действие нельзя отменить. Перед удалением можно выгрузить CSV."
        confirmLabel="Удалить"
        danger
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => void reset()}
      />
    </AppFrame>
  );
}
