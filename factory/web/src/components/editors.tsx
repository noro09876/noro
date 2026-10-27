import { useState } from 'react';
import type { CarouselData, GraphicData, PostData, Scene, SceneKind, Slide, SlideVisual, VideoScriptData } from '../../../shared/types';
import type { ContentKind } from '../types';
import { Button, Field, Modal, TextArea } from './ui';

/**
 * Structured editors for every content kind. Each element can be regenerated on its own
 * (slide, scene or field) via `onRegenerate(target, instruction)` — the rest stays untouched.
 */

type Regen = (target: string, label: string) => void;

const tags = (v: string[]) => v.join(' ');
const untags = (v: string) => v.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

function RegenBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button type="button" size="xs" variant="ghost" icon="sparkle" onClick={onClick} title={`Переписать с ИИ: ${label}`}>
      ИИ
    </Button>
  );
}

function Labeled({ label, regen, children }: { label: string; regen?: () => void; children: React.ReactNode }) {
  return (
    <div className="field">
      <div className="row between">
        <span className="small muted">{label}</span>
        {regen && <RegenBtn onClick={regen} label={label} />}
      </div>
      {children}
    </div>
  );
}

export function VisualEditor({ value, onChange }: { value?: SlideVisual; onChange: (v?: SlideVisual) => void }) {
  const type = value?.type ?? 'none';
  const make = (t: string): SlideVisual | undefined => {
    switch (t) {
      case 'stat':
        return { type: 'stat', value: '0', label: 'Показатель' };
      case 'steps':
        return { type: 'steps', items: ['Шаг 1', 'Шаг 2', 'Шаг 3'] };
      case 'chart':
        return { type: 'chart', points: [3, 5, 4, 7, 9], label: 'Динамика' };
      case 'ui':
        return { type: 'ui', title: 'Дашборд', rows: [{ label: 'Метрика', value: '42' }, { label: 'Метрика', value: '17' }] };
      case 'quote':
        return { type: 'quote', text: 'Цитата', author: 'Автор' };
      default:
        return undefined;
    }
  };
  return (
    <div className="col" style={{ gap: 8, padding: 10, border: '1px dashed var(--line-2)', borderRadius: 10 }}>
      <div className="row between">
        <span className="small muted">Визуальный блок</span>
        <select className="select" style={{ width: 170, height: 30 }} value={type} onChange={(e) => onChange(make(e.target.value))}>
          <option value="none">нет</option>
          <option value="stat">цифра</option>
          <option value="steps">шаги</option>
          <option value="chart">график</option>
          <option value="ui">интерфейс</option>
          <option value="quote">цитата</option>
        </select>
      </div>
      {value?.type === 'stat' && (
        <div className="grid g2">
          <input className="input" value={value.value} maxLength={16} onChange={(e) => onChange({ ...value, value: e.target.value })} aria-label="Значение" />
          <input className="input" value={value.label} maxLength={80} onChange={(e) => onChange({ ...value, label: e.target.value })} aria-label="Подпись" />
        </div>
      )}
      {value?.type === 'steps' && <TextArea rows={3} value={value.items.join('\n')} onChange={(v) => onChange({ ...value, items: v.split('\n').filter(Boolean).slice(0, 5) })} />}
      {value?.type === 'chart' && (
        <div className="grid g2">
          <input className="input" value={value.points.join(', ')} onChange={(e) => onChange({ ...value, points: e.target.value.split(',').map((x) => Number(x.trim())).filter((x) => !Number.isNaN(x)) })} aria-label="Точки" />
          <input className="input" value={value.label} onChange={(e) => onChange({ ...value, label: e.target.value })} aria-label="Подпись" />
        </div>
      )}
      {value?.type === 'ui' && (
        <>
          <input className="input" value={value.title} onChange={(e) => onChange({ ...value, title: e.target.value })} aria-label="Заголовок окна" />
          <TextArea
            rows={4}
            value={value.rows.map((r) => `${r.label} = ${r.value}${r.tone ? ` | ${r.tone}` : ''}`).join('\n')}
            onChange={(v) =>
              onChange({
                ...value,
                rows: v
                  .split('\n')
                  .filter((l) => l.includes('='))
                  .slice(0, 5)
                  .map((l) => {
                    const [lv, tone] = l.split('|').map((x) => x.trim());
                    const [label, val] = lv!.split('=').map((x) => x.trim());
                    return { label: label ?? '', value: val ?? '', ...(tone === 'good' || tone === 'warn' || tone === 'bad' ? { tone } : {}) };
                  }),
              })
            }
          />
          <span className="tiny dim">Строка: «Название = значение | good/warn/bad»</span>
        </>
      )}
      {value?.type === 'quote' && (
        <>
          <TextArea rows={2} value={value.text} onChange={(v) => onChange({ ...value, text: v })} max={200} />
          <input className="input" value={value.author} onChange={(e) => onChange({ ...value, author: e.target.value })} aria-label="Автор" />
        </>
      )}
    </div>
  );
}

