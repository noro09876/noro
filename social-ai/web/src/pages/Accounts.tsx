import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { del, get, post, put } from '../api';
import type { Account, IntegrationInfo, Platform } from '../types';
import { Alert, Confirm, Empty, ErrorBox, fmtRelative, Icon, Loading, Modal, PLATFORM_LABEL, PlatformIcon, StatusBadge, Switch, useLoad, useToast } from '../ui';

export function Accounts() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const integrations = useLoad(() => get<IntegrationInfo[]>('/api/integrations'));
  const accounts = useLoad(() => get<Account[]>('/api/accounts'));
  const [adding, setAdding] = useState<Platform | null>(null);
  const [editing, setEditing] = useState<Account | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'disconnect' | 'delete'; acc: Account } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    const o = params.get('oauth');
    if (o) {
      toast(o === 'ok' ? 'success' : 'error', o === 'ok' ? 'Аккаунт X авторизован' : 'Авторизация X не завершена — подробности в журнале');
      params.delete('oauth');
      setParams(params, { replace: true });
      void accounts.reload();
    }
  }, [params, setParams, toast, accounts]);

  if ((integrations.loading && !integrations.data) || (accounts.loading && !accounts.data)) return <div className="page"><Loading /></div>;
  if (integrations.error || accounts.error) return <div className="page"><ErrorBox error={integrations.error ?? accounts.error ?? ''} retry={() => { void integrations.reload(); void accounts.reload(); }} /></div>;
  const list = accounts.data ?? [];
  const infos = integrations.data ?? [];

  const check = async (a: Account) => {
    setBusy(a.id);
    try {
      const r = await post<{ ok: boolean; message: string }>(`/api/accounts/${a.id}/check`);
      toast(r.ok ? 'success' : 'error', r.message);
      await accounts.reload();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (a: Account, key: 'enabled' | 'autoPublish', v: boolean) => {
    try {
      await put(`/api/accounts/${a.id}`, { settings: { [key]: v } });
      await accounts.reload();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const authorizeX = async (a: Account) => {
    try {
      const r = await get<{ url: string }>(`/api/accounts/${a.id}/oauth/start`);
      window.location.href = r.url;
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  return (
    <div className="page">
      <section className="card">
        <div className="card-head"><h2>Подключённые аккаунты</h2></div>
        {list.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Аккаунт</th><th>Статус</th><th>Проверка</th><th>Публикация</th><th /></tr></thead>
              <tbody>
                {list.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <div className="row" style={{ flexWrap: 'nowrap' }}>
                        <PlatformIcon platform={a.platform} />
                        <div style={{ minWidth: 0 }}>
                          <div className="ellipsis">{a.name}</div>
                          <div className="muted ellipsis" style={{ fontSize: 12 }}>{PLATFORM_LABEL[a.platform]}{a.remoteName ? ` · ${a.remoteName}` : ''}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <StatusBadge kind="account" status={a.status} />
                      {a.lastError && <div className="muted" style={{ fontSize: 12, marginTop: 4, maxWidth: 340 }}>{a.lastError}</div>}
                    </td>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>{fmtRelative(a.lastCheckAt)}</td>
                    <td>
                      <div className="stack" style={{ gap: 6 }}>
                        <Switch checked={a.settings.enabled} onChange={(v) => toggle(a, 'enabled', v)} label="Включён" />
                        <Switch checked={a.settings.autoPublish} onChange={(v) => toggle(a, 'autoPublish', v)} label="Автопубликация" />
                      </div>
                    </td>
                    <td>
                      <div className="row end" style={{ flexWrap: 'nowrap' }}>
                        {a.platform === 'x' && <button className="btn btn-sm" onClick={() => authorizeX(a)}><Icon name="link" />{a.authorized ? 'Переавторизовать' : 'Авторизоваться в X'}</button>}
                        <button className="btn btn-sm" disabled={busy === a.id} onClick={() => check(a)}>{busy === a.id ? <span className="spinner" /> : <Icon name="refresh" />}Проверить</button>
                        <button className="btn btn-sm btn-ghost" onClick={() => setEditing(a)} aria-label="Настройки"><Icon name="settings" /></button>
                        {a.status !== 'disabled' && <button className="btn btn-sm btn-ghost" onClick={() => setConfirm({ kind: 'disconnect', acc: a })}>Отключить</button>}
                        <button className="btn btn-sm btn-ghost btn-danger btn-icon" onClick={() => setConfirm({ kind: 'delete', acc: a })} aria-label="Удалить"><Icon name="trash" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon="users" title="Аккаунтов пока нет" text="Выберите площадку ниже. Пароли от соцсетей не нужны — только официальные токены API." />}
      </section>

      <div className="grid grid-2">
        {infos.map((i) => (
          <section key={i.platform} className="card">
            <div className="card-head">
              <PlatformIcon platform={i.platform} />
              <h3>{i.label}</h3>
              <div className="spacer" />
              <button className="btn btn-sm" onClick={() => setAdding(i.platform)}><Icon name="plus" />Подключить</button>
            </div>
            <div className="card-body stack">
              <span className={`badge plain wrap ${i.platform === 'x' ? 'badge-warning' : 'badge-good'}`} style={{ justifySelf: 'start' }}>{i.cost}</span>
              <ol className="req">{i.requirements.map((r) => <li key={r}>{r}</li>)}</ol>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>Статистика: {i.metricsNote}</p>
            </div>
          </section>
        ))}
      </div>

      {adding && <AccountForm info={infos.find((i) => i.platform === adding)!} onClose={() => setAdding(null)} onSaved={async (acc) => { setAdding(null); await accounts.reload(); toast(acc.status === 'connected' ? 'success' : 'info', acc.status === 'connected' ? 'Аккаунт подключён и проверен' : `Аккаунт добавлен: ${acc.lastError ?? 'требуется авторизация'}`); }} />}
      {editing && <AccountForm info={infos.find((i) => i.platform === editing.platform)!} account={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await accounts.reload(); toast('success', 'Сохранено'); }} />}
      {confirm && (
        <Confirm
          title={confirm.kind === 'delete' ? 'Удалить аккаунт?' : 'Отключить аккаунт?'}
          text={confirm.kind === 'delete' ? 'Аккаунт и история его публикаций будут удалены из NORO. В самой соцсети ничего не изменится.' : 'Ключи доступа будут удалены, запланированные публикации в этот аккаунт — отменены.'}
          danger confirmLabel={confirm.kind === 'delete' ? 'Удалить' : 'Отключить'}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            try {
              if (confirm.kind === 'delete') await del(`/api/accounts/${confirm.acc.id}`);
              else await post(`/api/accounts/${confirm.acc.id}/disconnect`);
              await accounts.reload();
            } catch (e) {
              toast('error', (e as Error).message);
            }
          }}
        />
      )}
    </div>
  );
}

function AccountForm({ info, account, onClose, onSaved }: { info: IntegrationInfo; account?: Account; onClose: () => void; onSaved: (a: Account) => void }) {
  const [name, setName] = useState(account?.name ?? `${info.label}`);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [config, setConfig] = useState<Record<string, string>>(account?.config ?? {});
  const [maxPerDay, setMaxPerDay] = useState(account?.settings.maxPerDay ?? 3);
  const [useHashtags, setUseHashtags] = useState(account?.settings.useHashtags ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { platform: info.platform, name, credentials: creds, config, settings: { maxPerDay, useHashtags } };
      const a = account ? await put<Account>(`/api/accounts/${account.id}`, body) : await post<Account>('/api/accounts', body);
      onSaved(a);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={account ? `Настройки: ${account.name}` : `Подключить ${info.label}`} onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
      <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? <span className="spinner" /> : null}{account ? 'Сохранить' : info.oauth ? 'Сохранить' : 'Подключить и проверить'}</button>
    </>}>
      {error && <Alert kind="critical">{error}</Alert>}
      <label className="field"><span>Название в NORO</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
      {info.credentialFields.map((f) => (
        <label key={f.key} className="field">
          <span>{f.label}{f.required && !account ? ' *' : ''}</span>
          <input className="input mono" type={f.secret ? 'password' : 'text'} autoComplete="off" spellCheck={false}
            placeholder={account?.credentials[f.key]?.set ? `сохранено ${account.credentials[f.key].hint} — оставьте пустым, чтобы не менять` : f.placeholder}
            value={creds[f.key] ?? ''} onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })} />
          {f.help && <small>{f.help}</small>}
        </label>
      ))}
      {info.configFields.map((f) => (
        <label key={f.key} className="field">
          <span>{f.label}{f.required ? ' *' : ''}</span>
          <input className="input mono" placeholder={f.placeholder} value={config[f.key] ?? ''} onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })} />
        </label>
      ))}
      <div className="grid grid-2">
        <label className="field"><span>Не больше публикаций в день</span><input className="input" type="number" min={1} max={50} value={maxPerDay} onChange={(e) => setMaxPerDay(Number(e.target.value))} /></label>
        <div className="field"><span>Хештеги</span><Switch checked={useHashtags} onChange={setUseHashtags} label="Добавлять в публикации" /></div>
      </div>
      {info.oauth && <Alert kind="info">После сохранения нажмите «Авторизоваться в X» в списке аккаунтов. Callback URL в настройках приложения X: <span className="mono">{window.location.origin}/api/oauth/x/callback</span></Alert>}
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>Токены шифруются (AES-256-GCM) и никогда не возвращаются в браузер и не пишутся в журнал.</p>
    </Modal>
  );
}
