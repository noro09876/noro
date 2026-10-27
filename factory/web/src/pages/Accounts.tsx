import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../api';
import { Icon } from '../components/icons';
import { Badge, Button, ErrorBox, Field, fmtDate, Loading, MODE_BADGE, Modal, Notice, PlatformChip, useToast } from '../components/ui';
import { useWs, useWsApi } from '../session';
import type { Account, PlatformInfo } from '../types';

interface AccountsView {
  accounts: Account[];
  apps: Record<string, { configured: boolean; clientId?: string; secretHint?: string | null; fromEnv?: boolean }>;
  publicHttps: boolean;
}

const MEDIA = { text: 'текст', image: 'изображение', carousel: 'карусель', video: 'видео' } as const;
const STATUS: Record<Account['status'], { label: string; tone: 'ok' | 'warn' | 'err' }> = {
  connected: { label: 'подключён', tone: 'ok' },
  expired: { label: 'токен истёк', tone: 'warn' },
  error: { label: 'ошибка', tone: 'err' },
  disconnected: { label: 'отключён', tone: 'err' },
};

export function AccountsPage() {
  const { ws } = useWs();
  const u = useWsApi();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const platforms = useQuery({ queryKey: ['platforms'], queryFn: () => api.get<PlatformInfo[]>('/api/platforms'), staleTime: Infinity });
  const q = useQuery({ queryKey: ['accounts', ws.id], queryFn: () => api.get<AccountsView>(u('/accounts')) });
  const [open, setOpen] = useState<PlatformInfo | null>(null);

  useEffect(() => {
    const err = params.get('error');
    if (err) toast.err(new Error(err));
    if (params.get('connected')) toast.ok('Аккаунт подключён');
    if (err || params.get('connected')) setParams({}, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (platforms.isLoading || q.isLoading || !platforms.data || !q.data) return <Loading />;
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Соцсети</h1>
          <p>Только официальные API и OAuth. Пароли от соцсетей не запрашиваются и не хранятся; токены шифруются (AES-256-GCM) и обновляются автоматически, где площадка это позволяет.</p>
        </div>
      </div>
      {!q.data.publicHttps && (
        <Notice tone="warn">
          PUBLIC_URL сервера не HTTPS. Instagram, Threads и TikTok скачивают медиа по публичной HTTPS-ссылке, а большинство OAuth-приложений принимают только HTTPS-адрес возврата. Для них разверните фабрику на домене с HTTPS.
        </Notice>
      )}
      <div className="grid auto-fill" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
        {platforms.data.map((p) => {
          const list = q.data.accounts.filter((a) => a.platform === p.id);
          const mode = MODE_BADGE[p.mode]!;
          return (
            <div key={p.id} className="card" style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="card-head">
                <PlatformChip id={p.id} />
                <Badge tone={mode.tone}>{mode.label}</Badge>
              </div>
              <div className="card-body stack" style={{ flex: 1 }}>
                <div className="small muted">{p.accountTypes}</div>
                <div className="row tight">
                  {p.apiMedia.length ? p.apiMedia.map((m) => <Badge key={m}>{MEDIA[m]}</Badge>) : <span className="small muted">API публикации нет — готовим пакет: {p.preparedMedia.map((m) => MEDIA[m]).join(', ')}</span>}
                </div>
                {list.map((a) => <AccountRow key={a.id} account={a} platform={p} />)}
                {list.length === 0 && p.connect !== 'manual' && <div className="small dim">Не подключено</div>}
              </div>
              <div className="card-body row" style={{ borderTop: '1px solid var(--line)' }}>
                <Button size="sm" variant={p.connect !== 'manual' && list.length === 0 ? 'primary' : undefined} icon={p.connect === 'manual' ? 'info' : 'plus'} onClick={() => setOpen(p)}>
                  {p.connect === 'manual' ? 'Как публиковать' : list.length ? 'Ещё аккаунт' : 'Подключить'}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      {open && <ConnectModal platform={open} view={q.data} onClose={() => setOpen(null)} />}
    </div>
  );
}

function AccountRow({ account: a, platform }: { account: Account; platform: PlatformInfo }) {
  const { can } = useWs();
  const u = useWsApi();
  const qc = useQueryClient();
  const toast = useToast();
  const refresh = () => qc.invalidateQueries({ queryKey: ['accounts'] });
  const check = useMutation({ mutationFn: () => api.post<Account>(u(`/accounts/${a.id}/check`)), onSuccess: (r) => { if (r.status === 'connected') toast.ok('Доступ подтверждён площадкой'); else toast.err(new Error(r.lastError ?? 'Ошибка')); refresh(); }, onError: toast.err });
  const del = useMutation({ mutationFn: () => api.del(u(`/accounts/${a.id}`)), onSuccess: refresh, onError: toast.err });
  const patch = useMutation({ mutationFn: (b: Record<string, unknown>) => api.patch(u(`/accounts/${a.id}`), b), onSuccess: refresh, onError: toast.err });
  const needsTarget = platform.multiTarget && !a.externalId;
  const targets = useQuery({ queryKey: ['targets', a.id], queryFn: () => api.get<{ id: string; name: string }[]>(u(`/accounts/${a.id}/targets`)), enabled: needsTarget && can('admin') });
  const choose = useMutation({ mutationFn: (targetId: string) => api.post(u(`/accounts/${a.id}/target`), { targetId }), onSuccess: refresh, onError: toast.err });
  const st = STATUS[a.status];
  const warnings = (a.meta.warnings as string[] | undefined) ?? [];
  const expiresSoon = a.tokenExpiresAt && new Date(a.tokenExpiresAt).getTime() - Date.now() < 3 * 86400_000;
  return (
    <div className="col" style={{ gap: 8, padding: 12, borderRadius: 12, background: 'var(--bg-2)', border: '1px solid var(--line)' }}>
      <div className="row between">
        <b className="ellipsis" style={{ maxWidth: 200 }}>{a.displayName}</b>
        <div className="row tight">
          {a.meta.test ? <Badge tone="test">ТЕСТ</Badge> : null}
          <Badge tone={needsTarget ? 'warn' : st.tone} dot>{needsTarget ? 'выберите сообщество' : st.label}</Badge>
        </div>
      </div>
      <div className="tiny dim">
        {a.tokenExpiresAt ? <>токен до {fmtDate(a.tokenExpiresAt)}{expiresSoon ? ' — скоро обновится' : ''} · </> : null}
        проверен {fmtDate(a.lastCheckedAt)}
        {a.scopes.length ? <> · права: {a.scopes.join(', ')}</> : null}
      </div>
      {a.lastError && <div className="small" style={{ color: a.status === 'connected' ? 'var(--amber)' : 'var(--red)' }}>{a.lastError}</div>}
      {warnings.map((w) => <div key={w} className="small" style={{ color: 'var(--amber)' }}>⚠ {w}</div>)}
      {needsTarget && targets.data && (
        <select className="select" defaultValue="" onChange={(e) => e.target.value && choose.mutate(e.target.value)}>
          <option value="" disabled>Сообщество для публикаций…</option>
          {targets.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}
      {(platform.id === 'youtube' || platform.id === 'tiktok') && can('admin') && (
        <Field label="Видимость публикаций">
          <select className="select" value={(a.meta.privacy as string) ?? ''} onChange={(e) => patch.mutate({ privacy: e.target.value })}>
            {platform.id === 'youtube' ? (
              <>
                <option value="public">публично</option>
                <option value="unlisted">по ссылке</option>
                <option value="private">приватно (тест)</option>
              </>
            ) : (
              ((a.meta.privacyOptions as string[]) ?? ['SELF_ONLY']).map((o) => <option key={o} value={o}>{o === 'SELF_ONLY' ? 'только автор (тест)' : o === 'PUBLIC_TO_EVERYONE' ? 'публично' : o}</option>)
            )}
          </select>
        </Field>
      )}
      {can('admin') && (
        <div className="row tight">
          <Button size="xs" icon="refresh" onClick={() => check.mutate()} loading={check.isPending}>Проверить</Button>
          <Button size="xs" variant="ghost" onClick={() => patch.mutate({ test: !a.meta.test })}>{a.meta.test ? 'Снять метку «тест»' : 'Пометить как тестовый'}</Button>
          <Button size="xs" variant="danger" icon="trash" onClick={() => confirm(`Отключить «${a.displayName}»? Токены будут удалены.`) && del.mutate()} />
        </div>
      )}
    </div>
  );
}

function ConnectModal({ platform: p, view, onClose }: { platform: PlatformInfo; view: AccountsView; onClose: () => void }) {
  const { can } = useWs();
  const u = useWsApi();
  const qc = useQueryClient();
  const toast = useToast();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [app, setApp] = useState({ clientId: '', clientSecret: '' });
  const [test, setTest] = useState(false);
  const appState = view.apps[p.id];
  const redirect = `${window.location.origin}/api/oauth/callback/${p.id}`;
  const token = useMutation({ mutationFn: () => api.post(u('/accounts/token'), { platform: p.id, fields, test }), onSuccess: () => { toast.ok('Подключено, доступ проверен'); qc.invalidateQueries({ queryKey: ['accounts'] }); onClose(); } });
  const saveApp = useMutation({ mutationFn: () => api.put(u(`/integrations/${p.id}`), app), onSuccess: () => { toast.ok('Данные приложения сохранены'); qc.invalidateQueries({ queryKey: ['accounts'] }); } });
  const oauth = useMutation({ mutationFn: () => api.post<{ url: string }>(u('/accounts/oauth'), { platform: p.id, test }), onSuccess: (r) => { window.location.href = r.url; } });

  return (
    <Modal open onClose={onClose} title={`${p.name}: подключение`} wide>
      <div className="split">
        <div className="stack">
          <h3>Как получить доступ</h3>
          <ol className="steps">{p.setupSteps.map((s) => <li key={s}>{s.replace('{PUBLIC_URL}', window.location.origin)}</li>)}</ol>
          <dl className="kv small">
            <dt>Права</dt><dd>{p.permissions.join(', ')}</dd>
            <dt>Проверка площадкой</dt><dd>{p.review}</dd>
            <dt>Подтверждение публикации</dt><dd>{p.status}</dd>
            <dt>Аналитика</dt><dd>{p.analytics}</dd>
            {p.limits.rate && <><dt>Лимиты</dt><dd>{p.limits.rate}</dd></>}
          </dl>
          {p.hardLimits.length > 0 && (
            <div>
              <h3 style={{ marginBottom: 6 }}>Ограничения</h3>
              <ul className="steps">{p.hardLimits.map((h) => <li key={h}>{h}</li>)}</ul>
            </div>
          )}
          <div className="row tight">{p.docs.map((d) => <a key={d.url} className="btn xs" href={d.url} target="_blank" rel="noreferrer"><Icon name="external" /> {d.label}</a>)}</div>
        </div>
        <div className="stack">
          {p.connect === 'manual' && (
            <Notice tone="info">
              У {p.name} нет официального API публикации, поэтому подключать нечего. Фабрика готовит пакет (текст, заголовок, обложку, изображения или видео), ставит напоминание в календарь, а после размещения вы вставляете ссылку — статус станет «Размещено вручную». Автопубликацией это не называется.
            </Notice>
          )}
          {!can('admin') && p.connect !== 'manual' && <Notice tone="warn">Подключать аккаунты может администратор пространства.</Notice>}
          {p.connect === 'token' && can('admin') && (
            <form className="stack" onSubmit={(e) => { e.preventDefault(); token.mutate(); }}>
              {p.fields.map((f) => (
                <Field key={f.key} label={f.label} hint={f.help}>
                  <input className="input mono" type={f.secret ? 'password' : 'text'} autoComplete="off" placeholder={f.placeholder} value={fields[f.key] ?? ''} onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })} required />
                </Field>
              ))}
              <label className="check"><input type="checkbox" checked={test} onChange={(e) => setTest(e.target.checked)} /> Тестовый канал/чат (публикации будут помечены как тестовые)</label>
              <ErrorBox error={token.error} />
              <Button variant="primary" type="submit" loading={token.isPending}>Проверить и подключить</Button>
              <p className="tiny dim">Фабрика сразу вызывает API площадки и проверяет права. Токен хранится зашифрованным и не показывается повторно.</p>
            </form>
          )}
          {p.connect === 'oauth' && can('admin') && (
            <div className="stack">
              <h3>1. Приложение {p.name}</h3>
              {appState?.configured ? (
                <Notice tone="ok">
                  Приложение настроено{appState.clientId ? <> · ID <span className="mono">{appState.clientId}</span> · секрет {appState.secretHint}</> : appState.fromEnv ? ' через переменные окружения' : ''}.
                </Notice>
              ) : null}
              <Field label="Адрес возврата (Redirect URI) — укажите его в настройках приложения">
                <div className="row tight">
                  <input className="input mono" readOnly value={redirect} style={{ flex: 1 }} />
                  <Button type="button" size="sm" icon="copy" onClick={() => navigator.clipboard?.writeText(redirect).then(() => toast.ok('Скопировано'))} aria-label="Копировать" />
                </div>
              </Field>
              <form className="stack" onSubmit={(e) => { e.preventDefault(); saveApp.mutate(); }}>
                {p.appFields.map((f) => (
                  <Field key={f.key} label={f.label}>
                    <input className="input mono" type={f.secret ? 'password' : 'text'} autoComplete="off" value={app[f.key as 'clientId' | 'clientSecret']} onChange={(e) => setApp({ ...app, [f.key]: e.target.value })} required={!appState?.configured} />
                  </Field>
                ))}
                <ErrorBox error={saveApp.error} />
                <Button type="submit" loading={saveApp.isPending} disabled={!app.clientId || !app.clientSecret}>{appState?.configured ? 'Заменить данные приложения' : 'Сохранить приложение'}</Button>
              </form>
              <div className="sep" />
              <h3>2. Вход через {p.name}</h3>
              <label className="check"><input type="checkbox" checked={test} onChange={(e) => setTest(e.target.checked)} /> Тестовый аккаунт</label>
              <ErrorBox error={oauth.error} />
              <Button variant="primary" icon="link" onClick={() => oauth.mutate()} loading={oauth.isPending} disabled={!appState?.configured}>Перейти к авторизации</Button>
              <p className="tiny dim">Вы попадёте на официальную страницу входа {p.name}. Фабрика получает только токен с перечисленными правами.</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