export function PostEditor({ data, onChange, regen }: { data: PostData; onChange: (d: PostData) => void; regen?: Regen }) {
  return (
    <div className="stack">
      <Labeled label="Заголовок" regen={regen && (() => regen('field:headline', 'заголовок'))}>
        <input className="input" value={data.headline} maxLength={140} onChange={(e) => onChange({ ...data, headline: e.target.value })} />
      </Labeled>
      <Labeled label="Текст" regen={regen && (() => regen('field:body', 'текст'))}>
        <TextArea rows={9} value={data.body} onChange={(v) => onChange({ ...data, body: v })} max={6000} />
      </Labeled>
      <Labeled label="Призыв к действию" regen={regen && (() => regen('field:cta', 'призыв'))}>
        <input className="input" value={data.cta} maxLength={240} onChange={(e) => onChange({ ...data, cta: e.target.value })} />
      </Labeled>
      <Field label="Хэштеги" hint="Через пробел">
        <input className="input" value={tags(data.hashtags)} onChange={(e) => onChange({ ...data, hashtags: untags(e.target.value) })} />
      </Field>
    </div>
  );
}

function SlideEditor({ slide, index, onChange, regen, onRemove, onMove, count }: { slide: Slide; index: number; count: number; onChange: (s: Slide) => void; regen?: Regen; onRemove: () => void; onMove: (d: -1 | 1) => void }) {
  return (
    <div className="scene-card">
      <div className="row between">
        <b className="mono small">Слайд {index + 1}</b>
        <div className="row tight">
          {regen && <RegenBtn onClick={() => regen(`slide:${index}`, `слайд ${index + 1}`)} label={`слайд ${index + 1}`} />}
          <Button type="button" size="xs" variant="ghost" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Выше">↑</Button>
          <Button type="button" size="xs" variant="ghost" onClick={() => onMove(1)} disabled={index === count - 1} aria-label="Ниже">↓</Button>
          <Button type="button" size="xs" variant="ghost" icon="trash" onClick={onRemove} disabled={count <= 3} aria-label="Удалить слайд" />
        </div>
      </div>
      <input className="input" placeholder="Надзаголовок" value={slide.kicker ?? ''} maxLength={40} onChange={(e) => onChange({ ...slide, kicker: e.target.value || undefined })} />
      <input className="input" placeholder="Заголовок" value={slide.title} maxLength={90} onChange={(e) => onChange({ ...slide, title: e.target.value })} />
      <TextArea rows={3} value={slide.body} onChange={(v) => onChange({ ...slide, body: v })} max={320} />
      <VisualEditor value={slide.visual} onChange={(v) => onChange({ ...slide, visual: v })} />
    </div>
  );
}

export function CarouselEditor({ data, onChange, regen }: { data: CarouselData; onChange: (d: CarouselData) => void; regen?: Regen }) {
  const setSlide = (i: number, s: Slide) => onChange({ ...data, slides: data.slides.map((x, j) => (j === i ? s : x)) });
  const move = (i: number, d: -1 | 1) => {
    const s = [...data.slides];
    [s[i], s[i + d]] = [s[i + d]!, s[i]!];
    onChange({ ...data, slides: s });
  };
  return (
    <div className="stack">
      <Labeled label="Название карусели" regen={regen && (() => regen('field:title', 'название'))}>
        <input className="input" value={data.title} maxLength={120} onChange={(e) => onChange({ ...data, title: e.target.value })} />
      </Labeled>
      <Labeled label="Подпись к публикации" regen={regen && (() => regen('field:caption', 'подпись'))}>
        <TextArea rows={5} value={data.caption} onChange={(v) => onChange({ ...data, caption: v })} max={2200} />
      </Labeled>
      <Field label="Хэштеги">
        <input className="input" value={tags(data.hashtags)} onChange={(e) => onChange({ ...data, hashtags: untags(e.target.value) })} />
      </Field>
      {data.slides.map((s, i) => (
        <SlideEditor key={i} slide={s} index={i} count={data.slides.length} onChange={(x) => setSlide(i, x)} regen={regen} onRemove={() => onChange({ ...data, slides: data.slides.filter((_, j) => j !== i) })} onMove={(d) => move(i, d)} />
      ))}
      {data.slides.length < 10 && (
        <Button type="button" size="sm" icon="plus" onClick={() => onChange({ ...data, slides: [...data.slides, { title: 'Новый слайд', body: '' }] })}>
          Слайд
        </Button>
      )}
    </div>
  );
}

