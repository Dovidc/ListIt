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
            // Car (Sedan)
            'M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2 M2 17h2 M7 17h10 M14 17h2 M12 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4 M5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4',

            // Camera
            'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2v11z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',

            // Chair (Armchair)
            'M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3 M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v2H7v-2a2 2 0 0 0-4 0v5Z M5 18v2 M19 18v2',

            // Couch (Sofa)
            'M20 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v3 M2 11v5a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v2H6v-2a2 2 0 0 0-4 0Z M4 18v2 M20 18v2',

            // Beaker (Flask)
            'M10 2v7.31l-4.89 9.89a2 2 0 0 0 1.79 2.8H17.1a2 2 0 0 0 1.79-2.8L14 9.31V2 M8 14h8 M9 2h6',

            // Bench
            'M15 13v5 M9 13v5 M4 13h16L18 6H6l-2 7z M4 13v5 M20 13v5',

            // Watch
            'M12 22c4.97 0 9-4.03 9-9s-4.03-9-9-9-9 4.03-9 9 4.03 9 9 9z M12 6v6l4 2',

            // Laptop
            'M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16',

            // Shovel
            'M2 22l10-10 M13 11l3-3a2 2 0 0 1 2.8 2.8l-3 3 M17 7l2-2',

            // Jacket (Shirt)
            'M20.38 3.4a2 2 0 0 0-1.2-1.2a2 2 0 0 0-1.44.26L12 6L6.26 2.46A2 2 0 0 0 4.82 2.2a2 2 0 0 0-1.2 1.2a2 2 0 0 0 .24 1.5L6 8v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8l2.14-3.1a2 2 0 0 0 .24-1.5z',

            // TV
            'M20 4h-5.5l2-2 M9.5 2l2 2 M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',

            // Shoes (Sneaker)
            'M16 2l-2 6H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6l-2-6h-2z',

            // Headphones
            'M3 18v-6a9 9 0 0 1 18 0v6 M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z'
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
                    background: 'linear-gradient(135deg, #3b82f6 0%, #1e40af 100%)',
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
                        strokeWidth: 2,
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
                background: 'linear-gradient(135deg, #3b82f6 0%, #1e40af 100%)',
                color: '#fff',
                fontSize: '16px',
                fontWeight: '700',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.8 : 1,
                marginTop: '8px',
                boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)'
            };

            const linkBtnStyle = {
                background: 'none',
                border: 'none',
                color: '#2563eb',
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
                        H('svg', {
                            viewBox: '0 0 100 100',
                            width: 72,
                            height: 72,
                            style: { marginBottom: 16 },
                            xmlns: 'http://www.w3.org/2000/svg'
                        },
                            H('defs', null,
                                H('linearGradient', { id: 'bagGradient', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
                                    H('stop', { offset: '0%', stopColor: '#3b82f6' }),
                                    H('stop', { offset: '100%', stopColor: '#1e3a8a' })
                                ),
                                H('linearGradient', { id: 'pinGradient', x1: '0%', y1: '0%', x2: '50%', y2: '100%' },
                                    H('stop', { offset: '0%', stopColor: '#60a5fa' }),
                                    H('stop', { offset: '50%', stopColor: '#2563eb' }),
                                    H('stop', { offset: '100%', stopColor: '#1e40af' })
                                )
                            ),
                            // Shopping bag body - wider, more rectangular
                            H('path', {
                                d: 'M18 28 C16 28 14 30 14 32 L14 88 C14 93 18 97 23 97 L77 97 C82 97 86 93 86 88 L86 32 C86 30 84 28 82 28 Z',
                                fill: 'url(#bagGradient)'
                            }),
                            // Bag handles - rope style coming from inside
                            H('path', {
                                d: 'M32 28 L32 20 C32 12 40 6 50 6 C60 6 68 12 68 20 L68 28',
                                fill: 'none',
                                stroke: '#1e3a8a',
                                strokeWidth: '4',
                                strokeLinecap: 'round'
                            }),
                            // Pin inside bag - moved down
                            H('path', {
                                d: 'M50 38 C40 38 33 46 33 55 C33 64 48 81 50 83 C52 81 67 64 67 55 C67 46 60 38 50 38 Z',
                                fill: '#ffffff'
                            }),
                            // Blue T letter - moved down
                            H('text', {
                                x: '50',
                                y: '63',
                                textAnchor: 'middle',
                                fontSize: '20',
                                fontWeight: 'bold',
                                fill: '#1e3a8a',
                                fontFamily: 'system-ui, -apple-system, sans-serif'
                            }, 'T')
                        ),
                        H('h1', {
                            style: {
                                fontSize: '30px',
                                fontWeight: '800',
                                margin: '0 0 8px',
                                letterSpacing: '-0.02em',
                                background: 'linear-gradient(135deg, #3b82f6 0%, #1e40af 100%)',
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                                backgroundClip: 'text'
                            }
                        }, 'Trovelr'),

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
                            mode === 'login' ? null :
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
                            }, loading ? 'Please wait...' : 'Sign In'),

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
