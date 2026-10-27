import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Button, ErrorBox, Field, Loading, Notice, Seg, TextArea, useToast } from '../components/ui';
import { useWs, useWsApi } from '../session';
import type { Brand } from '../types';

type BrandInput = Omit<Brand, 'id' | 'isDemo'>;

const EMPTY: BrandInput = {
  name: '',
  description: '',
  product: '',
  audience: '',
  goals: [],
  tone: '',
  vocabulary: { preferred: [], avoid: [] },
  visual: { colors: { primary: '#c9f45f', accent: '#6cb4ff', background: '#0a0b0c', text: '#eef0ee' }, fonts: { display: 'Unbounded', body: 'Onest' }, style: 'Тёмный техно-минимализм: сетка, крупная типографика, интерфейсные элементы, без фотографий людей' },
  forbidden: [],
  examplesGood: [],
  examplesBad: [],
};

const FONTS = ['Unbounded', 'Onest', 'JetBrains Mono'];
const lines = (v: string[]) => v.join('\n');
const unlines = (v: string) => v.split('\n').map((x) => x.trim()).filter(Boolean);
const blocks = (v: string[]) => v.join('\n---\n');
const unblocks = (v: string) => v.split(/\n-{3,}\n/).map((x) => x.trim()).filter(Boolean);