export function GraphicEditor({ data, onChange, regen }: { data: GraphicData; onChange: (d: GraphicData) => void; regen?: Regen }) {
  return (
    <div className="stack">
      <Labeled label="Заголовок на графике" regen={regen && (() => regen('field:headline', 'заголовок'))}>
        <input className="input" value={data.headline} maxLength={90} onChange={(e) => onChange({ ...data, headline: e.target.value })} />
      </Labeled>
      <Labeled label="Подзаголовок" regen={regen && (() => regen('field:subline', 'подзаголовок'))}>
        <input className="input" value={data.subline} maxLength={160} onChange={(e) => onChange({ ...data, subline: e.target.value })} />
      </Labeled>
      <VisualEditor value={data.visual} onChange={(v) => v && onChange({ ...data, visual: v })} />
      <Labeled label="Подпись к публикации" regen={regen && (() => regen('field:caption', 'подпись'))}>
        <TextArea rows={5} value={data.caption} onChange={(v) => onChange({ ...data, caption: v })} max={2200} />
      </Labeled>
      <Field label="Промпт фонового изображения" hint="Используется, только если подключён провайдер изображений. Без людей и текста.">
        <TextArea rows={2} value={data.imagePrompt ?? ''} onChange={(v) => onChange({ ...data, imagePrompt: v || undefined })} max={600} />
      </Field>
    </div>
  );
}

const SCENE_KINDS: { v: SceneKind; l: string }[] = [
  { v: 'hook', l: 'Хук' },
  { v: 'problem', l: 'Проблема' },
  { v: 'ui', l: 'Интерфейс' },
  { v: 'feature', l: 'Функция' },
  { v: 'chart', l: 'График' },
  { v: 'stat', l: 'Цифра' },
  { v: 'steps', l: 'Шаги' },
  { v: 'cta', l: 'Призыв' },
];

export function SceneEditor({ scene, index, count, onChange, regen, onRemove, active, onFocus }: { scene: Scene; index: number; count: number; onChange: (s: Scene) => void; regen?: Regen; onRemove: () => void; active?: boolean; onFocus?: () => void }) {
  return (
    <div className={`scene-card ${active ? 'on' : ''}`} onFocusCapture={onFocus}>
      <div className="row between">
        <div className="row tight">
          <b className="mono small">Сцена {index + 1}</b>
          <select className="select" style={{ width: 130, height: 28 }} value={scene.kind} onChange={(e) => onChange({ ...scene, kind: e.target.value as SceneKind })}>
            {SCENE_KINDS.map((k) => <option key={k.v} value={k.v}>{k.l}</option>)}
          </select>
          <select className="select" style={{ width: 110, height: 28 }} value={scene.transition ?? 'slide'} onChange={(e) => onChange({ ...scene, transition: e.target.value as Scene['transition'] })} aria-label="Переход">
            <option value="slide">сдвиг</option>
            <option value="fade">растворение</option>
            <option value="wipe">шторка</option>
            <option value="zoom">зум</option>
          </select>
        </div>
        <div className="row tight">
          {regen && <RegenBtn onClick={() => regen(`scene:${index}`, `сцену ${index + 1}`)} label={`сцена ${index + 1}`} />}
          <Button type="button" size="xs" variant="ghost" icon="trash" onClick={onRemove} disabled={count <= 3} aria-label="Удалить сцену" />
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: '1fr 110px', gap: 8 }}>
        <input className="input" placeholder="Текст на экране" value={scene.title} maxLength={70} onChange={(e) => onChange({ ...scene, title: e.target.value })} />
        <input className="input" type="number" min={1.5} max={15} step={0.5} value={scene.durationSec} onChange={(e) => onChange({ ...scene, durationSec: Number(e.target.value) })} aria-label="Длительность, с" title="Минимальная длительность, с. Итоговая подстраивается под озвучку." />
      </div>
      <input className="input" placeholder="Дополнительная строка" value={scene.text ?? ''} maxLength={140} onChange={(e) => onChange({ ...scene, text: e.target.value || undefined })} />
      <div className="field">
        <span className="small muted">Голос за кадром (он же субтитры)</span>
        <TextArea rows={2} value={scene.voiceover} onChange={(v) => onChange({ ...scene, voiceover: v })} max={400} />
      </div>
      <VisualEditor value={scene.visual} onChange={(v) => onChange({ ...scene, visual: v })} />
    </div>
  );
}

