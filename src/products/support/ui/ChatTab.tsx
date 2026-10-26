import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Icon } from '../../../components/ui/Icon';
import { EmptyState } from '../../../components/ui/Feedback';
import { useToast } from '../../../components/ui/Toast';
import { generateRemote, getAiStatus } from '../../../lib/ai/adapter';
import { copyText } from '../../../lib/download';
import { fmtDateTime } from '../../../lib/format';
import { uid } from '../../../lib/id';
import { composeAnswer, modelInstructions } from '../logic/answer';
import { classify } from '../logic/classify';
import { SAMPLE_QUESTIONS } from '../logic/demoKb';
import type { SearchIndex } from '../logic/search';
import { PRIORITY_LABELS, type ChatMessage, type ComposedAnswer, type Conversation, type Ticket } from '../logic/types';
import type { SetSupport, SupportState } from './state';

const KIND_META: Record<ComposedAnswer['kind'], { label: string; cls: string }> = {
  answer: { label: 'Ответ по базе', cls: 'badge--good' },
  insufficient: { label: 'Недостаточно данных', cls: 'badge--warning' },
  escalate: { label: 'Передано оператору', cls: 'badge--info' },
  blocked: { label: 'Стоп-тема', cls: 'badge--critical' },
};

function ticketReason(a: ComposedAnswer, high: boolean): string | null {
  if (a.kind === 'insufficient') return 'В базе знаний нет ответа';
  if (a.kind === 'escalate') return 'Клиент просит оператора или претензия';
  if (a.kind === 'blocked') return 'Стоп-тема';
  if (high) return 'Высокий приоритет — проверить ответ';
  return null;
}

interface Props {
  state: SupportState;
  setState: SetSupport;
  index: SearchIndex;
  openTicket: (id: string) => void;
  openArticle: (id: string) => void;
}

