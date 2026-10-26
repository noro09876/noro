import { useMemo, useState } from 'react';
import { AppFrame, StartPanel, StorageStatus } from '../../../components/app/AppFrame';
import { FileDrop } from '../../../components/ui/FileDrop';
import { Icon } from '../../../components/ui/Icon';
import { ConfirmDialog } from '../../../components/ui/Modal';
import { Spinner } from '../../../components/ui/Feedback';
import { Tabs } from '../../../components/ui/Tabs';
import { useToast } from '../../../components/ui/Toast';
import { useIdbState } from '../../../hooks/useIdbState';
import { clearProductData } from '../../../lib/storage';
import { DEMO_ARTICLES, DEMO_SETTINGS } from '../logic/demoKb';
import { buildIndex } from '../logic/search';
import { ChatTab } from './ChatTab';
import { importKbFile, KbTab } from './KbTab';
import { SettingsTab } from './SettingsTab';
import { INITIAL, type SupportState } from './state';
import { StatsTab } from './StatsTab';
import { TicketsTab } from './TicketsTab';
import './support.css';

type TabKey = 'chat' | 'tickets' | 'kb' | 'settings' | 'stats';

export default function SupportApp() {
  const toast = useToast();
  const store = useIdbState<SupportState>('support:state', INITIAL);
  const { value: state, setValue, loaded } = store;
  const setState = (fn: (s: SupportState) => SupportState) => setValue(fn);
  const [tab, setTab] = useState<TabKey>('chat');
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [articleId, setArticleId] = useState<string | null>(null);
  const [prefill, setPrefill] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  // The index is rebuilt whenever articles or synonyms change: edits apply to the very next question.
  const index = useMemo(() => buildIndex(state.articles, state.settings.synonyms), [state.articles, state.settings.synonyms]);

  const started = state.source !== null;
  const openCount = state.tickets.filter((t) => t.status !== 'resolved').length;

  const loadDemo = () => {
    setValue({ ...INITIAL, articles: DEMO_ARTICLES, settings: DEMO_SETTINGS, source: { name: 'магазин «Домотека» (вымышленный)', at: Date.now(), demo: true } });
    setTab('chat');
    toast.success(`Загружена демо-база: ${DEMO_ARTICLES.length} статей`);
  };

  const startOwn = async (file: File | null) => {
    setBusy(true);
    try {
      const articles = file ? await importKbFile(file) : [];
      setValue({ ...INITIAL, articles, source: { name: file?.name ?? 'пустая база', at: Date.now(), demo: false } });
      setTab(articles.length ? 'chat' : 'kb');
      toast.success(articles.length ? `Импортировано статей: ${articles.length}` : 'Создана пустая база — добавьте первую статью');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось прочитать файл');
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    await clearProductData('support');
    setValue(INITIAL);
    setConfirmReset(false);
    setTicketId(null);
    setArticleId(null);
    toast.success('Данные Support удалены из браузера');
  };

  const actions = started ? (
    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirmReset(true)}>
      <Icon name="trash" /> Сбросить
    </button>
  ) : null;

  return (
    <AppFrame
      icon="message"
      name="Support"
      source={state.source ? `${state.source.demo ? 'Демо-база' : 'Ваша база'}: ${state.source.name} · ${state.articles.length} статей` : 'База знаний не загружена'}
      actions={actions}
      panel={started ? { base: 'sp', tabKey: tab } : undefined}
      nav={
        started ? (
          <Tabs<TabKey>
            label="Разделы Support"
            idBase="sp"
            value={tab}
            onChange={setTab}
            items={[
              { key: 'chat', label: 'Чат', icon: 'message' },
              { key: 'tickets', label: 'Обращения', icon: 'inbox', count: openCount || undefined },
              { key: 'kb', label: 'База знаний', icon: 'book', count: state.articles.length },
              { key: 'settings', label: 'Настройки', icon: 'settings' },
              { key: 'stats', label: 'Статистика', icon: 'chart' },
            ]}
          />
        ) : null
      }
      status={<StorageStatus saveError={store.saveError} extra={<span><Icon name="plug" size={12} /> Ответы: {state.settings.useModel ? 'модель по источникам (если подключена)' : 'локальный поиск, без генерации'} · каналы не подключены</span>} />}
    >
      {!loaded ? (
        <div className="empty">
          <Spinner />
        </div>
      ) : !started ? (
        <StartPanel
          title="Поддержка, которая отвечает только по вашей базе знаний"
          text="Клиент спрашивает своими словами, система находит статьи, собирает ответ из их предложений и показывает источники. Если данных не хватает — честно говорит об этом и создаёт обращение оператору."
          steps={[
            'Загрузите демо-базу магазина или свою (.md, .txt, .json)',
            'Задайте вопрос в чате и посмотрите источники ответа',
            'Спросите то, чего нет в базе, — увидите эскалацию',
            'Ответьте в «Обращениях» и пополните базу знаний',
          ]}
          onDemo={loadDemo}
          demoLabel="Демо: база магазина"
          upload={
            <FileDrop accept=".md,.txt,.json,.markdown" title="Загрузите свою базу знаний" hint="Markdown или текст до 2 МБ: статьи делятся по заголовкам # и ##. Или JSON, выгруженный из NORO Support." busy={busy} onFile={(f) => void startOwn(f)}>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => void startOwn(null)}>
                <Icon name="plus" /> Начать с пустой базы
              </button>
            </FileDrop>
          }
        />
      ) : (
        <>
          {tab === 'chat' ? (
            <ChatTab
              state={state}
              setState={setState}
              index={index}
              openTicket={(id) => {
                setTicketId(id);
                setTab('tickets');
              }}
              openArticle={(id) => {
                setArticleId(id);
                setTab('kb');
              }}
            />
          ) : null}
          {tab === 'tickets' ? <TicketsTab state={state} setState={setState} selectedId={ticketId} setSelectedId={setTicketId} /> : null}
          {tab === 'kb' ? (
            <KbTab
              state={state}
              setState={setState}
              selectedId={articleId}
              setSelectedId={(id) => {
                setArticleId(id);
                setPrefill('');
              }}
              prefill={prefill}
            />
          ) : null}
          {tab === 'settings' ? <SettingsTab state={state} setState={setState} /> : null}
          {tab === 'stats' ? (
            <StatsTab
              state={state}
              onCreateArticle={(title) => {
                setArticleId(null);
                setPrefill(title);
                setTab('kb');
              }}
            />
          ) : null}
        </>
      )}
      <ConfirmDialog
        open={confirmReset}
        title="Удалить данные Support?"
        message="База знаний, диалоги, обращения и настройки будут удалены из этого браузера. Перед удалением можно выгрузить базу в JSON и обращения в CSV."
        confirmLabel="Удалить"
        danger
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => void reset()}
      />
    </AppFrame>
  );
}
