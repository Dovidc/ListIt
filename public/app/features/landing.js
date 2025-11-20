(() => {
    const {
        useState,
        useEffect,
        useCallback
    } = React;

    const H = (tag, props, ...children) => React.createElement(tag, props || null, ...children);

    function createLandingFeature({ api, React }) {
        if (!api) throw new Error('Landing feature requires API.');
        if (!React) throw new Error('Landing feature requires React.');

        const ICONS = [
            // Camera
            'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
            // Shopping Bag
            'M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z M3 6h18 M16 10a4 4 0 0 1-8 0',
            // Tag
            'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z M7 7h.01',
            // Map Pin
            'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
            // Heart
            'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z',
            // Star
            'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
            // Gift
            'M20 12v10H4V12 M2 7h20v5H2z M12 22V7 M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z',
            // Watch
            'M12 9v3l2 2 M18 13a6 6 0 1 1-12 0 6 6 0 0 1 12 0z M16.5 17.5l1.5 1.5 M7.5 6.5L6 5'
        ];

        function AnimatedBackground() {
            const rows = Array.from({ length: 10 }).map((_, i) => {
                const direction = i % 2 === 0 ? 'normal' : 'reverse';
                const rowIcons = [...ICONS, ...ICONS, ...ICONS, ...ICONS];
                return { id: i, direction, icons: rowIcons };
            });

            return H('div', {
                style: {
                    position: 'fixed',
                    inset: '-50%',
                    width: '200%',
                    height: '200%',
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    zIndex: 0,
                    transform: 'rotate(-12deg)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    gap: '50px',
                    opacity: 0.15,
                    pointerEvents: 'none'
                }
            },
                H('style', null, `
                    @keyframes slide-row {
                        0% { transform: translateX(0); }
                        100% { transform: translateX(-50%); }
                    }
                `),
                rows.map(row => H('div', {
                    key: row.id,
                    style: {
                        display: 'flex',
                        gap: '70px',
                        animation: `slide-row ${40 + (row.id * 5)}s linear infinite ${row.direction}`,
                        width: 'max-content'
                    }
                },
                    row.icons.map((path, idx) => H('svg', {
                        key: idx,
                        viewBox: '0 0 24 24',
                        width: 52,
                        height: 52,
                        fill: 'none',
                        stroke: '#1f2937',
                        strokeWidth: 1.5,
                        strokeLinecap: 'round',
                        strokeLinejoin: 'round'
                    }, H('path', { d: path })))
                ))
            );
        }

        function LandingPage({ onLogin }) {
            const [mode, setMode] = useState('login');
            const [email, setEmail] = useState('');
            const [password, setPassword] = useState('');
            const [username, setUsername] = useState('');
            const [code, setCode] = useState('');
            const [resetToken, setResetToken] = useState('');
            const [pendingEmail, setPendingEmail] = useState('');
            const [pendingPassword, setPendingPassword] = useState('');
            const [error, setError] = useState('');
            const [info, setInfo] = useState('');
            const [loading, setLoading] = useState(false);
            const [resending, setResending] = useState(false);

            const switchMode = (newMode) => {
                setMode(newMode);
                setError('');
                setInfo('');
                setLoading(false);
                setResending(false);
                if (newMode === 'login' || newMode === 'register') {
                    setPassword('');
                }
            };

            function getFriendlyError(message) {
                switch (message) {
                    case 'auth':
                    case 'Invalid credentials':
                        return 'Invalid email or password.';
                    case 'Email already registered':
                        return 'An account with this email already exists.';
                    case 'Username already taken':
                        return 'This username is already taken.';
                    case 'Registration failed':
                        return 'Could not create account. Try again.';
                    case 'email_unverified':
                        return 'Please verify your email.';
                    case 'user_not_found':
                        return 'No account found with that email.';
                    case 'invalid_code':
                        return 'Invalid code. Please try again.';
                    case 'verification_expired':
                        return 'Code expired. We sent a new one.';
                    default:
                        return message || 'An error occurred.';
                }
            }

            async function handleSubmit(e) {
                e.preventDefault();
                setError('');
                setLoading(true);

                try {
                    if (mode === 'login') {
                        const user = await api.login(email.trim(), password);
                        onLogin?.(user);
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
                            setPendingEmail(payload.email);
                            setPendingPassword(payload.password);
                            setMode('verify');
                            setInfo('Enter the 6-digit code we emailed you.');
                            setCode('');
                            return;
                        }
                        onLogin?.(result);
                        return;
                    }

                    if (mode === 'verify') {
                        const targetEmail = pendingEmail || email.trim();
                        const user = await api.verifyRegistration(targetEmail, code.trim());
                        onLogin?.(user);
                        return;
                    }

                    if (mode === 'reset-request') {
                        await api.requestPasswordReset(email.trim());
                        setPendingEmail(email.trim());
                        setMode('reset-confirm');
                        setInfo('We emailed you a code. Enter it below.');
                        setResetToken('');
                        setPassword('');
                        return;
                    }

                    if (mode === 'reset-confirm') {
                        await api.confirmPasswordReset(pendingEmail || email.trim(), resetToken.trim(), password);
                        setMode('login');
                        setInfo('Password updated. Please log in.');
                        setPassword('');
                        return;
                    }

                } catch (err) {
                    const msg = err?.message;
                    if (mode === 'login' && msg === 'email_unverified') {
                        setPendingEmail(email.trim());
                        setPendingPassword(password);
                        setMode('verify');
                        setInfo('Please verify your email.');
                        return;
                    }
                    setError(getFriendlyError(msg));
                } finally {
                    setLoading(false);
                }
            }

            const inputStyle = {
                width: '100%',
                padding: '14px 16px',
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                background: '#f8fafc',
                fontSize: '16px',
                marginBottom: '16px',
                outline: 'none',
                transition: 'all 0.2s ease'
            };

            const btnStyle = {
                width: '100%',
                padding: '14px',
                borderRadius: '12px',
                border: 'none',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: '#fff',
                fontSize: '16px',
                fontWeight: '700',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.8 : 1,
                marginTop: '8px',
                boxShadow: '0 4px 12px rgba(102, 126, 234, 0.3)'
            };

            const linkBtnStyle = {
                background: 'none',
                border: 'none',
                color: '#667eea',
                fontWeight: '600',
                cursor: 'pointer',
                padding: 0,
                fontSize: '14px'
            };

            return H('div', {
                style: {
                    position: 'fixed',
                    inset: 0,
                    background: '#f8fafc',
                    zIndex: 9999,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    padding: '20px'
                }
            },
                H(AnimatedBackground),

                H('div', {
                    style: {
                        position: 'relative',
                        zIndex: 10,
                        width: '100%',
                        maxWidth: '420px',
                        background: 'rgba(255, 255, 255, 0.98)',
                        backdropFilter: 'blur(20px)',
                        borderRadius: '28px',
                        padding: '40px 32px',
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                        maxHeight: '90vh',
                        overflowY: 'auto'
                    }
                },
                    H('div', {
                        style: {
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            textAlign: 'center',
                            marginBottom: '32px'
                        }
                    },
                        H('div', {
                            style: {
                                width: 72,
                                height: 72,
                                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                borderRadius: 18,
                                marginBottom: 20,
                                display: 'grid',
                                placeItems: 'center',
                                color: '#fff',
                                fontSize: 36,
                                fontWeight: 800,
                                boxShadow: '0 10px 25px -5px rgba(102, 126, 234, 0.4)'
                            }
                        }, 'T'),
                        H('h1', {
                            style: {
                                fontSize: '30px',
                                fontWeight: '800',
                                margin: '0 0 8px',
                                letterSpacing: '-0.02em',
                                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                                backgroundClip: 'text'
                            }
                        }, 'Trovelr'),
                        H('p', {
                            style: {
                                fontSize: '15px',
                                color: '#64748b',
                                margin: 0,
                                lineHeight: 1.6
                            }
                        }, 'The premium marketplace for unique finds.')
                    ),

                    H('div', null,
                        H('h2', {
                            style: {
                                fontSize: '22px',
                                fontWeight: '700',
                                marginBottom: '24px',
                                textAlign: 'center',
                                color: '#1f2937'
                            }
                        },
                            mode === 'login' ? 'Welcome back' :
                                mode === 'register' ? 'Create account' :
                                    mode === 'verify' ? 'Verify email' :
                                        'Reset password'
                        ),

                        info && H('div', {
                            style: {
                                padding: '12px 16px',
                                background: '#eff6ff',
                                color: '#1d4ed8',
                                borderRadius: '12px',
                                marginBottom: '20px',
                                fontSize: '14px',
                                lineHeight: 1.5,
                                textAlign: 'center'
                            }
                        }, info),

                        error && H('div', {
                            style: {
                                padding: '12px 16px',
                                background: '#fef2f2',
                                color: '#b91c1c',
                                borderRadius: '12px',
                                marginBottom: '20px',
                                fontSize: '14px',
                                lineHeight: 1.5,
                                textAlign: 'center'
                            }
                        }, error),

                        H('form', { onSubmit: handleSubmit },
                            mode === 'register' && H('input', {
                                type: 'text',
                                placeholder: 'Username',
                                value: username,
                                onChange: e => setUsername(e.target.value),
                                style: inputStyle,
                                required: true,
                                autoCapitalize: 'none'
                            }),

                            (mode === 'login' || mode === 'register' || mode === 'reset-request') && H('input', {
                                type: 'email',
                                placeholder: 'Email address',
                                value: email,
                                onChange: e => setEmail(e.target.value),
                                style: inputStyle,
                                required: true,
                                autoCapitalize: 'none',
                                autoComplete: 'email'
                            }),

                            (mode === 'login' || mode === 'register' || mode === 'reset-confirm') && H('input', {
                                type: 'password',
                                placeholder: mode === 'reset-confirm' ? 'New password' : 'Password',
                                value: password,
                                onChange: e => setPassword(e.target.value),
                                style: inputStyle,
                                required: true
                            }),

                            (mode === 'verify') && H('input', {
                                type: 'text',
                                placeholder: '6-digit code',
                                value: code,
                                onChange: e => setCode(e.target.value),
                                style: inputStyle,
                                inputMode: 'numeric',
                                required: true
                            }),

                            (mode === 'reset-confirm') && H('input', {
                                type: 'text',
                                placeholder: 'Reset code',
                                value: resetToken,
                                onChange: e => setResetToken(e.target.value),
                                style: inputStyle,
                                required: true
                            }),

                            H('button', {
                                type: 'submit',
                                style: btnStyle,
                                disabled: loading
                            }, loading ? 'Please wait...' : 'Continue'),

                            H('div', {
                                style: {
                                    marginTop: '24px',
                                    display: 'flex',
                                    justifyContent: 'center',
                                    gap: '8px',
                                    fontSize: '14px',
                                    color: '#64748b'
                                }
                            },
                                mode === 'login' && [
                                    H('span', { key: 't' }, "Don't have an account?"),
                                    H('button', {
                                        key: 'b',
                                        type: 'button',
                                        style: linkBtnStyle,
                                        onClick: () => switchMode('register')
                                    }, 'Sign up')
                                ],
                                mode === 'register' && [
                                    H('span', { key: 't' }, "Already have an account?"),
                                    H('button', {
                                        key: 'b',
                                        type: 'button',
                                        style: linkBtnStyle,
                                        onClick: () => switchMode('login')
                                    }, 'Log in')
                                ],
                                (mode === 'verify' || mode.startsWith('reset')) && H('button', {
                                    type: 'button',
                                    style: linkBtnStyle,
                                    onClick: () => switchMode('login')
                                }, 'Back to login')
                            ),

                            mode === 'login' && H('div', {
                                style: { textAlign: 'center', marginTop: '16px' }
                            },
                                H('button', {
                                    type: 'button',
                                    style: { ...linkBtnStyle, color: '#64748b', fontWeight: '400' },
                                    onClick: () => switchMode('reset-request')
                                }, 'Forgot password?')
                            )
                        )
                    )
                )
            );
        }

        return { LandingPage };
    }

    window.ListItApp = window.ListItApp || {};
    window.ListItApp.features = window.ListItApp.features || {};
    window.ListItApp.features.landing = { createLandingFeature };
})();
