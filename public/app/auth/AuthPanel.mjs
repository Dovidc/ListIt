import {
  createElement,
  useCallback,
  useMemo,
  useState
} from '../shared/runtime.mjs';
import { useAuth } from './AuthContext.mjs';

export function AuthPanel() {
  const { user, status, login, register, logout, isAuthenticated } = useAuth();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const canSubmit = useMemo(() => {
    if (!email || !password) return false;
    if (mode === 'register' && !username) return false;
    return true;
  }, [email, password, mode, username]);

  const handleSubmit = useCallback(async (event) => {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      if (mode === 'login') {
        await login(email.trim(), password);
      } else {
        await register({ email: email.trim(), password, username: username.trim() });
      }
      setEmail('');
      setPassword('');
      setUsername('');
    } catch (err) {
      setError(err?.message || 'Unable to authenticate');
    } finally {
      setBusy(false);
    }
  }, [canSubmit, email, password, username, mode, login, register]);

  if (isAuthenticated && user) {
    return createElement('div', { className: 'auth-panel signed-in' },
      createElement('div', { className: 'auth-summary' },
        createElement('strong', null, user.username || user.email || 'Account'),
        user.email && createElement('span', { className: 'muted' }, user.email)
      ),
      createElement('button', {
        type: 'button',
        className: 'btn',
        onClick: logout
      }, 'Sign out')
    );
  }

  const disabled = busy || status === 'loading';

  return createElement('section', { className: 'auth-panel' },
    createElement('h2', null, mode === 'login' ? 'Sign in to continue' : 'Create your account'),
    createElement('div', { className: 'auth-toggle' },
      createElement('button', {
        type: 'button',
        className: `btn ${mode === 'login' ? 'primary' : ''}`,
        onClick: () => setMode('login'),
        disabled: disabled && mode === 'login'
      }, 'Sign in'),
      createElement('button', {
        type: 'button',
        className: `btn ${mode === 'register' ? 'primary' : ''}`,
        onClick: () => setMode('register'),
        disabled: disabled && mode === 'register'
      }, 'Register')
    ),
    createElement('form', {
      className: 'auth-form',
      onSubmit: handleSubmit,
      'data-testid': 'auth-form'
    },
      mode === 'register' && createElement('label', null,
        'Username',
        createElement('input', {
          name: 'username',
          value: username,
          onInput: (event) => setUsername(event.target.value),
          placeholder: 'Your name',
          disabled
        })
      ),
      createElement('label', null,
        'Email',
        createElement('input', {
          name: 'email',
          type: 'email',
          autoComplete: 'email',
          value: email,
          onInput: (event) => setEmail(event.target.value),
          placeholder: 'you@example.com',
          disabled
        })
      ),
      createElement('label', null,
        'Password',
        createElement('input', {
          name: 'password',
          type: 'password',
          autoComplete: mode === 'login' ? 'current-password' : 'new-password',
          value: password,
          onInput: (event) => setPassword(event.target.value),
          placeholder: '••••••••',
          disabled
        })
      ),
      error && createElement('div', { className: 'auth-error' }, error),
      createElement('button', {
        type: 'submit',
        className: 'btn primary',
        disabled: disabled || !canSubmit
      }, busy ? 'Please wait…' : (mode === 'login' ? 'Sign in' : 'Create account'))
    )
  );
}