export function BrandPage() {
  const { ws, can } = useWs();
  const u = useWsApi();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['brands', ws.id], queryFn: () => api.get<Brand[]>(u('/brands')) });
  const [selected, setSelected] = useState<string>('new');
  const [b, setB] = useState<BrandInput>(EMPTY);
  useEffect(() => {
    if (q.data?.length && selected === 'new' && b.name === '') setSelected(q.data[0]!.id);
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const found = q.data?.find((x) => x.id === selected);
    if (found) {
      const { id: _i, isDemo: _d, ...rest } = found;
      setB(rest as BrandInput);
    } else if (selected === 'new') setB(EMPTY);
  }, [selected, q.data]);
  const save = useMutation({
    mutationFn: () => {
      const body = { name: b.name, description: b.description, product: b.product, audience: b.audience, goals: b.goals, tone: b.tone, vocabulary: b.vocabulary, visual: b.visual, forbidden: b.forbidden, examplesGood: b.examplesGood, examplesBad: b.examplesBad };
      return selected === 'new' ? api.post<Brand>(u('/brands'), body) : api.put<Brand>(u(`/brands/${selected}`), body);
    },
    onSuccess: (r) => {
      toast.ok('Бренд сохранён');
      setSelected(r.id);
      qc.invalidateQueries({ queryKey: ['brands', ws.id] });
    },
  });
  if (q.isLoading) return <Loading />;
  const c = b.visual.colors;
  const setColor = (k: keyof typeof c, v: string) => setB({ ...b, visual: { ...b.visual, colors: { ...c, [k]: v } } });

  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <div className="page-head">
        <div>
          <h1>Brand Studio</h1>
          <p>Всё, что здесь записано, попадает в каждую генерацию и в проверку качества: запрещённые слова и темы блокируют согласование.</p>
        </div>
        <div className="row">
          {(q.data?.length ?? 0) > 0 && (
            <Seg value={selected} onChange={setSelected} options={[...(q.data ?? []).map((x) => ({ value: x.id, label: x.name })), ...(can('edit') ? [{ value: 'new', label: '+ Новый' }] : [])]} />
          )}
          {can('edit') && <Button variant="primary" type="submit" loading={save.isPending} disabled={!b.name.trim()}>Сохранить</Button>}
        </div>
      </div>
      <ErrorBox error={save.error} />
      <fieldset disabled={!can('edit')} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="split">
          <div className="stack">
            <div className="card card-pad stack">
              <h2>Позиционирование</h2>
              <Field label="Название"><input className="input" value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} required maxLength={80} /></Field>
              <Field label="Описание"><TextArea value={b.description} onChange={(v) => setB({ ...b, description: v })} rows={3} max={2000} /></Field>
              <Field label="Продукт" hint="Что именно продаём, ключевые функции, чем отличается"><TextArea value={b.product} onChange={(v) => setB({ ...b, product: v })} rows={4} max={2000} /></Field>
              <Field label="Целевая аудитория"><TextArea value={b.audience} onChange={(v) => setB({ ...b, audience: v })} rows={3} max={2000} /></Field>
              <Field label="Цели" hint="По одной в строке"><TextArea value={lines(b.goals)} onChange={(v) => setB({ ...b, goals: unlines(v) })} rows={3} /></Field>
            </div>
            <div className="card card-pad stack">
              <h2>Голос бренда</h2>
              <Field label="Тон коммуникации"><TextArea value={b.tone} onChange={(v) => setB({ ...b, tone: v })} rows={3} max={1000} /></Field>
              <div className="grid g2">
                <Field label="Предпочитаемые слова" hint="По одному в строке"><TextArea value={lines(b.vocabulary.preferred)} onChange={(v) => setB({ ...b, vocabulary: { ...b.vocabulary, preferred: unlines(v) } })} rows={5} /></Field>
                <Field label="Нежелательные слова" hint="Предупреждение при проверке"><TextArea value={lines(b.vocabulary.avoid)} onChange={(v) => setB({ ...b, vocabulary: { ...b.vocabulary, avoid: unlines(v) } })} rows={5} /></Field>
              </div>
              <Field label="Запрещённые темы и формулировки" hint="Блокируют согласование. По одной в строке."><TextArea value={lines(b.forbidden)} onChange={(v) => setB({ ...b, forbidden: unlines(v) })} rows={4} /></Field>
              <Field label="Удачные примеры" hint="Разделяйте примеры строкой ---"><TextArea value={blocks(b.examplesGood)} onChange={(v) => setB({ ...b, examplesGood: unblocks(v) })} rows={5} /></Field>
              <Field label="Неудачные примеры" hint="Чего избегать. Разделяйте строкой ---"><TextArea value={blocks(b.examplesBad)} onChange={(v) => setB({ ...b, examplesBad: unblocks(v) })} rows={4} /></Field>
            </div>
          </div>
          <div className="stack" style={{ position: 'sticky', top: 76 }}>
            <div className="card card-pad stack">
              <h2>Визуальная система</h2>
              <div className="grid g2">
                {(['primary', 'accent', 'background', 'text'] as const).map((k) => (
                  <Field key={k} label={{ primary: 'Основной', accent: 'Акцент', background: 'Фон', text: 'Текст' }[k]}>
                    <div className="color-input">
                      <input type="color" value={c[k]} onChange={(e) => setColor(k, e.target.value)} aria-label={k} />
                      <input className="input mono" value={c[k]} onChange={(e) => setColor(k, e.target.value)} pattern="#[0-9a-fA-F]{6}" />
                    </div>
                  </Field>
                ))}
              </div>
              <div className="grid g2">
                <Field label="Шрифт заголовков">
                  <select className="select" value={b.visual.fonts.display} onChange={(e) => setB({ ...b, visual: { ...b.visual, fonts: { ...b.visual.fonts, display: e.target.value } } })}>{FONTS.map((f) => <option key={f}>{f}</option>)}</select>
                </Field>
                <Field label="Шрифт текста">
                  <select className="select" value={b.visual.fonts.body} onChange={(e) => setB({ ...b, visual: { ...b.visual, fonts: { ...b.visual.fonts, body: e.target.value } } })}>{FONTS.map((f) => <option key={f}>{f}</option>)}</select>
                </Field>
              </div>
              <Field label="Визуальная концепция" hint="Используется при генерации фонов и подсказок по визуалу"><TextArea value={b.visual.style} onChange={(v) => setB({ ...b, visual: { ...b.visual, style: v } })} rows={3} max={600} /></Field>
            </div>
            <div className="card card-pad stack">
              <h3>Как это будет выглядеть</h3>
              <div style={{ aspectRatio: '4 / 5', borderRadius: 14, background: c.background, color: c.text, padding: 26, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', position: 'relative', overflow: 'hidden', border: '1px solid var(--line-2)' }}>
                <div style={{ position: 'absolute', inset: 0, backgroundImage: `linear-gradient(${c.text}10 1px, transparent 1px), linear-gradient(90deg, ${c.text}10 1px, transparent 1px)`, backgroundSize: '32px 32px' }} />
                <div style={{ position: 'relative', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '.1em', opacity: 0.7 }}>{(b.name || 'БРЕНД').toUpperCase()} · 01 / 05</div>
                <div style={{ position: 'relative' }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: c.accent, marginBottom: 10 }}>РУБРИКА</div>
                  <div style={{ fontFamily: 'var(--display)', fontWeight: 600, fontSize: 26, lineHeight: 1.1, letterSpacing: '-0.02em' }}>Заголовок слайда в стиле бренда</div>
                  <div style={{ marginTop: 12, fontSize: 14, opacity: 0.8 }}>Короткое пояснение к мысли слайда.</div>
                  <div style={{ marginTop: 18, display: 'inline-block', background: c.primary, color: c.background, padding: '8px 14px', borderRadius: 10, fontWeight: 600, fontSize: 13 }}>Призыв к действию</div>
                </div>
              </div>
              <p className="tiny dim">Схематичный предпросмотр. Настоящие слайды и видео рендерятся движком Remotion с этими цветами и шрифтами.</p>
            </div>
            {b.examplesGood.length === 0 && <Notice tone="info">Добавьте 2–3 удачных примера текстов — модель лучше попадает в голос бренда.</Notice>}
          </div>
        </div>
      </fieldset>
    </form>
  );
}
