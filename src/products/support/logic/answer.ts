import { terms } from '../../../lib/text/tokenize';
import { bestSentences, search, type Hit, type SearchIndex } from './search';
import type { ComposedAnswer, SourceRef, SupportSettings } from './types';

function matchList(question: string, list: string[]): string | null {
  const lower = question.toLowerCase().replace(/ё/g, 'е');
  const stems = new Set(terms(question));
  for (const raw of list) {
    const k = raw.trim().toLowerCase().replace(/ё/g, 'е');
    if (!k) continue;
    if (lower.includes(k)) return raw.trim();
    const kt = terms(k);
    if (kt.length > 0 && kt.every((t) => stems.has(t))) return raw.trim();
  }
  return null;
}

function wrap(body: string, s: SupportSettings): string {
  const parts: string[] = [];
  if (s.greeting.trim()) parts.push(s.greeting.trim());
  parts.push(body);
  if (s.signature.trim()) parts.push(s.signature.trim());
  return parts.join('\n\n');
}

const INTRO = {
  friendly: 'Вот что написано в нашей базе знаний:',
  formal: 'Согласно информации в базе знаний:',
};

/** Groups hits by article and keeps the strongest chunk of each article. */
export function topSources(hits: Hit[], max: number): Hit[] {
  const seen = new Set<string>();
  const out: Hit[] = [];
  for (const h of hits) {
    if (seen.has(h.chunk.articleId)) continue;
    seen.add(h.chunk.articleId);
    out.push(h);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Local, deterministic answer composer.
 * Order of checks: stop topics → escalation keywords → confidence threshold → extractive answer.
 * The answer is made only of sentences from the knowledge base, so every claim has a source.
 */
export function composeAnswer(question: string, index: SearchIndex, settings: SupportSettings): ComposedAnswer {
  const q = question.trim();
  if (!q) return { kind: 'insufficient', text: 'Вопрос пустой.', sources: [], confidence: 0, engine: 'local' };

  const stop = matchList(q, settings.stopTopics);
  if (stop) {
    return {
      kind: 'blocked',
      text: wrap(
        settings.tone === 'formal'
          ? 'Этот вопрос не входит в компетенцию автоматической поддержки. Мы передали его специалисту.'
          : 'На такой вопрос я не отвечаю автоматически — передал его специалисту, он свяжется с вами.',
        settings,
      ),
      sources: [],
      confidence: 0,
      engine: 'local',
      note: `Стоп-тема: «${stop}». Ответ по базе не формируется.`,
    };
  }

  const hits = search(index, q, 12);
  const best = hits[0];
  const confidence = best ? Math.round(best.coverage * 100) / 100 : 0;
  const escalate = matchList(q, settings.escalationKeywords);
  if (escalate) {
    return {
      kind: 'escalate',
      text: wrap(
        settings.tone === 'formal'
          ? 'Ваше обращение передано оператору. Ответ поступит в рабочее время.'
          : 'Понимаю, это важно. Передаю обращение живому оператору — он ответит как можно скорее.',
        settings,
      ),
      sources: [],
      confidence,
      engine: 'local',
      note: `Сработало правило эскалации: «${escalate}». Найденные статьи переданы оператору как черновик.`,
    };
  }

  if (!best || best.coverage < settings.threshold) {
    return {
      kind: 'insufficient',
      text: wrap(
        settings.tone === 'formal'
          ? 'В базе знаний нет достаточной информации для точного ответа на этот вопрос. Можно передать его оператору.'
          : 'Честно: в нашей базе знаний нет точного ответа на этот вопрос. Могу передать его оператору — он ответит лично.',
        settings,
      ),
      sources: best ? toRefs(topSources(hits, settings.maxSources)) : [],
      confidence,
      engine: 'local',
      note: best
        ? `Лучший фрагмент покрывает ${Math.round(best.coverage * 100)}% смысловых слов вопроса — ниже порога ${Math.round(settings.threshold * 100)}%.`
        : 'В базе не найдено ни одного совпадения по словам вопроса.',
    };
  }

  // Use sources that are reasonably close to the best one.
  const chosen = topSources(
    hits.filter((h) => h.coverage >= settings.threshold * 0.8 && h.score >= best.score * 0.7),
    settings.maxSources,
  );
  const blocks = chosen.map((h, i) => {
    const sents = bestSentences(h.chunk.text, h.matched, i === 0 ? 3 : 2);
    return chosen.length > 1 ? `${sents.join(' ')} [${i + 1}]` : sents.join(' ');
  });
  const body = `${INTRO[settings.tone]}\n\n${blocks.join('\n\n')}`;
  return {
    kind: 'answer',
    text: wrap(body, settings),
    sources: toRefs(chosen),
    confidence,
    engine: 'local',
    note: `Ответ собран из ${chosen.length} ${chosen.length === 1 ? 'статьи' : 'статей'} без перефразирования. Совпали слова: ${[...new Set(best.matched)].join(', ')}.`,
  };
}

export function toRefs(hits: Hit[]): SourceRef[] {
  return hits.map((h) => ({
    articleId: h.chunk.articleId,
    title: h.chunk.title,
    snippet: bestSentences(h.chunk.text, h.matched, 2).join(' '),
    score: Math.round(h.score * 100) / 100,
    coverage: Math.round(h.coverage * 100) / 100,
  }));
}

/** Instructions for the optional remote model: rephrase only from given sources. */
export function modelInstructions(s: SupportSettings): string {
  return [
    'Ты — оператор поддержки. Отвечай только на основе переданных фрагментов базы знаний.',
    'Если во фрагментах нет ответа, так и скажи и предложи передать вопрос оператору. Ничего не придумывай.',
    s.tone === 'formal' ? 'Тон: деловой, на «Вы».' : 'Тон: дружелюбный, на «вы», коротко.',
    s.greeting ? `Начни с приветствия: «${s.greeting}».` : '',
    s.signature ? `Закончи подписью: «${s.signature}».` : '',
    'Ответ — до 120 слов, на русском языке.',
  ]
    .filter(Boolean)
    .join('\n');
}
