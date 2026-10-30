import { useEffect, useState } from 'react';
import { get, post, put } from '../api';
import type { Brand, Settings } from '../types';
import { Alert, ErrorBox, fmtDateTime, Icon, Loading, Switch, tz, useLoad, useToast } from '../ui';

interface SettingsData { settings: Settings; aiKeySet: boolean; publicBaseUrl: string | null; dataDir: string; masterKeyFromEnv: boolean; backups: { name: string; bytes: number; createdAt: string }[] }
type Tab = 'models' | 'images' | 'schedule' | 'brand' | 'backup' | 'security';
const TABS: [Tab, string][] = [['models', 'Модели'], ['images', 'Изображения'], ['schedule', 'Расписание и лимиты'], ['brand', 'Бренд'], ['backup', 'Резервные копии'], ['security', 'Безопасность']];

export function SettingsPage() {
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => get<SettingsData>('/api/settings'));
  const [form, setForm] = useState<Settings | null>(null);
  const [tab, setTab] = useState<Tab>('models');
  useEffect(() => {
    if (data) setForm(data.settings);
  }, [data]);

  if (loading && !data) return <div className="page"><Loading /></div>;
  if (error || !data || !form) return <div className="page"><ErrorBox error={error ?? ''} retry={reload} /></div>;

  const save = async (section: keyof Settings) => {
    try {
      const next = await put<Settings>('/api/settings', { [section]: form[section] });
      setForm(next);
      if (section === 'schedule') tz.current = next.schedule.timezone;
      toast('success', 'Настройки сохранены');
      await reload();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  const dirty = (section: keyof Settings) => JSON.stringify(form[section]) !== JSON.stringify(data.settings[section]);
  const SaveBar = ({ section }: { section: keyof Settings }) => (
    <div className="row end"><button className="btn btn-primary" disabled={!dirty(section)} onClick={() => save(section)}>Сохранить</button></div>
  );

  return (
    <div className="page">
      <div className="tabs" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>

      {tab === 'models' && <ModelSettings form={form} setForm={setForm} data={data} SaveBar={SaveBar} reload={reload} />}

      {tab === 'images' && (
        <section className="card"><div className="card-body stack">
          <p className="muted" style={{ margin: 0 }}>Изображения создаются программно на этом компьютере: шаблон NORO, шрифт Inter, проверка, что текст помещается. Платные генераторы картинок не используются.</p>
          <div className="grid grid-2">
            <label className="field"><span>Размер</span>
              <select className="select" value={form.images.size} onChange={(e) => setForm({ ...form, images: { ...form.images, size: e.target.value as Settings['images']['size'] } })}>
                <option value="1080x1350">1080×1350 (4:5) — Instagram, Telegram, ВК</option>
                <option value="1080x1080">1080×1080 (1:1)</option>
              </select>
            </label>
            <label className="field"><span>Максимум слайдов</span><input className="input" type="number" min={3} max={10} value={form.images.maxSlides} onChange={(e) => setForm({ ...form, images: { ...form.images, maxSlides: Number(e.target.value) } })} /></label>
            <label className="field"><span>Качество JPEG</span><input className="input" type="number" min={60} max={100} value={form.images.jpegQuality} onChange={(e) => setForm({ ...form, images: { ...form.images, jpegQuality: Number(e.target.value) } })} /></label>
            <div className="field"><span>Счётчик слайдов</span><Switch checked={form.images.showCounter} onChange={(v) => setForm({ ...form, images: { ...form.images, showCounter: v } })} label="Показывать «02 / 07»" /></div>
          </div>
          <SaveBar section="images" />
        </div></section>
      )}

      {tab === 'schedule' && (
        <>
          <section className="card"><div className="card-head"><h3>Часовой пояс</h3></div><div className="card-body stack">
            <label className="field"><span>Все времена в интерфейсе и расписании</span><input className="input" value={form.schedule.timezone} onChange={(e) => setForm({ ...form, schedule: { timezone: e.target.value } })} placeholder="Europe/Moscow" /><small>Формат IANA: Europe/Moscow, Asia/Yekaterinburg, Europe/Berlin…</small></label>
            <SaveBar section="schedule" />
          </div></section>
          <section className="card"><div className="card-head"><h3>Лимиты публикаций</h3></div><div className="card-body stack">
            <div className="grid grid-3">
              <label className="field"><span>Публикаций в день на аккаунт</span><input className="input" type="number" min={1} max={50} value={form.limits.maxPostsPerDayPerAccount} onChange={(e) => setForm({ ...form, limits: { ...form.limits, maxPostsPerDayPerAccount: Number(e.target.value) } })} /></label>
              <label className="field"><span>Попыток при временных ошибках</span><input className="input" type="number" min={1} max={8} value={form.limits.maxPublishAttempts} onChange={(e) => setForm({ ...form, limits: { ...form.limits, maxPublishAttempts: Number(e.target.value) } })} /><small>Паузы растут: 1, 5, 15, 60 мин…</small></label>
              <label className="field"><span>Окно проверки повторов, дней</span><input className="input" type="number" min={1} max={365} value={form.limits.duplicateWindowDays} onChange={(e) => setForm({ ...form, limits: { ...form.limits, duplicateWindowDays: Number(e.target.value) } })} /></label>
            </div>
            <SaveBar section="limits" />
          </div></section>
        </>
      )}

      {tab === 'brand' && <BrandSettings />}

      {tab === 'backup' && (
        <section className="card"><div className="card-body stack">
          <Switch checked={form.backup.enabled} onChange={(v) => setForm({ ...form, backup: { ...form.backup, enabled: v } })} label="Ежедневная резервная копия базы" />
          <div className="grid grid-2">
            <label className="field"><span>Час создания (по часовому поясу)</span><input className="input" type="number" min={0} max={23} value={form.backup.hourLocal} onChange={(e) => setForm({ ...form, backup: { ...form.backup, hourLocal: Number(e.target.value) } })} /></label>
            <label className="field"><span>Хранить копий</span><input className="input" type="number" min={1} max={90} value={form.backup.keep} onChange={(e) => setForm({ ...form, backup: { ...form.backup, keep: Number(e.target.value) } })} /></label>
          </div>
          <SaveBar section="backup" />
          <Alert kind="info">Копия содержит базу (материалы, расписание, журнал, зашифрованные токены). Ключ шифрования <span className="mono">master.key</span> в копию не входит — храните его отдельно, иначе после восстановления аккаунты придётся подключить заново. Изображения пересоздаются кнопкой «Пересобрать».</Alert>
          <div className="row"><button className="btn" onClick={async () => { await post('/api/backups'); toast('success', 'Копия создана'); await reload(); }}><Icon name="archive" />Создать копию сейчас</button></div>
          <div className="list">
            {data.backups.map((b) => (
              <div key={b.name} className="list-item"><span className="mono grow ellipsis">{b.name}</span><span className="muted">{Math.round(b.bytes / 1024)} КБ · {fmtDateTime(b.createdAt)}</span><a className="btn btn-sm btn-ghost" href={`/api/backups/${b.name}`}><Icon name="download" />Скачать</a></div>
            ))}
            {!data.backups.length && <p className="muted">Копий пока нет.</p>}
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>Восстановление: остановите сервер и выполните <span className="mono">npm run restore -- имя-файла.db</span>.</p>
        </div></section>
      )}

      {tab === 'security' && <SecuritySettings form={form} setForm={setForm} data={data} SaveBar={SaveBar} />}
    </div>
  );
}

type SaveBarT = (p: { section: keyof Settings }) => React.ReactElement;

function ModelSettings({ form, setForm, data, SaveBar, reload }: { form: Settings; setForm: (s: Settings) => void; data: SettingsData; SaveBar: SaveBarT; reload: () => void }) {
  const toast = useToast();
  const [models, setModels] = useState<{ name: string; size: number | null }[] | null>(null);
  const [status, setStatus] = useState<{ kind: 'good' | 'critical' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState('');
  const ai = form.ai;
  const setAi = (p: Partial<Settings['ai']>) => setForm({ ...form, ai: { ...ai, ...p } });

  const loadModels = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const saved = JSON.stringify(data.settings.ai) === JSON.stringify(ai);
      if (!saved) await put('/api/settings', { ai });
      const r = await get<{ models: { name: string; size: number | null }[] }>('/api/settings/ai/models');
      setModels(r.models);
      setStatus({ kind: r.models.length ? 'good' : 'info', text: r.models.length ? `Сервер доступен, моделей: ${r.models.length}` : 'Сервер доступен, но моделей нет. Скачайте модель командой ollama pull …' });
      if (!saved) reload();
    } catch (e) {
      setStatus({ kind: 'critical', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setBusy(true);
    try {
      const r = await post<{ ok: boolean; message: string }>('/api/settings/ai/test');
      setStatus({ kind: r.ok ? 'good' : 'info', text: r.message });
    } catch (e) {
      setStatus({ kind: 'critical', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="card"><div className="card-head"><h3>Языковая модель</h3></div><div className="card-body stack">
        <div className="seg" role="group">
          {([['ollama', 'Ollama (локально)'], ['openai', 'OpenAI-совместимый сервер'], ['offline', 'Без модели']] as const).map(([v, l]) => <button key={v} aria-pressed={ai.provider === v} onClick={() => setAi({ provider: v, baseUrl: v === 'ollama' ? 'http://127.0.0.1:11434' : v === 'openai' ? 'http://127.0.0.1:1234/v1' : ai.baseUrl })}>{l}</button>)}
        </div>
        {ai.provider === 'offline' ? <Alert kind="warning">Без модели агент создаёт только заготовки с пометкой TODO — они не пройдут проверку и не будут опубликованы автоматически.</Alert> : (
          <>
            <div className="grid grid-2">
              <label className="field"><span>Адрес сервера</span><input className="input mono" value={ai.baseUrl} onChange={(e) => setAi({ baseUrl: e.target.value })} />
                <small>{ai.provider === 'ollama' ? 'Ollama по умолчанию слушает http://127.0.0.1:11434' : 'LM Studio, llama.cpp server, vLLM и другие с API /v1/chat/completions'}</small></label>
              <label className="field"><span>Модель</span>
                {models?.length ? (
                  <select className="select" value={ai.model} onChange={(e) => setAi({ model: e.target.value })}>
                    <option value="">— выберите —</option>
                    {models.map((m) => <option key={m.name} value={m.name}>{m.name}{m.size ? ` · ${(m.size / 1e9).toFixed(1)} ГБ` : ''}</option>)}
                  </select>
                ) : <input className="input mono" value={ai.model} placeholder="например, qwen2.5:7b" onChange={(e) => setAi({ model: e.target.value })} />}
              </label>
              <label className="field"><span>Температура</span><input className="input" type="number" step={0.1} min={0} max={1.5} value={ai.temperature} onChange={(e) => setAi({ temperature: Number(e.target.value) })} /></label>
              <label className="field"><span>Таймаут ответа, секунд</span><input className="input" type="number" min={5} max={600} value={Math.round(ai.timeoutMs / 1000)} onChange={(e) => setAi({ timeoutMs: Number(e.target.value) * 1000 })} /></label>
            </div>
            {ai.provider === 'openai' && (
              <div className="grid grid-2">
                <label className="field"><span>API-ключ (если нужен)</span>
                  <div className="row" style={{ flexWrap: 'nowrap' }}><input className="input mono" type="password" autoComplete="off" placeholder={data.aiKeySet ? 'сохранён — введите новый, чтобы заменить' : ''} value={key} onChange={(e) => setKey(e.target.value)} />
                    <button className="btn" disabled={!key} onClick={async () => { await put('/api/settings/ai-key', { key }); setKey(''); toast('success', 'Ключ сохранён (зашифрован)'); reload(); }}>Сохранить</button></div>
                </label>
                <div className="field"><span>Внешние адреса</span><Switch checked={ai.allowRemote} onChange={(v) => setAi({ allowRemote: v })} label="Разрешить не локальный сервер (может быть платным)" /></div>
              </div>
            )}
            {status && <Alert kind={status.kind}>{status.text}</Alert>}
            <div className="row">
              <button className="btn" disabled={busy} onClick={loadModels}>{busy ? <span className="spinner" /> : <Icon name="refresh" />}Проверить сервер и список моделей</button>
              <button className="btn" disabled={busy || !data.settings.ai.model} onClick={test}><Icon name="sparkle" />Тестовый запрос</button>
            </div>
          </>
        )}
        <SaveBar section="ai" />
      </div></section>
      <section className="card"><div className="card-head"><h3>Какую модель выбрать</h3></div><div className="card-body text-2 stack">
        <p style={{ margin: 0 }}>Для русского текста хорошо подходят открытые модели семейств Qwen 2.5/3 (7–14B), Gemma 3 (12B), Llama 3.1 8B. Ориентир по памяти: модель 7–8B в квантовании Q4 требует около 5–6 ГБ ОЗУ/видеопамяти, 12–14B — около 9–10 ГБ.</p>
        <p style={{ margin: 0 }}>Пример: <span className="mono">ollama pull qwen2.5:7b</span>. NORO не скачивает модели сам — объём и выбор остаются за вами.</p>
      </div></section>
    </>
  );
}

function BrandSettings() {
  const toast = useToast();
  const { data, reload } = useLoad(() => get<Brand[]>('/api/brands'));
  const [b, setB] = useState<Brand | null>(null);
  useEffect(() => {
    if (data?.[0]) setB(data[0]);
  }, [data]);
  if (!b) return <Loading />;
  const save = async () => {
    try {
      await put(`/api/brands/${b.id}`, b);
      toast('success', 'Бренд сохранён. Пересоберите изображения материалов, чтобы применить новый стиль');
      reload();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  return (
    <section className="card"><div className="card-body stack">
      <div className="grid grid-2">
        <label className="field"><span>Название бренда</span><input className="input" value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} /></label>
        <label className="field"><span>Подпись на слайдах (@ник или сайт)</span><input className="input" value={b.handle} onChange={(e) => setB({ ...b, handle: e.target.value })} placeholder="@noro" /></label>
        <label className="field"><span>Акцентный цвет</span><div className="color-input"><input type="color" value={b.accent} onChange={(e) => setB({ ...b, accent: e.target.value })} /><input className="input mono" value={b.accent} onChange={(e) => setB({ ...b, accent: e.target.value })} /></div></label>
        <label className="field"><span>Фон слайдов</span><div className="color-input"><input type="color" value={b.background} onChange={(e) => setB({ ...b, background: e.target.value })} /><input className="input mono" value={b.background} onChange={(e) => setB({ ...b, background: e.target.value })} /></div></label>
      </div>
      <label className="field"><span>Целевая аудитория</span><textarea className="textarea" rows={2} value={b.audience} onChange={(e) => setB({ ...b, audience: e.target.value })} /></label>
      <label className="field"><span>Голос бренда</span><textarea className="textarea" rows={2} value={b.voice} onChange={(e) => setB({ ...b, voice: e.target.value })} /></label>
      <label className="field"><span>Призыв к действию по умолчанию</span><input className="input" value={b.defaultCta} onChange={(e) => setB({ ...b, defaultCta: e.target.value })} /></label>
      <label className="field"><span>Запрещённые слова (через запятую)</span><input className="input" value={b.bannedWords.join(', ')} onChange={(e) => setB({ ...b, bannedWords: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /><small>Материал с такими словами не будет опубликован.</small></label>
      <div className="row end"><button className="btn btn-primary" onClick={save}>Сохранить бренд</button></div>
    </div></section>
  );
}

function SecuritySettings({ form, setForm, data, SaveBar }: { form: Settings; setForm: (s: Settings) => void; data: SettingsData; SaveBar: SaveBarT }) {
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  return (
    <>
      <section className="card"><div className="card-head"><h3>Сессии и пароль</h3></div><div className="card-body stack">
        <label className="field"><span>Длительность сессии, часов</span><input className="input" type="number" min={1} max={720} value={form.security.sessionHours} onChange={(e) => setForm({ ...form, security: { sessionHours: Number(e.target.value) } })} style={{ maxWidth: 200 }} /></label>
        <SaveBar section="security" />
        <form className="grid grid-2" onSubmit={async (e) => { e.preventDefault(); try { await post('/api/auth/password', { current: cur, next }); setCur(''); setNext(''); toast('success', 'Пароль изменён, другие сессии завершены'); } catch (err) { toast('error', (err as Error).message); } }}>
          <label className="field"><span>Текущий пароль</span><input className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></label>
          <label className="field"><span>Новый пароль (от 10 символов)</span><input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></label>
          <div><button className="btn" disabled={!cur || next.length < 10}>Сменить пароль</button></div>
        </form>
      </div></section>
      <section className="card"><div className="card-head"><h3><Icon name="shield" /> Как защищены данные</h3></div><div className="card-body">
        <dl className="kv">
          <dt>Токены соцсетей</dt><dd>AES-256-GCM, ключ {data.masterKeyFromEnv ? 'из переменной NORO_MASTER_KEY' : <>в файле <span className="mono">{data.dataDir}/master.key</span> (права 600)</>}. В браузер не возвращаются.</dd>
          <dt>Пароль</dt><dd>scrypt, блокировка на 15 минут после 5 неудачных попыток.</dd>
          <dt>Запросы</dt><dd>Сессионная cookie HttpOnly + CSRF-токен на каждое изменение.</dd>
          <dt>Журнал</dt><dd>Токены, ключи и заголовки авторизации вырезаются до записи.</dd>
          <dt>Публичный адрес</dt><dd>{data.publicBaseUrl ?? 'не задан — сервер доступен только с этого компьютера'}</dd>
          <dt>Данные</dt><dd className="mono">{data.dataDir}</dd>
        </dl>
      </div></section>
    </>
  );
}
