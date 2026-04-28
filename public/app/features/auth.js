(() => {
  const {
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    createContext
  } = React;

  const H = (tag, props, ...children) => React.createElement(tag, props || null, ...children);

  function normalizePushMeta(value) {
    const source = value && typeof value === 'object'
      ? (value.push_meta && typeof value.push_meta === 'object'
        ? value.push_meta
        : (value.pushMeta && typeof value.pushMeta === 'object' ? value.pushMeta : null))
      : null;
    const available = !!source?.available;
    const vapid = typeof source?.vapid_public_key === 'string'
      ? source.vapid_public_key.trim()
      : (typeof source?.vapidPublicKey === 'string' ? source.vapidPublicKey.trim() : '');
    return {
      available: available && !!vapid,
      vapidPublicKey: vapid || null
    };
  }

  function createAuthFeature({ api, ReactDOM, onTokenChange }) {
    if (!api) {
      throw new Error('Auth feature requires an API client.');
    }
    if (!ReactDOM) {
      throw new Error('Auth feature requires ReactDOM.');
    }

    const AuthContext = createContext(null);

    function AuthProvider({ children }) {
      const [user, setUserState] = useState(null);
      const [loading, setLoading] = useState(true);
      const [pushMeta, setPushMeta] = useState({ available: false, vapidPublicKey: null });

      const tokenHandler = typeof onTokenChange === 'function' ? onTokenChange : null;

      const setUser = useCallback((next) => {
        setUserState(next || null);
        setPushMeta(normalizePushMeta(next));

        if (!tokenHandler) return;

        if (!next) {
          tokenHandler(null);
          return;
        }

        if (next && typeof next === 'object' && typeof next.token === 'string' && next.token.trim()) {
          tokenHandler(next.token.trim());
        }
      }, [tokenHandler]);

      useEffect(() => {
        let alive = true;
        (async () => {
          try {
            const me = await api.me();
            if (!alive) return;
            setUser(me);
          } catch {
            if (!alive) return;
            setUser(null);
          } finally {
            if (alive) setLoading(false);
          }
        })();
        return () => {
          alive = false;
        };
      }, [setUser]);

      const value = useMemo(() => ({
        user,
        setUser,
        pushMeta,
        loading
      }), [user, setUser, pushMeta, loading]);

      return H(AuthContext.Provider, { value }, children);
    }

    function useAuth() {
      const ctx = useContext(AuthContext);
      if (!ctx) {
        throw new Error('useAuth must be used within an AuthProvider.');
      }
      return ctx;
    }

    const COOLDOWN_SECONDS = 60; // 1 minute cooldown for resend

    function AuthModal({ isOpen, onClose, initialMode = 'login', onSuccess }) {
      const { setUser } = useAuth();
      const [mode, setMode] = useState(initialMode);
      const [username, setUsername] = useState('');
      const [email, setEmail] = useState('');
      const [password, setPassword] = useState('');
      const [code, setCode] = useState('');
      const [resetToken, setResetToken] = useState('');
      const [pendingEmail, setPendingEmail] = useState('');
      const [pendingPassword, setPendingPassword] = useState('');
      const [error, setError] = useState('');
      const [info, setInfo] = useState('');
      const [loading, setLoading] = useState(false);
      const [resending, setResending] = useState(false);
      const [cooldownRemaining, setCooldownRemaining] = useState(0);

      // Cooldown timer effect
      useEffect(() => {
        if (cooldownRemaining <= 0) return;
        const timer = setTimeout(() => {
          setCooldownRemaining(prev => prev - 1);
        }, 1000);
        return () => clearTimeout(timer);
      }, [cooldownRemaining]);

      // Start cooldown when entering verify or reset-confirm modes
      useEffect(() => {
        if (mode === 'verify' || mode === 'reset-confirm') {
          setCooldownRemaining(COOLDOWN_SECONDS);
        }
      }, [mode]);

      useEffect(() => {
        if (isOpen) {
          setMode(initialMode);
          setError('');
          setInfo('');
          setUsername('');
          setEmail('');
          setPassword('');
          setCode('');
          setResetToken('');
          setPendingEmail('');
          setPendingPassword('');
          setLoading(false);
          setResending(false);
          setCooldownRemaining(0);
        }
      }, [isOpen, initialMode]);

      useEffect(() => {
        if (!isOpen) return;
        const handleEsc = (e) => {
          if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
      }, [isOpen, onClose]);

      function getFriendlyIssue(issue) {
        const field = issue.path || 'field';
        const msg = (issue.message || '').toLowerCase();

        if (field === 'email') {
          if (msg.includes('invalid') || msg.includes('valid email')) {
            return 'Please enter a valid email address.';
          }
          return 'Please check your email address.';
        }
        if (field === 'password') {
          if (msg.includes('at least') || msg.includes('minimum') || msg.includes('characters')) {
            return 'Password must be at least 8 characters.';
          }
          return 'Please check your password.';
        }
        if (field === 'username') {
          if (msg.includes('at least') || msg.includes('minimum') || msg.includes('characters')) {
            return 'Username must be at least 3 characters.';
          }
          return 'Please check your username.';
        }
        return issue.message || 'Please check your input.';
      }

      function getFriendlyError(message, issues) {
        // Handle validation errors with specific issues
        if (message === 'invalid_request' && issues && issues.length > 0) {
          return issues.map(getFriendlyIssue).join(' ');
        }

        switch (message) {
          case 'auth':
          case 'Invalid credentials':
            return 'Invalid email or password.';
          case 'Email already registered':
            return 'An account with this email already exists. Try logging in instead.';
          case 'Username already taken':
            return 'This username is already taken. Please choose a different one.';
          case 'Registration failed':
            return 'We could not create your account. Please try again.';
          case 'account_banned':
            return 'Your account is currently banned.';
          case 'account_locked':
            return 'Your account is locked. Please contact support.';
          case 'email_unverified':
            return 'Please enter the verification code we emailed you.';
          case 'user_not_found':
            return 'We could not find an account with that email.';
          case 'invalid_code':
            return 'That code did not match. Try again.';
          case 'verification_expired':
            return 'That code expired. We just sent you a new one.';
          case 'verification_not_requested':
            return 'We sent you a new code. Enter the latest one.';
          case 'invalid_token':
            return 'That reset code is invalid. Double-check and try again.';
          case 'token_expired':
            return 'That reset code expired. Request a new one.';
          case 'reset_failed':
            return 'We could not update your password. Try again.';
          case 'invalid_request':
            return 'Please check your input and try again.';
          default:
            return message || 'An error occurred';
        }
      }

      const handleSuccess = useCallback((user) => {
        setPendingEmail('');
        setPendingPassword('');
        setCode('');
        setResetToken('');
        setInfo('');
        setError('');
        setResending(false);
        setUser(user);
        if (typeof onSuccess === 'function') {
          onSuccess(user);
        }
      }, [onSuccess, setUser]);

      async function handleResendCode() {
        if (!pendingEmail || !pendingPassword) {
          setError('Try logging in again to request a fresh code.');
          return;
        }

        setError('');
        setInfo('');
        setResending(true);
        let handled = false;

        try {
          const maybeUser = await api.login(pendingEmail, pendingPassword, { silent: true });
          if (maybeUser) {
            handled = true;
            handleSuccess(maybeUser);
            onClose();
          }
        } catch (err) {
          const message = err?.message;
          const issues = err?.issues;
          if (message === 'email_unverified') {
            setInfo('We just emailed you a new code. It may take a moment to arrive.');
            setCooldownRemaining(COOLDOWN_SECONDS);
            handled = true;
          } else {
            setError(getFriendlyError(message, issues));
            handled = true;
          }
        } finally {
          setResending(false);
        }

        if (!handled) {
          setInfo('We just emailed you a new code. It may take a moment to arrive.');
          setCooldownRemaining(COOLDOWN_SECONDS);
        }
      }

      async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
          if (mode === 'login') {
            const normalizedEmail = email.trim();
            const user = await api.login(normalizedEmail, password);
            handleSuccess(user);
            onClose();
            return;
          }

          if (mode === 'register') {
            const payload = {
              username: username.trim(),
              email: email.trim(),
              password
            };

            const result = await api.register(payload);

            if (result && result.status === 'verification_required') {
              const normalizedEmail = payload.email;
              setPendingEmail(normalizedEmail);
              setPendingPassword(payload.password);
              setMode('verify');
              setInfo('Enter the 6-digit code we emailed to finish creating your account.');
              setCode('');
              return;
            }

            handleSuccess(result);
            onClose();
            return;
          }

          if (mode === 'verify') {
            const targetEmail = pendingEmail || email.trim();
            const verificationCode = code.trim();
            const user = await api.verifyRegistration(targetEmail, verificationCode);
            handleSuccess(user);
            onClose();
            return;
          }

          if (mode === 'reset-request') {
            const normalizedEmail = email.trim();
            await api.requestPasswordReset(normalizedEmail);
            setPendingEmail(normalizedEmail);
            setInfo('We emailed you a reset code. Enter it below to choose a new password.');
            setPassword('');
            setResetToken('');
            setCooldownRemaining(COOLDOWN_SECONDS);
            setMode('reset-confirm');
            return;
          }

          if (mode === 'reset-confirm') {
            const normalizedEmail = (pendingEmail || email).trim();
            await api.confirmPasswordReset(normalizedEmail, resetToken.trim(), password);
            setInfo('Password updated. Log in with your new password.');
            setPassword('');
            setResetToken('');
            setPendingPassword('');
            setMode('login');
            setEmail(normalizedEmail);
            return;
          }
        } catch (err) {
          const message = err?.message;
          const issues = err?.issues;

          if (mode === 'login' && message === 'email_unverified') {
            const normalizedEmail = email.trim();
            setPendingEmail(normalizedEmail);
            setPendingPassword(password);
            setMode('verify');
            setInfo('Enter the 6-digit code we just emailed to finish signing in.');
            setPassword('');
            setUsername('');
            setCode('');
            return;
          }

          if (mode === 'verify') {
            if (message === 'verification_expired' || message === 'verification_not_requested') {
              setInfo('We sent you a new code. Enter the latest one to continue.');
              setError('The previous code is no longer valid.');
              return;
            }

            if (message === 'invalid_code') {
              setError(getFriendlyError(message, issues));
              return;
            }
          }

          if (mode === 'reset-confirm' && (message === 'invalid_token' || message === 'token_expired')) {
            setError(getFriendlyError(message, issues));
            return;
          }

          setError(getFriendlyError(message, issues));
        } finally {
          setLoading(false);
        }
      }

      if (!isOpen) return null;

      const titles = {
        login: 'Welcome Back',
        register: 'Create Account',
        verify: 'Verify Your Email',
        'reset-request': 'Reset Your Password',
        'reset-confirm': 'Choose a New Password'
      };

      const submitLabels = {
        login: 'Log In',
        register: 'Create Account',
        verify: 'Verify & Continue',
        'reset-request': 'Send Reset Code',
        'reset-confirm': 'Set New Password'
      };

      const loadingLabels = {
        login: 'Signing In...',
        register: 'Creating...',
        verify: 'Verifying...',
        'reset-request': 'Sending...',
        'reset-confirm': 'Updating...'
      };

      const verificationEmail = pendingEmail || email.trim();
      const submitText = loading ? (loadingLabels[mode] || 'Loading...') : (submitLabels[mode] || 'Submit');
      const disableSubmit = loading || (mode === 'verify' && code.trim().length !== 6);
      const canResend = !!(pendingEmail && pendingPassword);

      function resetMode() {
        setError('');
        setInfo('');
        setLoading(false);
        setResending(false);
        setPassword('');
        setCode('');
        setResetToken('');
        setPendingEmail('');
        setPendingPassword('');
        setUsername('');
      }

      const registerFields = [
        H('div', { className: 'form-group', key: 'username' },
          H('label', null, 'Username'),
          H('input', {
            type: 'text',
            value: username,
            onChange: (e) => setUsername(e.target.value),
            placeholder: 'johndoe',
            required: true,
            disabled: loading,
            autoComplete: 'username'
          })
        ),
        H('div', { className: 'form-group', key: 'email' },
          H('label', null, 'Email'),
          H('input', {
            type: 'email',
            value: email,
            onChange: (e) => setEmail(e.target.value),
            placeholder: 'john@example.com',
            required: true,
            disabled: loading,
            autoComplete: 'email'
          })
        ),
        H('div', { className: 'form-group', key: 'password' },
          H('label', null, 'Password'),
          H('input', {
            type: 'password',
            value: password,
            onChange: (e) => setPassword(e.target.value),
            placeholder: 'At least 8 characters',
            required: true,
            disabled: loading,
            autoComplete: 'new-password'
          })
        )
      ];

      const loginFields = [
        H('div', { className: 'form-group', key: 'email' },
          H('label', null, 'Email'),
          H('input', {
            type: 'email',
            value: email,
            onChange: (e) => setEmail(e.target.value),
            placeholder: 'john@example.com',
            required: true,
            disabled: loading,
            autoComplete: 'email'
          })
        ),
        H('div', { className: 'form-group', key: 'password' },
          H('label', null, 'Password'),
          H('input', {
            type: 'password',
            value: password,
            onChange: (e) => setPassword(e.target.value),
            placeholder: 'Your password',
            required: true,
            disabled: loading,
            autoComplete: 'current-password'
          })
        ),
        H('div', { style: { textAlign: 'right', marginTop: -8, marginBottom: 8 }, key: 'forgot' },
          H('button', {
            type: 'button',
            className: 'auth-link',
            onClick: () => { resetMode(); setMode('reset-request'); }
          }, 'Forgot password?')
        )
      ];

      const verifyFields = [
        H('p', { className: 'auth-description', key: 'desc' },
          `Enter the 6-digit code we sent to ${verificationEmail || 'your email'}.`
        ),
        H('div', { className: 'form-group', key: 'code' },
          H('label', null, 'Verification Code'),
          H('input', {
            type: 'text',
            inputMode: 'numeric',
            autoComplete: 'one-time-code',
            value: code,
            onChange: (e) => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6)),
            placeholder: '123456',
            required: true,
            disabled: loading,
            style: { letterSpacing: '0.3em', textAlign: 'center', fontSize: 20 }
          })
        )
      ];

      const resetRequestFields = [
        H('p', { className: 'auth-description', key: 'desc' },
          'Enter your email and we\'ll send you a code to reset your password.'
        ),
        H('div', { className: 'form-group', key: 'email' },
          H('label', null, 'Email'),
          H('input', {
            type: 'email',
            value: email,
            onChange: (e) => setEmail(e.target.value),
            placeholder: 'john@example.com',
            required: true,
            disabled: loading,
            autoComplete: 'email'
          })
        )
      ];

      const resetConfirmFields = [
        H('p', { className: 'auth-description', key: 'desc' },
          `Enter the code we sent to ${pendingEmail || email}, then choose a new password.`
        ),
        H('div', { className: 'form-group', key: 'token' },
          H('label', null, 'Reset Code'),
          H('input', {
            type: 'text',
            inputMode: 'numeric',
            value: resetToken,
            onChange: (e) => setResetToken(e.target.value.replace(/[^0-9]/g, '').slice(0, 6)),
            placeholder: '123456',
            required: true,
            disabled: loading,
            autoComplete: 'one-time-code',
            style: { letterSpacing: '0.3em', textAlign: 'center', fontSize: 20 }
          })
        ),
        H('div', { className: 'form-group', key: 'password' },
          H('label', null, 'New Password'),
          H('input', {
            type: 'password',
            value: password,
            onChange: (e) => setPassword(e.target.value),
            placeholder: 'At least 8 characters',
            required: true,
            disabled: loading,
            autoComplete: 'new-password'
          })
        )
      ];

      let formFields = null;
      if (mode === 'register') formFields = registerFields;
      else if (mode === 'verify') formFields = verifyFields;
      else if (mode === 'reset-request') formFields = resetRequestFields;
      else if (mode === 'reset-confirm') formFields = resetConfirmFields;
      else formFields = loginFields;

      return ReactDOM.createPortal(
        H('div', {
          className: 'auth-modal-overlay'
        },
          H('div', { className: 'auth-modal' },
            H('button', { className: 'auth-modal-close', onClick: onClose }, '\u00D7'),
            H('div', { className: 'auth-modal-header' },
              H('h2', null, titles[mode] || 'Account')
            ),
            H('div', { className: 'auth-modal-body' },
              info && H('div', { className: 'auth-info' }, info),
              error && H('div', { className: 'auth-error' }, error),
              H('form', { onSubmit: handleSubmit },
                formFields,
                H('button', {
                  type: 'submit',
                  className: 'auth-submit',
                  disabled: disableSubmit
                }, submitText),
                mode === 'login' && H('div', { className: 'auth-footer' },
                  "Don't have an account? ",
                  H('button', {
                    type: 'button',
                    onClick: () => { resetMode(); setMode('register'); }
                  }, 'Sign up')
                ),
                mode === 'register' && H('div', { className: 'auth-footer' },
                  'Already have an account? ',
                  H('button', {
                    type: 'button',
                    onClick: () => { resetMode(); setMode('login'); }
                  }, 'Log in')
                ),
                mode === 'verify' && H('div', { className: 'auth-footer', style: { display: 'flex', gap: 16, justifyContent: 'center' } },
                  H('button', {
                    type: 'button',
                    onClick: handleResendCode,
                    disabled: resending || !canResend || cooldownRemaining > 0,
                    style: { opacity: resending || !canResend || cooldownRemaining > 0 ? 0.5 : 1 }
                  }, resending ? 'Sending...' : cooldownRemaining > 0 ? `Resend (${cooldownRemaining}s)` : 'Resend code'),
                  H('button', {
                    type: 'button',
                    onClick: () => { resetMode(); setMode('login'); }
                  }, 'Back to login')
                ),
                mode === 'reset-request' && H('div', { className: 'auth-footer' },
                  'Remembered it? ',
                  H('button', {
                    type: 'button',
                    onClick: () => { resetMode(); setMode('login'); }
                  }, 'Back to login')
                ),
                mode === 'reset-confirm' && H('div', { className: 'auth-footer' },
                  H('button', {
                    type: 'button',
                    onClick: () => { resetMode(); setMode('reset-request'); },
                    disabled: cooldownRemaining > 0,
                    style: { opacity: cooldownRemaining > 0 ? 0.5 : 1 }
                  }, cooldownRemaining > 0 ? `Need a new code? (${cooldownRemaining}s)` : 'Need a new code?')
                )
              )
            )
          )
        ),
        document.body
      );
    }

    return {
      AuthProvider,
      useAuth,
      AuthModal
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.auth = {
    createAuthFeature
  };
})();
