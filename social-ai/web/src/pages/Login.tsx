import { useState, type FormEvent } from 'react';
import { post } from '../api';
import { Alert } from '../ui';

export function Login({ setup, needsToken, onDone }: { setup: boolean; needsToken: boolean; onDone: () => void }) {
  const [username, setUsername] = useState(setup ? 'admin' : '');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (setup && password !== password2) return setError('Пароли не совпадают');
    setBusy(true);
    try {
      await post(setup ? '/api/auth/setup' : '/api/auth/login', { username, password, setupToken: token || undefined });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={submit}>
        <div>
          <h1>NORO Social AI</h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>{setup ? 'Первый запуск: создайте учётную запись администратора' : 'Вход в панель управления'}</p>
        </div>
        {error && <Alert kind="critical">{error}</Alert>}
        <label className="field"><span>Логин</span><input className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required /></label>
        <label className="field"><span>Пароль</span><input className="input" type="password" autoComplete={setup ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={setup ? 10 : 1} />
          {setup && <small>Не короче 10 символов. Пароль хранится только в виде хеша scrypt.</small>}
        </label>
        {setup && <label className="field"><span>Повторите пароль</span><input className="input" type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} required /></label>}
        {setup && needsToken && (
          <label className="field"><span>Код первичной настройки</span><input className="input mono" value={token} onChange={(e) => setToken(e.target.value)} required />
            <small>Вы открыли NORO не с того компьютера, где он запущен. Код выведен в консоли сервера.</small>
          </label>
        )}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Подождите…' : setup ? 'Создать и войти' : 'Войти'}</button>
      </form>
    </div>
  );
}
