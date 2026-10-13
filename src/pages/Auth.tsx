import { useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Field } from '../components/ui';
import { Wordmark } from '../components/AppShell';

type Mode = 'in' | 'up' | 'forgot';

export function Login() {
  const { session, loading, signIn, signUp, sendReset } = useAuth();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';
  const [mode, setMode] = useState<Mode>(params.get('next')?.startsWith('/join/') ? 'up' : 'in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  if (!loading && session) return <Navigate to={next} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      if (mode === 'in') await signIn(email.trim(), password);
      else if (mode === 'up') {
        const r = await signUp(email.trim(), password, name || username, username);
        if (r.needsConfirmation) setNotice('Check your inbox and confirm your email, then come back and sign in.');
      } else {
        await sendReset(email.trim());
        setNotice('If that address has an account, a reset link is on its way.');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <div className="atmosphere" aria-hidden="true"><i className="rain" /><i className="grain" /></div>
      <section className="login-hero">
        <Wordmark />
        <h1 className="display hero">Rate it.<br />Remember it.<br />Plan the next one.</h1>
        <p className="lede">A private logbook for you and your people: films, cafés, courts, and every place worth going back to.</p>
      </section>
      <form className="login-card" onSubmit={submit} noValidate={false}>
        <h2 className="display">{mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create your account' : 'Reset your password'}</h2>
        {params.get('next')?.startsWith('/join/') && <p className="muted">You were invited to a group. Sign in or create an account to join it.</p>}
        {mode === 'up' && (
          <>
            <Field label="Your name"><input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} autoComplete="name" /></Field>
            <Field label="Username" hint="Letters, numbers and underscores. 3 to 24 characters.">
              <input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} required minLength={3} maxLength={24} autoComplete="username" />
            </Field>
          </>
        )}
        <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" inputMode="email" /></Field>
        {mode !== 'forgot' && (
          <Field label="Password" hint={mode === 'up' ? 'At least 8 characters.' : undefined}>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} />
          </Field>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="notice" role="status">{notice}</p>}
        <button className="btn block" disabled={busy}>{busy ? 'One moment' : mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}</button>
        <div className="login-links">
          {mode !== 'in' && <button type="button" className="link-btn" onClick={() => { setMode('in'); setError(''); setNotice(''); }}>I have an account</button>}
          {mode !== 'up' && <button type="button" className="link-btn" onClick={() => { setMode('up'); setError(''); setNotice(''); }}>Create an account</button>}
          {mode === 'in' && <button type="button" className="link-btn" onClick={() => { setMode('forgot'); setError(''); setNotice(''); }}>Forgot password</button>}
        </div>
      </form>
    </main>
  );
}

export function ResetPassword() {
  const { setPassword } = useAuth();
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try { await setPassword(pw); } catch (err) { setError((err as Error).message); setBusy(false); }
  }
  return (
    <main className="login">
      <form className="login-card" onSubmit={submit}>
        <h2 className="display">Choose a new password</h2>
        <Field label="New password" hint="At least 8 characters."><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} required autoComplete="new-password" /></Field>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn block" disabled={busy}>Save password</button>
      </form>
    </main>
  );
}