export function ChatTab({ state, setState, index, openTicket, openArticle }: Props) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [thinking, setThinking] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const conv = state.conversations.find((c) => c.id === state.activeId) ?? null;
  const messages = useMemo(() => conv?.messages ?? [], [conv]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, thinking]);

  const ask = async (question: string) => {
    const q = question.trim().slice(0, 1000);
    if (!q || thinking) return;
    setText('');
    const classification = classify(q);
    const userMsg: ChatMessage = { id: uid('m'), role: 'user', text: q, at: Date.now(), classification };
    let convId = state.activeId;
    setState((s) => {
      const existing = s.conversations.find((c) => c.id === s.activeId);
      if (existing) {
        return { ...s, conversations: s.conversations.map((c) => (c.id === existing.id ? { ...c, messages: [...c.messages, userMsg] } : c)) };
      }
      const c: Conversation = { id: uid('c'), startedAt: Date.now(), messages: [userMsg] };
      convId = c.id;
      return { ...s, activeId: c.id, conversations: [c, ...s.conversations].slice(0, 50) };
    });

    setThinking(true);
    let answer = composeAnswer(q, index, state.settings);
    if (state.settings.useModel && (answer.kind === 'answer' || answer.kind === 'insufficient') && answer.sources.length) {
      try {
        const status = await getAiStatus();
        if (status.available) {
          const remote = await generateRemote({
            task: 'support-answer',
            instructions: modelInstructions(state.settings),
            input: q,
            context: answer.sources.map((s) => `${s.title}: ${state.articles.find((a) => a.id === s.articleId)?.body ?? s.snippet}`),
          });
          answer = { ...answer, text: remote, engine: 'model', note: `Ответ сформулирован моделью (${status.provider ?? 'сервер'}) строго по найденным источникам. ${answer.note ?? ''}` };
        } else {
          answer = { ...answer, note: `${answer.note ?? ''} Модель не использована: ${status.reason}`.trim() };
        }
      } catch (e) {
        answer = { ...answer, note: `${answer.note ?? ''} Модель вернула ошибку (${e instanceof Error ? e.message : 'неизвестно'}), показан локальный ответ.`.trim() };
      }
    } else {
      // short pause so the reply doesn't appear before the question renders
      await new Promise((r) => setTimeout(r, 180));
    }
    const reason = ticketReason(answer, classification.priority === 'high');
    const now = Date.now();
    const ticket: Ticket | null = reason
      ? {
          id: uid('t'),
          conversationId: convId ?? '',
          createdAt: now,
          updatedAt: now,
          question: q,
          classification,
          status: 'open',
          draft: answer.kind === 'answer' ? answer.text : [state.settings.greeting, '', state.settings.signature].filter((x, i) => x || i === 1).join('\n\n'),
          reason,
          confidence: answer.confidence,
        }
      : null;
    const botMsg: ChatMessage = { id: uid('m'), role: 'bot', text: answer.text, at: Date.now(), answer, ticketId: ticket?.id };
    setState((s) => ({
      ...s,
      conversations: s.conversations.map((c) => (c.id === convId ? { ...c, messages: [...c.messages, botMsg] } : c)),
      tickets: ticket ? [{ ...ticket, conversationId: convId ?? '' }, ...s.tickets] : s.tickets,
    }));
    setThinking(false);
    if (ticket) toast.info(`Создано обращение для оператора: ${ticket.reason.toLowerCase()}`);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void ask(text);
  };

  /** Operator handoff requested by hand for an answer the client was not happy with. */
  const escalateManually = (messageId: string) => {
    if (!conv) return;
    const i = conv.messages.findIndex((x) => x.id === messageId);
    const bot = conv.messages[i];
    const user = conv.messages[i - 1];
    if (!bot?.answer || user?.role !== 'user') return;
    const now = Date.now();
    const t: Ticket = {
      id: uid('t'),
      conversationId: conv.id,
      createdAt: now,
      updatedAt: now,
      question: user.text,
      classification: user.classification ?? classify(user.text),
      status: 'open',
      draft: bot.text,
      reason: 'Передано вручную из чата',
      confidence: bot.answer.confidence,
    };
    setState((s) => ({
      ...s,
      tickets: [t, ...s.tickets],
      conversations: s.conversations.map((c) => (c.id === conv.id ? { ...c, messages: c.messages.map((x) => (x.id === messageId ? { ...x, ticketId: t.id } : x)) } : c)),
    }));
    toast.success('Создано обращение для оператора', { action: { label: 'Открыть', onClick: () => openTicket(t.id) } });
  };

  const newChat = () => setState((s) => ({ ...s, activeId: null }));

  return (
    <div className="split split--side" style={{ alignItems: 'start' }}>
      <div className="panel chat">
        <div className="panel__head">
          <h3 className="panel__title">
            <Icon name="message" size={16} /> Чат клиента
          </h3>
          <button type="button" className="btn btn--ghost btn--sm" onClick={newChat} disabled={!conv}>
            <Icon name="plus" /> Новый диалог
          </button>
        </div>
        <div className="chat__list" ref={listRef} aria-live="polite" data-testid="chat-list">
          {messages.length === 0 ? (
            <EmptyState icon="message" title="Задайте вопрос как клиент" text="Например, о доставке, оплате или возврате. Ответ собирается только из статей базы знаний." />
          ) : (
            messages.map((m) => <Bubble key={m.id} m={m} tickets={state.tickets} openTicket={openTicket} openArticle={openArticle} escalate={escalateManually} />)
          )}
          {thinking ? (
            <div className="bubble bubble--bot">
              <span className="spinner" aria-hidden /> Ищу в базе знаний…
            </div>
          ) : null}
        </div>
        <form className="chat__form" onSubmit={submit}>
          <label className="sr-only" htmlFor="chat-input">
            Вопрос клиента
          </label>
          <textarea
            id="chat-input"
            className="textarea"
            rows={2}
            maxLength={1000}
            placeholder="Напишите вопрос…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void ask(text);
              }
            }}
            data-testid="chat-input"
          />
          <button type="submit" className="btn btn--primary" disabled={!text.trim() || thinking} data-testid="chat-send">
            <Icon name="send" /> <span className="hide-sm">Отправить</span>
          </button>
        </form>
      </div>
      <aside className="panel">
        <div className="panel__head">
          <h3 className="panel__title">Примеры вопросов</h3>
        </div>
        <div className="panel__body" style={{ display: 'grid', gap: 8 }}>
          {SAMPLE_QUESTIONS.map((q) => (
            <button key={q} type="button" className="chip" style={{ textAlign: 'left', justifyContent: 'flex-start' }} onClick={() => void ask(q)} disabled={thinking}>
              {q}
            </button>
          ))}
          <p className="dim" style={{ fontSize: 'var(--fs-xs)', marginTop: 6 }}>
            Режим: {state.settings.useModel ? 'модель по источникам (если подключена на сервере), иначе локальный' : 'локальный поиск и сборка ответа из статей'}. Порог уверенности: {Math.round(state.settings.threshold * 100)}%.
          </p>
          {state.conversations.length > 1 ? (
            <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
              <div className="field__label">История диалогов</div>
              {state.conversations.slice(0, 8).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`chip${c.id === state.activeId ? ' chip--active' : ''}`}
                  style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                  onClick={() => setState((s) => ({ ...s, activeId: c.id }))}
                  aria-pressed={c.id === state.activeId}
                >
                  <span className="nowrap" style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                    {fmtDateTime(c.startedAt)} · {c.messages[0]?.text ?? 'пусто'}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function Bubble({ m, tickets, openTicket, openArticle, escalate }: { m: ChatMessage; tickets: Ticket[]; openTicket: (id: string) => void; openArticle: (id: string) => void; escalate: (messageId: string) => void }) {
  const toast = useToast();
  if (m.role === 'user') {
    return (
      <div className="bubble bubble--user">
        <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
        {m.classification ? (
          <div className="bubble__meta">
            <span className="badge badge--outline">{m.classification.category}</span>
            <span className={`badge ${m.classification.priority === 'high' ? 'badge--critical' : m.classification.priority === 'medium' ? 'badge--warning' : 'badge--outline'}`}>
              Приоритет: {PRIORITY_LABELS[m.classification.priority].toLowerCase()}
            </span>
          </div>
        ) : null}
      </div>
    );
  }
  if (m.role === 'operator') {
    return (
      <div className="bubble bubble--operator">
        <div className="bubble__who">
          <Icon name="user" size={12} /> Оператор
        </div>
        <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
      </div>
    );
  }
  const a = m.answer;
  const ticket = m.ticketId ? tickets.find((t) => t.id === m.ticketId) : undefined;
  return (
    <div className="bubble bubble--bot" data-testid="bot-answer" data-kind={a?.kind}>
      <div className="bubble__who">
        <Icon name="bot" size={12} /> NORO Support
        {a ? <span className={`badge ${KIND_META[a.kind].cls}`}>{KIND_META[a.kind].label}</span> : null}
        {a ? <span className="dim mono" style={{ fontSize: '0.68rem' }}>уверенность {Math.round(a.confidence * 100)}%</span> : null}
      </div>
      <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
      {a && a.sources.length ? (
        <div className="sources">
          <div className="field__label">{a.kind === 'answer' ? 'Источники' : 'Ближайшие статьи (не использованы в ответе)'}</div>
          <ol className="list-reset">
            {a.sources.map((s, i) => (
              <li key={s.articleId}>
                <button type="button" className="source" onClick={() => openArticle(s.articleId)}>
                  <span className="mono dim">[{i + 1}]</span> <b>{s.title}</b>
                  <span className="dim mono" style={{ marginLeft: 'auto', fontSize: '0.68rem' }}>
                    покрытие {Math.round(s.coverage * 100)}%
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {a?.note ? (
        <details className="howto">
          <summary>Как получен ответ</summary>
          <p>{a.note}</p>
          <p>Движок: {a.engine === 'model' ? 'языковая модель через серверную функцию' : 'локальный поиск BM25 + извлечение предложений, без генерации'}.</p>
        </details>
      ) : null}
      <div className="bubble__actions">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => void copyText(m.text).then((ok) => (ok ? toast.success('Ответ скопирован') : toast.error('Не удалось скопировать')))}
        >
          <Icon name="copy" /> Копировать
        </button>
        {ticket ? (
          <button type="button" className="btn btn--outline btn--sm" onClick={() => openTicket(ticket.id)}>
            <Icon name="inbox" /> Обращение оператору
          </button>
        ) : (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => escalate(m.id)}>
            <Icon name="user" /> Передать оператору
          </button>
        )}
      </div>
    </div>
  );
}
