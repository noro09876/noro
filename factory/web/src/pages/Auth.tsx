import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api';
import { NoroMark } from '../components/icons';
import { Button, ErrorBox, Field } from '../components/ui';
import { STAGES, STAGE_LABEL } from '../../../shared/types';

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const [form, setForm] = useState({ email: '', password: '', name: '', workspace: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const nav = useNavigate();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(mode === 'login' ? '/api/auth/login' : '/api/auth/signup', mode === 'login' ? { email: form.email, password: form.password } : form);
      await qc.invalidateQueries({ queryKey: ['me'] });
      nav('/');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <section className="auth-art">
        <div className="grid-bg" />
        <div className="logo" style={{ padding: 0 }}>
          <div className="logo-mark"><NoroMark /></div>
          <div>
            <b>NORO</b>
            <span>Content Factory</span>
          </div>
        </div>
        <div>
          <div className="hero-title">
            Бриф на входе. <em>Кампания</em> на выходе.
          </div>
          <p className="muted" style={{ marginTop: 14, maxWidth: 520 }}>
            Стратегия, тексты, карусели, графика и вертикальные видео с озвучкой — под каждую площадку, с проверкой качества, согласованием и публикацией через официальные API.
          </p>
          <div className="pipeline-mini">
            {STAGES.map((s, i) => (
              <span key={s}>
                {String(i + 1).padStart(2, '0')} {STAGE_LABEL[s]}
              </span>
            ))}
          </div>
        </div>
        <p className="tiny dim">Публикация засчитывается только после подтверждения площадкой. Тестовые операции помечены.</p>
      </section>
      <section className="auth-form">
        <form onSubmit={submit}>
          <h1>{mode === 'login' ? 'Вход' : 'Регистрация'}</h1>
          {mode === 'signup' && (
            <Field label="Имя">
              <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" />
            </Field>
          )}
          <Field label="Email">
            <input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" />
          </Field>
          <Field label="Пароль" hint={mode === 'signup' ? 'Минимум 10 символов' : undefined}>
            <input className="input" type="password" required minLength={mode === 'signup' ? 10 : 1} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          </Field>
          {mode === 'signup' && (
            <Field label="Название рабочего пространства" hint="Можно изменить позже">
              <input className="input" value={form.workspace} onChange={(e) => setForm({ ...form, workspace: e.target.value })} placeholder="Например, «Маркетинг NORO»" />
            </Field>
          )}
          <ErrorBox error={error} />
          <Button variant="primary" type="submit" loading={busy}>
            {mode === 'login' ? 'Войти' : 'Создать аккаунт'}
          </Button>
          <p className="small muted" style={{ textAlign: 'center' }}>
            {mode === 'login' ? (
              <>
                Нет аккаунта? <Link to="/signup" style={{ color: 'var(--lime)' }}>Зарегистрироваться</Link>
              </>
            ) : (
              <>
                Уже есть аккаунт? <Link to="/login" style={{ color: 'var(--lime)' }}>Войти</Link>
              </>
            )}
          </p>
        </form>
      </section>
    </div>
  );
}
