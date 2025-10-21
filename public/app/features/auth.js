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

  function createAuthFeature({ api, ReactDOM }) {
    if (!api) {
      throw new Error('Auth feature requires an API client.');
    }
    if (!ReactDOM) {
      throw new Error('Auth feature requires ReactDOM.');
    }

    const AuthContext = createContext(null);

    function AuthProvider({ children }) {
      const [user, setUserState] = useState(null);
      const [pushMeta, setPushMeta] = useState({ available: false, vapidPublicKey: null });

      const setUser = useCallback((next) => {
        setUserState(next || null);
        setPushMeta(normalizePushMeta(next));
      }, []);

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
          }
        })();
        return () => {
          alive = false;
        };
      }, [setUser]);

      const value = useMemo(() => ({
        user,
        setUser,
        pushMeta
      }), [user, setUser, pushMeta]);

      return H(AuthContext.Provider, { value }, children);
    }

    function useAuth() {
      const ctx = useContext(AuthContext);
      if (!ctx) {
        throw new Error('useAuth must be used within an AuthProvider.');
      }
      return ctx;
    }

    function AuthModal({ isOpen, onClose, initialMode = 'login', onSuccess }) {
      const { setUser } = useAuth();
      const [mode, setMode] = useState(initialMode);
      const [username, setUsername] = useState('');
      const [email, setEmail] = useState('');
      const [phone, setPhone] = useState('');
      const [password, setPassword] = useState('');
      const [code, setCode] = useState('');
      const [resetToken, setResetToken] = useState('');
      const [pendingEmail, setPendingEmail] = useState('');
      const [pendingPassword, setPendingPassword] = useState('');
      const [pendingPhone, setPendingPhone] = useState('');
      const [error, setError] = useState('');
      const [info, setInfo] = useState('');
      const [loading, setLoading] = useState(false);
      const [resending, setResending] = useState(false);

      useEffect(() => {
        if (isOpen) {
          setMode(initialMode);
          setError('');
          setInfo('');
          setUsername('');
          setEmail('');
          setPhone('');
          setPassword('');
          setCode('');
          setResetToken('');
          setPendingEmail('');
          setPendingPassword('');
          setPendingPhone('');
          setLoading(false);
          setResending(false);
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

      function getFriendlyError(message) {
        switch (message) {
          case 'auth':
          case 'Invalid credentials':
            return 'Invalid email or password.';
          case 'account_banned':
            return 'Your account is currently banned.';
          case 'account_locked':
            return 'Your account is locked. Please contact support.';
          case 'phone_unverified':
            return 'Please verify the code we texted to your phone.';
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
          default:
            return message || 'An error occurred';
        }
      }

      const handleSuccess = useCallback((user) => {
        setPendingEmail('');
        setPendingPassword('');
        setPendingPhone('');
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
          if (message === 'phone_unverified') {
            setInfo('We just sent you a new code. It may take a moment to arrive.');
            handled = true;
          } else {
            setError(getFriendlyError(message));
            handled = true;
          }
        } finally {
          setResending(false);
        }

        if (!handled) {
          setInfo('We just sent you a new code. It may take a moment to arrive.');
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
              password,
              phone: phone.trim()
            };

            const result = await api.register(payload);

            if (result && result.verification_required) {
              setPendingEmail(payload.email);
              setPendingPassword(password);
              setPendingPhone(payload.phone);
              setEmail(payload.email);
              setInfo('Enter the 6-digit code we texted to finish setting up your account.');
              setPassword('');
              setUsername('');
              setPhone('');
              setMode('verify');
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
            setPendingPhone('');
            setMode('login');
            setEmail(normalizedEmail);
            return;
          }
        } catch (err) {
          const message = err?.message;

          if (mode === 'login' && message === 'phone_unverified') {
            const normalizedEmail = email.trim();
            setPendingEmail(normalizedEmail);
            setPendingPassword(password);
            setPendingPhone('');
            setMode('verify');
            setInfo('Enter the 6-digit code we just texted to finish signing in.');
            setPassword('');
            setUsername('');
            setPhone('');
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
              setError(getFriendlyError(message));
              return;
            }
          }

          if (mode === 'reset-confirm' && (message === 'invalid_token' || message === 'token_expired')) {
            setError(getFriendlyError(message));
            return;
          }

          setError(getFriendlyError(message));
        } finally {
          setLoading(false);
        }
      }

      if (!isOpen) return null;

      const titles = {
        login: 'Welcome Back',
        register: 'Create Account',
        verify: 'Verify Your Phone',
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
      const displayPhone = pendingPhone || (phone ? phone.trim() : 'your phone on file');
      const submitText = loading ? (loadingLabels[mode] || 'Loading...') : (submitLabels[mode] || 'Submit');
      const disableSubmit = loading || (mode === 'verify' && code.trim().length !== 6);
      const canResend = !!(pendingEmail && pendingPassword);

      const registerFields = [
        H('div', { style: { marginBottom: '16px' } },
          H('label', { style: { display: 'block', marginBottom: '6px', fontWeight: '600' } }, 'Username'),
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
        H('div', { style: { marginBottom: '16px' } },
          H('label', { style: { display: 'block', marginBottom: '6px', fontWeight: '600', color: '#111' } }, 'Email'),
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
        H('div', { style: { marginBottom: '16px' } },
          H('label', { style: { display: 'block', marginBottom: '6px', fontWeight: '600' } }, 'Mobile phone'),
          H('input', {
            type: 'tel',
            value: phone,
            onChange: (e) => setPhone(e.target.value),
            placeholder: '+15551234567',
            required: true,
            disabled: loading,
            autoComplete: 'tel',
            inputMode: 'tel'
          })
        ),
        H('div', { style: { marginBottom: '16px' } },
          H('label', { style: { display: 'block', marginBottom: '6px', fontWeight: '600' } }, 'Password'),
          H('input', {
            type: 'password',
            value: password,
            onChange: (e) => setPassword(e.target.value),
            placeholder: '--------',
            required: true,
            disabled: loading,
            autoComplete: 'new-password'
          })
        ),
        H('p', {
          style: {
            marginTop: '-4px',
            marginBottom: '16px',
            color: '#6b7280',
            fontSize: '14px',
            lineHeight: '20px'
          }
        }, 'We will text a 6-digit code to verify your phone before enabling your account.')
      ];

      const loginFields = [
        H('div', { style: { marginBottom: '16px' } },
          H('label', { style: { display: 'block', marginBottom: '6px', fontWeight: '600', color: '#111' } }, 'Email'),
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
        H('div', { style: { marginBottom: '8px' } },
          H('label', { style: { display: 'block', marginBottom: '6px', fontWeight: '600' } }, 'Password'),
          H('input', {
            type: 'password',
            value: password,
            onChange: (e) => setPassword(e.target.value),
            placeholder: '--------',
            required: true,
            disabled: loading,
            autoComplete: 'current-password'
          })
        ),
        H('div', {
          style: {
            textAlign: 'right',
            marginTop: '4px',
            marginBottom: '12px'
          }
        },
          H('button', {
            type: 'button',
            onClick: () => {
              setMode('reset-request');
              setError('');
              setInfo('');
              setLoading(false);
              setResending(false);
              setPassword('');
              setCode('');
              setResetToken('');
              setPendingEmail('');
              setPendingPassword('');
              setPendingPhone('');
              setUsername('');
              setPhone('');
            },
            style: {
              color: '#111',
              background: 'none',
              border: 'none',
              textDecoration: 'underline',
              cursor: 'pointer',
              fontWeight: '600',
              fontSize: '14px'
            }
          }, 'Forgot password?')
        )
      ];

      const verifyFields = [
        H('p', {
          style: {
            marginBottom: '16px',
            color: '#374151',
            fontSize: '14px',
            lineHeight: '20px'
          }
        }, `Enter the 6-digit code we sent to ${displayPhone} for ${verificationEmail || 'your account'}.`),
        H('div', { style: { marginBottom: '16px' } },
          H('label', { style: { display: 'block', marginBottom: '6px', fontWeight: '600' } }, 'Verification code'),
          H('input', {
            type: 'text',
            inputMode: 'numeric',
            autoComplete: 'one-time-code',
            value: code,
            onChange: (e) => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6)),
            placeholder: '123456',
            required: true,
            disabled: loading
          })
        )
      ];

      const resetRequestFields = [
        H('p', {
          style: {
            marginBottom: '16px',
            color: '#374151',
            fontSize: '14px',
            lineHeight: '20px'
          }
        }, 'Enter your email and we will send you a reset code.'),
        H('div', { style: { marginBottom: '16px' } },
          H('label', { style: { display: 'block', marginBottom: '6px', fontWeight: '600', color: '#111' } }, 'Email'),
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
        H('p', {
          style: {
            marginBottom: '16px',
            color: '#374151',
            fontSize: '14px',
            lineHeight: '20px'
          }
        }, `Enter the code we emailed to ${pendingEmail || email}. Then choose a new password.`),
        H('div', { style: { marginBottom: '16px' } },
          H('label', { style: { display: 'block', marginBottom: '6px', fontWeight: '600' } }, 'Reset code'),
          H('input', {
            type: 'text',
            value: resetToken,
            onChange: (e) => setResetToken(e.target.value.trim()),
            placeholder: 'Paste your reset code',
            required: true,
            disabled: loading,
            autoComplete: 'one-time-code'
          })
        ),
        H('div', { style: { marginBottom: '16px' } },
          H('label', { style: { display: 'block', marginBottom: '6px', fontWeight: '600' } }, 'New password'),
          H('input', {
            type: 'password',
            value: password,
            onChange: (e) => setPassword(e.target.value),
            placeholder: '--------',
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
          className: 'modal open',
          onClick: (e) => {
            if (e.target.classList.contains('modal')) onClose();
          }
        },
          H('div', {
            className: 'modal-inner',
            style: { maxWidth: '420px', padding: '32px', background: '#fff', color: '#111' }
          },
            H('button', { className: 'close', onClick: onClose }, 'x'),
            H('h2', { style: { margin: '0 0 24px', fontSize: '28px', color: '#111' } }, titles[mode] || 'Account'),
            info && H('div', {
              style: {
                background: '#eff6ff',
                color: '#1d4ed8',
                padding: '12px 16px',
                borderRadius: '8px',
                marginBottom: '16px',
                fontSize: '14px',
                lineHeight: '20px'
              }
            }, info),
            H('form', { onSubmit: handleSubmit },
              formFields,
              error && H('div', { style: { color: '#be123c', margin: '12px 0' } }, error),
              H('button', {
                type: 'submit',
                className: 'btn primary',
                style: { width: '100%', marginTop: '16px' },
                disabled: disableSubmit
              }, submitText),
              mode === 'login' && H('div', { style: { textAlign: 'center', marginTop: '20px', color: '#6b7280' } },
                "Don't have an account? ",
                H('button', {
                  type: 'button',
                  onClick: () => {
                    setMode('register');
                    setError('');
                    setInfo('');
                    setLoading(false);
                    setResending(false);
                    setPassword('');
                    setCode('');
                    setResetToken('');
                    setPendingEmail('');
                    setPendingPassword('');
                    setPendingPhone('');
                    setUsername('');
                    setPhone('');
                  },
                  style: {
                    color: '#111',
                    background: 'none',
                    border: 'none',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    fontWeight: '600'
                  }
                }, 'Register')
              ),
              mode === 'register' && H('div', { style: { textAlign: 'center', marginTop: '20px', color: '#6b7280' } },
                'Already have an account? ',
                H('button', {
                  type: 'button',
                  onClick: () => {
                    setMode('login');
                    setError('');
                    setInfo('');
                    setLoading(false);
                    setResending(false);
                    setPassword('');
                    setCode('');
                    setResetToken('');
                    setPendingEmail('');
                    setPendingPassword('');
                    setPendingPhone('');
                    setUsername('');
                    setPhone('');
                  },
                  style: {
                    color: '#111',
                    background: 'none',
                    border: 'none',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    fontWeight: '600'
                  }
                }, 'Log In')
              ),
              mode === 'verify' && H('div', {
                style: {
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: '20px',
                  gap: '12px'
                }
              },
                H('button', {
                  type: 'button',
                  onClick: handleResendCode,
                  disabled: resending || !canResend,
                  className: 'btn',
                  style: {
                    flex: '1',
                    opacity: resending || !canResend ? 0.6 : 1,
                    cursor: resending || !canResend ? 'not-allowed' : 'pointer'
                  }
                }, resending ? 'Sending...' : 'Resend code'),
                H('button', {
                  type: 'button',
                  onClick: () => {
                    setMode('login');
                    setError('');
                    setInfo('');
                    setLoading(false);
                    setResending(false);
                    setPassword('');
                    setCode('');
                    setResetToken('');
                    setPendingEmail('');
                    setPendingPassword('');
                    setPendingPhone('');
                    setUsername('');
                    setPhone('');
                  },
                  className: 'btn',
                  style: { flex: '1' }
                }, 'Back to login')
              ),
              mode === 'reset-request' && H('div', { style: { textAlign: 'center', marginTop: '20px', color: '#6b7280' } },
                'Remembered it? ',
                H('button', {
                  type: 'button',
                  onClick: () => {
                    setMode('login');
                    setError('');
                    setInfo('');
                    setLoading(false);
                    setResending(false);
                    setPassword('');
                    setCode('');
                    setResetToken('');
                    setPendingEmail('');
                    setPendingPassword('');
                    setPendingPhone('');
                    setUsername('');
                    setPhone('');
                  },
                  style: {
                    color: '#111',
                    background: 'none',
                    border: 'none',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    fontWeight: '600'
                  }
                }, 'Back to login')
              ),
              mode === 'reset-confirm' && H('div', { style: { textAlign: 'center', marginTop: '20px', color: '#6b7280' } },
                H('button', {
                  type: 'button',
                  onClick: () => {
                    setMode('reset-request');
                    setError('');
                    setInfo('');
                    setLoading(false);
                    setResending(false);
                    setPassword('');
                    setCode('');
                    setResetToken('');
                    setPendingEmail('');
                    setPendingPassword('');
                    setPendingPhone('');
                    setUsername('');
                    setPhone('');
                  },
                  style: {
                    color: '#111',
                    background: 'none',
                    border: 'none',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    fontWeight: '600'
                  }
                }, 'Need a new code? Start over')
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
