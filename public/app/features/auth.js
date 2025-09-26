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
      const [password, setPassword] = useState('');
      const [error, setError] = useState('');
      const [loading, setLoading] = useState(false);

      useEffect(() => {
        if (isOpen) {
          setMode(initialMode);
          setError('');
          setUsername('');
          setEmail('');
          setPassword('');
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

      const handleSuccess = useCallback((user) => {
        setUser(user);
        if (typeof onSuccess === 'function') {
          onSuccess(user);
        }
      }, [onSuccess, setUser]);

      async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
          let user;
          if (mode === 'login') {
            user = await api.login(email, password);
          } else {
            user = await api.register({ username, email, password });
          }
          handleSuccess(user);
          onClose();
        } catch (err) {
          setError(err?.message || 'An error occurred');
        } finally {
          setLoading(false);
        }
      }

      if (!isOpen) return null;

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
            H('h2', { style: { margin: '0 0 24px', fontSize: '28px', color: '#111' } },
              mode === 'login' ? 'Welcome Back' : 'Create Account'
            ),
            H('form', { onSubmit: handleSubmit },
              mode === 'register' && H('div', { style: { marginBottom: '16px' } },
                H('label', { style: { display: 'block', marginBottom: '6px', fontWeight: '600' } }, 'Username'),
                H('input', {
                  type: 'text',
                  value: username,
                  onChange: (e) => setUsername(e.target.value),
                  placeholder: 'johndoe',
                  required: true,
                  disabled: loading
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
                  disabled: loading
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
                  disabled: loading
                })
              ),
              error && H('div', { style: { color: '#be123c', margin: '12px 0' } }, error),
              H('button', {
                type: 'submit',
                className: 'btn primary',
                style: { width: '100%', marginTop: '16px' },
                disabled: loading
              }, loading ? 'Loading...' : (mode === 'login' ? 'Log In' : 'Create Account')),
              H('div', { style: { textAlign: 'center', marginTop: '20px', color: '#6b7280' } },
                mode === 'login'
                  ? H(React.Fragment, null,
                      "Don't have an account? ",
                      H('button', {
                        type: 'button',
                        onClick: () => setMode('register'),
                        style: {
                          color: '#111',
                          background: 'none',
                          border: 'none',
                          textDecoration: 'underline',
                          cursor: 'pointer',
                          fontWeight: '600'
                        }
                      }, 'Register')
                    )
                  : H(React.Fragment, null,
                      'Already have an account? ',
                      H('button', {
                        type: 'button',
                        onClick: () => setMode('login'),
                        style: {
                          color: '#111',
                          background: 'none',
                          border: 'none',
                          textDecoration: 'underline',
                          cursor: 'pointer',
                          fontWeight: '600'
                        }
                      }, 'Log In')
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