export function ScriptEditor({ data, onChange, regen, aspect, onAspect }: { data: VideoScriptData; onChange: (d: VideoScriptData) => void; regen?: Regen; aspect?: string; onAspect?: (a: '9:16' | '1:1' | '16:9') => void }) {
  const [active, setActive] = useState(0);
  const total = data.scenes.reduce((a, s) => a + s.durationSec, 0);
  return (
    <div className="stack">
      <Labeled label="Название ролика" regen={regen && (() => regen('field:title', 'название'))}>
        <input className="input" value={data.title} maxLength={100} onChange={(e) => onChange({ ...data, title: e.target.value })} />
      </Labeled>
      <Labeled label="Хук (первые 2 секунды)" regen={regen && (() => regen('field:hook', 'хук'))}>
        <input className="input" value={data.hook} maxLength={140} onChange={(e) => onChange({ ...data, hook: e.target.value })} />
      </Labeled>
      {onAspect && (
        <Field label="Формат кадра">
          <select className="select" value={aspect ?? '9:16'} onChange={(e) => onAspect(e.target.value as '9:16')}>
            <option value="9:16">9:16 — вертикальный (Reels, Shorts, TikTok)</option>
            <option value="1:1">1:1 — квадрат</option>
            <option value="16:9">16:9 — горизонтальный</option>
          </select>
        </Field>
      )}
      <div>
        <div className="row between" style={{ marginBottom: 6 }}>
          <span className="small muted">Раскадровка · ≈{total.toFixed(1)} с до озвучки</span>
        </div>
        <div className="timeline">
          {data.scenes.map((s, i) => (
            <div key={s.id} className={i === active ? 'on' : ''} style={{ flex: s.durationSec }} onClick={() => setActive(i)} role="button" tabIndex={0}>
              <span className="k">{s.kind}</span>
              <span className="ellipsis">{s.title}</span>
            </div>
          ))}
        </div>
      </div>
      {data.scenes.map((s, i) => (
        <SceneEditor
          key={s.id}
          scene={s}
          index={i}
          count={data.scenes.length}
          active={i === active}
          onFocus={() => setActive(i)}
          regen={regen}
          onChange={(x) => onChange({ ...data, scenes: data.scenes.map((y, j) => (j === i ? x : y)) })}
          onRemove={() => onChange({ ...data, scenes: data.scenes.filter((_, j) => j !== i) })}
        />
      ))}
      {data.scenes.length < 10 && (
        <Button type="button" size="sm" icon="plus" onClick={() => onChange({ ...data, scenes: [...data.scenes, { id: `s${Date.now().toString(36)}`, kind: 'feature', title: 'Новая сцена', voiceover: 'Текст озвучки', durationSec: 3, transition: 'slide' }] })}>
          Сцена
        </Button>
      )}
      <Labeled label="Подпись к публикации" regen={regen && (() => regen('field:caption', 'подпись'))}>
        <TextArea rows={4} value={data.caption} onChange={(v) => onChange({ ...data, caption: v })} max={2200} />
      </Labeled>
      <Field label="Хэштеги">
        <input className="input" value={tags(data.hashtags)} onChange={(e) => onChange({ ...data, hashtags: untags(e.target.value) })} />
      </Field>
    </div>
  );
}

export function ContentEditor({ kind, data, onChange, regen }: { kind: ContentKind; data: Record<string, unknown>; onChange: (d: Record<string, unknown>) => void; regen?: Regen }) {
  const set = (d: unknown) => onChange(d as Record<string, unknown>);
  switch (kind) {
    case 'post':
      return <PostEditor data={data as unknown as PostData} onChange={set} regen={regen} />;
    case 'carousel':
      return <CarouselEditor data={data as unknown as CarouselData} onChange={set} regen={regen} />;
    case 'graphic':
      return <GraphicEditor data={data as unknown as GraphicData} onChange={set} regen={regen} />;
    case 'video':
      return <ScriptEditor data={data as unknown as VideoScriptData} onChange={set} regen={regen} aspect={data.aspect as string} onAspect={(a) => onChange({ ...data, aspect: a })} />;
    default:
      return <ScriptEditor data={data as unknown as VideoScriptData} onChange={set} regen={regen} />;
  }
}

/** Asks what to change before a targeted AI rewrite. */
export function RegenDialog({ target, label, onClose, onSubmit, busy }: { target: string | null; label: string; onClose: () => void; onSubmit: (instruction: string) => void; busy?: boolean }) {
  const [text, setText] = useState('');
  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title={`Переписать: ${label}`}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" loading={busy} disabled={!text.trim()} onClick={() => onSubmit(text)}>
            Переписать
          </Button>
        </>
      }
    >
      <Field label="Что изменить?" hint="Остальная часть материала не изменится. Результат станет новой версией.">
        <TextArea rows={3} value={text} onChange={setText} placeholder="Короче и с конкретной цифрой" autoFocus />
      </Field>
    </Modal>
  );
}
