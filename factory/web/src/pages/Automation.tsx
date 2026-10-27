import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, ApiError } from '../api';
import { Badge, Button, Empty, ErrorBox, Field, fmtDate, Loading, Modal, Notice, PlatformChip, Toggles, useToast } from '../components/ui';
import { PLATFORM_IDS, PLATFORMS } from '../../../shared/platforms';
import { CONTENT_KINDS, KIND_LABEL } from '../../../shared/types';
import { useWs, useWsApi } from '../session';
import type { Brand, Rule, RuleConfig } from '../types';

const WEEK = [1, 2, 3, 4, 5, 6, 0];
const WEEK_LABEL: Record<number, string> = { 1: 'Пн', 2: 'Вт', 3: 'Ср', 4: 'Чт', 5: 'Пт', 6: 'Сб', 0: 'Вс' };

export function AutomationPage() {
  const { ws, base, can } = useWs();
  const u = useWsApi();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['rules', ws.id], queryFn: () => api.get<{ rules: Rule[]; defaults: RuleConfig }>(u('/rules')), refetchInterval: 15_000 });
  const brands = useQuery({ queryKey: ['brands', ws.id], queryFn: () => api.get<Brand[]>(u('/brands')) });
  const [edit, setEdit] = useState<Partial<Rule> | null>(null);
  const run = useMutation({ mutationFn: (id: string) => api.post<{ id: string }>(u(`/rules/${id}/run`)), onSuccess: () => { toast.ok('Запуск выполнен: создана кампания'); qc.invalidateQueries({ queryKey: ['rules'] }); }, onError: toast.err });
  if (q.isLoading || !q.data) return <Loading />;
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Автоматизация</h1>
          <p>Правила создают материалы по расписанию, отправляют их на согласование и ставят в свободные слоты. У каждого правила есть дневные лимиты, остановка после ошибок подряд и подтверждение для рискованных настроек.</p>
        </div>
        {can('admin') && brands.data?.length ? <Button variant="primary" icon="plus" onClick={() => setEdit({ name: 'Регулярные публикации', enabled: false, brandId: brands.data[0]!.id, config: q.data.defaults })}>Новое правило</Button> : null}
      </div>
      {!brands.data?.length && <Notice tone="warn">Сначала создайте бренд в <Link to={`${base}/brand`} style={{ color: 'var(--lime)' }}>Brand Studio</Link>.</Notice>}
      {q.data.rules.length === 0 ? (
        <div className="card"><Empty title="Правил нет">Правило — это «что, когда, сколько и через кого». По умолчанию всё проходит согласование человеком.</Empty></div>
      ) : (
        <div className="grid g2">
          {q.data.rules.map((r) => (
            <div key={r.id} className="card">
              <div className="card-head">
                <h2>{r.name}</h2>
                <Badge tone={r.status === 'paused' ? 'err' : r.enabled ? 'ok' : undefined} dot>{r.status === 'paused' ? 'остановлено' : r.enabled ? 'включено' : 'выключено'}</Badge>
              </div>
              <div className="card-body stack">
                {r.pausedReason && <Notice tone="err">{r.pausedReason}</Notice>}
                <dl className="kv small">
                  <dt>Расписание</dt><dd>{r.config.schedule.weekdays.map((d) => WEEK_LABEL[d]).join(', ')} в {r.config.schedule.time} ({r.config.schedule.timezone})</dd>
                  <dt>За запуск</dt><dd>{r.config.generate.itemsPerRun} × {r.config.generate.formats.map((f) => KIND_LABEL[f]).join(', ')}</dd>
                  <dt>Площадки</dt><dd><div className="row tight">{r.config.generate.platforms.map((p) => <PlatformChip key={p} id={p} label={false} />)}</div></dd>
                  <dt>Согласование</dt><dd>{r.config.approval.required ? 'обязательно' : <span style={{ color: 'var(--amber)' }}>не требуется (только проверка качества)</span>}</dd>
                  <dt>Публикация</dt><dd>{r.config.publish.mode === 'draft_only' ? 'только черновики' : `после согласования в слоты ${r.config.publish.slots.join(', ')}, интервал ≥ ${r.config.publish.minGapMinutes} мин`}</dd>
                  <dt>Лимиты</dt><dd>{r.config.limits.maxRunsPerDay} запуск/день · ≤ {r.config.limits.maxItemsPerDay} материалов/день · стоп после {r.config.limits.pauseAfterFailures} ошибок</dd>
                  <dt>Следующий запуск</dt><dd>{r.enabled ? fmtDate(r.nextRunAt, r.config.schedule.timezone) : '—'}</dd>
                  <dt>Запусков всего</dt><dd>{r.runs} · сегодня {r.runsToday}</dd>
                </dl>
                {can('admin') && (
                  <div className="row">
                    <Button size="sm" icon="edit" onClick={() => setEdit(r)}>Изменить</Button>
                    <Button size="sm" icon="play" onClick={() => run.mutate(r.id)} loading={run.isPending}>Запустить сейчас</Button>
                    <Button size="sm" variant="danger" icon="trash" onClick={() => confirm('Удалить правило?') && api.del(u(`/rules/${r.id}`)).then(() => qc.invalidateQueries({ queryKey: ['rules'] }))} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {edit && <RuleEditor rule={edit} brands={brands.data ?? []} onClose={() => setEdit(null)} />}
    </div>
  );
}

function RuleEditor({ rule, brands, onClose }: { rule: Partial<Rule>; brands: Brand[]; onClose: () => void }) {
  const u = useWsApi();
  const qc = useQueryClient();
  const toast = useToast();
  const [r, setR] = useState({ name: rule.name ?? '', brandId: rule.brandId ?? brands[0]?.id ?? '', enabled: rule.enabled ?? false, config: rule.config! });
  const [confirmText, setConfirmText] = useState<string | null>(null);
  const c = r.config;
  const set = <K extends keyof RuleConfig>(k: K, v: Partial<RuleConfig[K]>) => setR({ ...r, config: { ...c, [k]: { ...c[k], ...v } } });
  const save = useMutation({
    mutationFn: (confirmed: boolean) => (rule.id ? api.put(u(`/rules/${rule.id}`), { ...r, confirmed }) : api.post(u('/rules'), { ...r, confirmed })),
    onSuccess: () => { toast.ok('Правило сохранено'); qc.invalidateQueries({ queryKey: ['rules'] }); onClose(); },
    onError: (e) => (e instanceof ApiError && e.code === 'confirm_required' ? setConfirmText(e.message) : undefined),
  });
  return (
    <Modal open onClose={onClose} title={rule.id ? 'Правило' : 'Новое правило'} wide footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(false)}>Сохранить</Button></>}>
      <div className="stack">
        <div className="grid g3">
          <Field label="Название"><input className="input" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} /></Field>
          <Field label="Бренд"><select className="select" value={r.brandId} onChange={(e) => setR({ ...r, brandId: e.target.value })}>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label="Состояние"><label className="check" style={{ height: 38 }}><input type="checkbox" checked={r.enabled} onChange={(e) => setR({ ...r, enabled: e.target.checked })} /> Включено</label></Field>
        </div>
        <h3>Когда</h3>
        <div className="grid g3">
          <Field label="Дни"><Toggles options={WEEK.map(String)} value={c.schedule.weekdays.map(String)} onChange={(v) => set('schedule', { weekdays: v.map(Number) })} render={(d) => WEEK_LABEL[Number(d)]} /></Field>
          <Field label="Время запуска"><input className="input" type="time" value={c.schedule.time} onChange={(e) => set('schedule', { time: e.target.value })} /></Field>
          <Field label="Часовой пояс"><input className="input" value={c.schedule.timezone} onChange={(e) => set('schedule', { timezone: e.target.value })} /></Field>
        </div>
        <h3>Что создавать</h3>
        <div className="grid g2">
          <Field label="Материалов за запуск"><input className="input" type="number" min={1} max={20} value={c.generate.itemsPerRun} onChange={(e) => set('generate', { itemsPerRun: Number(e.target.value) })} /></Field>
          <Field label="Тема / направление"><input className="input" value={c.generate.topicHint} onChange={(e) => set('generate', { topicHint: e.target.value })} placeholder="Советы по юнит-экономике" /></Field>
        </div>
        <Field label="Форматы"><Toggles options={CONTENT_KINDS.filter((k) => k !== 'video')} value={c.generate.formats} onChange={(v) => set('generate', { formats: v })} render={(k) => KIND_LABEL[k]} /></Field>
        <Field label="Площадки"><Toggles options={PLATFORM_IDS} value={c.generate.platforms} onChange={(v) => set('generate', { platforms: v })} render={(p) => PLATFORMS[p].name} /></Field>
        <h3>Согласование и публикация</h3>
        <div className="grid g2">
          <label className="check"><input type="checkbox" checked={c.approval.required} onChange={(e) => set('approval', { required: e.target.checked })} /> Требовать согласование человеком</label>
          <Field label="Режим">
            <select className="select" value={c.publish.mode} onChange={(e) => set('publish', { mode: e.target.value as RuleConfig['publish']['mode'] })}>
              <option value="schedule_after_approval">Планировать после согласования</option>
              <option value="draft_only">Только создавать черновики</option>
            </select>
          </Field>
          <Field label="Слоты публикации" hint="Через запятую, ЧЧ:ММ"><input className="input" value={c.publish.slots.join(', ')} onChange={(e) => set('publish', { slots: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></Field>
          <Field label="Минимальный интервал, мин"><input className="input" type="number" min={15} value={c.publish.minGapMinutes} onChange={(e) => set('publish', { minGapMinutes: Number(e.target.value) })} /></Field>
        </div>
        <h3>Ограничения безопасности</h3>
        <div className="grid g4">
          <Field label="Запусков в день"><input className="input" type="number" min={1} max={4} value={c.limits.maxRunsPerDay} onChange={(e) => set('limits', { maxRunsPerDay: Number(e.target.value) })} /></Field>
          <Field label="Материалов в день"><input className="input" type="number" min={1} max={40} value={c.limits.maxItemsPerDay} onChange={(e) => set('limits', { maxItemsPerDay: Number(e.target.value) })} /></Field>
          <Field label="Стоп после ошибок"><input className="input" type="number" min={1} max={10} value={c.limits.pauseAfterFailures} onChange={(e) => set('limits', { pauseAfterFailures: Number(e.target.value) })} /></Field>
          <Field label="Подтверждать, если больше"><input className="input" type="number" min={1} max={40} value={c.limits.requireConfirmAbove} onChange={(e) => set('limits', { requireConfirmAbove: Number(e.target.value) })} /></Field>
        </div>
        <Notice tone="info">Для каждой площадки берётся последний подключённый аккаунт. Публикация всегда идёт через ту же очередь с идемпотентностью и проверками, что и ручная.</Notice>
        <ErrorBox error={save.error instanceof ApiError && save.error.code === 'confirm_required' ? null : save.error} />
      </div>
      <Modal open={!!confirmText} onClose={() => setConfirmText(null)} title="Подтвердите включение" footer={<><Button onClick={() => setConfirmText(null)}>Отмена</Button><Button variant="primary" onClick={() => { setConfirmText(null); save.mutate(true); }}>Включить</Button></>}>
        <Notice tone="warn">{confirmText}</Notice>
      </Modal>
    </Modal>
  );
}
