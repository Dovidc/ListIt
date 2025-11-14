(() => {
  function createSupporterComponents({ React, ReactDOM } = {}) {
    if (!React || typeof React.createElement !== 'function') {
      throw new Error('Supporter components require React.');
    }
    if (!ReactDOM || typeof ReactDOM.createPortal !== 'function') {
      throw new Error('Supporter components require ReactDOM.');
    }

    const {
      useMemo,
      useState,
      useEffect
    } = React;

    const H = (tag, props, ...children) => React.createElement(tag, props || null, ...children);

    const badgeIcons = {
      sparkles: () => H('svg', {
        className: 'supporter-badge__icon',
        viewBox: '0 0 64 64',
        role: 'presentation',
        focusable: 'false',
        'aria-hidden': 'true'
      },
        H('path', {
          d: 'M32 6l4.4 12.8L49 23l-12.6 4.2L32 40l-4.4-12.8L15 23l12.6-4.2z',
          fill: 'url(#supporterGradientMain)'
        }),
        H('path', {
          d: 'M54 30l2.2 6.4L62 38l-5.4 1.8L54 48l-2.2-6.2L46 38l5.8-1.6z',
          fill: 'url(#supporterGradientAccent)'
        }),
        H('defs', null,
          H('linearGradient', { id: 'supporterGradientMain', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
            H('stop', { offset: '0%', stopColor: '#fff4c0' }),
            H('stop', { offset: '50%', stopColor: '#f6c945' }),
            H('stop', { offset: '100%', stopColor: '#f59e0b' })
          ),
          H('linearGradient', { id: 'supporterGradientAccent', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
            H('stop', { offset: '0%', stopColor: '#fff1a6' }),
            H('stop', { offset: '100%', stopColor: '#facc15' })
          )
        )
      ),
      platinum: () => H('svg', {
        className: 'supporter-badge__icon supporter-badge__icon--premium',
        viewBox: '0 0 64 64',
        role: 'presentation',
        focusable: 'false',
        'aria-hidden': 'true'
      },
        H('path', {
          d: 'M32 2l5.5 16L54 22l-15.8 5.3L32 44l-5.5-16.7L10 22l16.5-4z',
          fill: 'url(#premiumGradientMain)',
          stroke: 'url(#premiumGradientStroke)',
          strokeWidth: '1.5'
        }),
        H('path', {
          d: 'M56 28l2.8 8L66 38.5l-6.8 2.3L56 50l-2.8-9.2L46 38.5l7.2-2.5z',
          fill: 'url(#premiumGradientAccent)'
        }),
        H('path', {
          d: 'M8 28l2.8 8L18 38.5l-6.8 2.3L8 50l-2.8-9.2L-2 38.5l7.2-2.5z',
          fill: 'url(#premiumGradientAccent)'
        }),
        H('circle', { cx: 32, cy: 22, r: 3, fill: 'url(#premiumGradientGem)' }),
        H('defs', null,
          H('linearGradient', { id: 'premiumGradientMain', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
            H('stop', { offset: '0%', stopColor: '#e0e7ff' }),
            H('stop', { offset: '30%', stopColor: '#c7d2fe' }),
            H('stop', { offset: '60%', stopColor: '#a5b4fc' }),
            H('stop', { offset: '100%', stopColor: '#818cf8' })
          ),
          H('linearGradient', { id: 'premiumGradientStroke', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
            H('stop', { offset: '0%', stopColor: '#6366f1' }),
            H('stop', { offset: '100%', stopColor: '#8b5cf6' })
          ),
          H('linearGradient', { id: 'premiumGradientAccent', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
            H('stop', { offset: '0%', stopColor: '#fde68a' }),
            H('stop', { offset: '50%', stopColor: '#fbbf24' }),
            H('stop', { offset: '100%', stopColor: '#f59e0b' })
          ),
          H('radialGradient', { id: 'premiumGradientGem' },
            H('stop', { offset: '0%', stopColor: '#ffffff' }),
            H('stop', { offset: '50%', stopColor: '#ddd6fe' }),
            H('stop', { offset: '100%', stopColor: '#a78bfa' })
          )
        )
      )
    };

    function formatSinceLabel(since) {
      if (!since) return null;
      try {
        const date = new Date(since);
        if (Number.isNaN(date.getTime())) return null;
        return new Intl.DateTimeFormat(undefined, {
          month: 'long',
          year: 'numeric'
        }).format(date);
      } catch {
        return null;
      }
    }

    function SupporterBadge({
      size = 'md',
      since,
      onClick,
      as = 'auto',
      title,
      className,
      style,
      tier = 'basic',
      badge
    }) {
      // Determine tier from badge code if provided
      const effectiveTier = badge === 'trovelr_platinum' ? 'premium' : (tier || 'basic');
      const isPremium = effectiveTier === 'premium';

      const Component = (onClick || as === 'button') ? 'button' : 'span';
      const badgeLabel = isPremium ? 'Premium Supporter' : 'Trovelr Supporter';
      const computedTitle = title || (since ? `${badgeLabel} since ${formatSinceLabel(since) || since}` : badgeLabel);
      const classes = [
        'supporter-badge',
        `supporter-badge--${size}`,
        isPremium ? 'supporter-badge--premium' : '',
        (onClick || as === 'button') ? 'supporter-badge--interactive' : '',
        className || ''
      ].filter(Boolean).join(' ');

      const sharedProps = {
        className: classes,
        title: computedTitle,
        style,
        type: Component === 'button' ? 'button' : undefined,
        onClick: onClick ? (evt) => {
          evt.stopPropagation();
          onClick(evt);
        } : undefined
      };

      const icon = isPremium ? badgeIcons.platinum() : badgeIcons.sparkles();

      return H(Component, sharedProps,
        icon,
        H('span', { className: 'supporter-badge__label' }, badgeLabel)
      );
    }

    function useModalLifecycle(open, onClose) {
      useEffect(() => {
        if (!open) return undefined;
        const handler = (evt) => {
          if (evt.key === 'Escape') {
            onClose?.();
          }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
      }, [open, onClose]);
    }

    function SupporterInfoModal({ open, onClose, username, since, onJoin }) {
      useModalLifecycle(open, onClose);
      if (!open) return null;

      const sinceLabel = formatSinceLabel(since);

      const handleOverlay = (evt) => {
        if (evt.target === evt.currentTarget) {
          onClose?.();
        }
      };

      return ReactDOM.createPortal(
        H('div', { className: 'supporter-modal__overlay', onClick: handleOverlay },
          H('div', {
            className: 'supporter-modal__card',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': 'Trovelr supporter information'
          },
            H('button', {
              type: 'button',
              className: 'supporter-modal__close',
              onClick: () => onClose?.()
            }, '×'),
            H('div', { className: 'supporter-modal__badge' },
              H(SupporterBadge, { size: 'lg', since })
            ),
            H('h2', { className: 'supporter-modal__title' }, `${username || 'This user'} is a Trovelr Supporter`),
            sinceLabel && H('p', { className: 'supporter-modal__subtitle' }, `Backing Trovelr since ${sinceLabel}`),
            H('p', { className: 'supporter-modal__body' },
              'Supporters keep Trovelr running and get a signature golden badge on every listing they share.'
            ),
            H('div', { className: 'supporter-modal__actions' },
              H('button', {
                type: 'button',
                className: 'btn',
                onClick: () => {
                  onClose?.();
                }
              }, 'Close'),
              typeof onJoin === 'function' && H('button', {
                type: 'button',
                className: 'btn primary',
                onClick: () => {
                  onClose?.();
                  onJoin();
                }
              }, 'Join the program')
            )
          )
        ),
        document.body
      );
    }

    function formatDonation(amount, currency) {
      if (!Number.isFinite(amount)) return '';
      const normalized = amount / 100;
      try {
        return new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: (currency || 'usd').toUpperCase()
        }).format(normalized);
      } catch {
        return `${normalized.toFixed(2)} ${(currency || 'USD').toUpperCase()}`;
      }
    }

    function SupporterUpsellModal({
      open,
      onClose,
      onJoin,
      busy = false,
      error = '',
      mode = 'prompt',
      amount,
      currency,
      premiumAmount
    }) {
      const [selectedTier, setSelectedTier] = useState('basic');
      useModalLifecycle(open, onClose);

      if (!open) return null;

      const donationText = formatDonation(Number(amount), currency);
      const premiumText = formatDonation(Number(premiumAmount || 199), currency);
      const handleOverlay = (evt) => {
        if (evt.target === evt.currentTarget) {
          onClose?.();
        }
      };

      const isPrompt = mode !== 'success';

      return ReactDOM.createPortal(
        H('div', { className: 'supporter-modal__overlay', onClick: handleOverlay },
          H('div', {
            className: 'supporter-modal__card supporter-modal__card--wide',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': isPrompt ? 'Support Trovelr' : 'Trovelr supporter thank you'
          },
            H('button', {
              type: 'button',
              className: 'supporter-modal__close',
              onClick: () => onClose?.(),
              disabled: busy
            }, '×'),
            H('div', { className: 'supporter-modal__badge' },
              H(SupporterBadge, { size: 'lg', tier: selectedTier })
            ),
            H('h2', { className: 'supporter-modal__title' },
              isPrompt ? 'Keep Trovelr independent' : 'You are a Trovelr Supporter!'
            ),
            isPrompt
              ? H('div', { style: { display: 'grid', gap: 16 } },
                  H('p', { className: 'supporter-modal__body', style: { marginBottom: 0 } },
                    'Choose your supporter tier:'
                  ),
                  H('div', { className: 'tier-selection', style: { display: 'grid', gap: 12 } },
                    H('label', {
                      className: `tier-option ${selectedTier === 'basic' ? 'tier-option--selected' : ''}`,
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: 16,
                        border: '2px solid',
                        borderColor: selectedTier === 'basic' ? '#f59e0b' : '#e5e7eb',
                        borderRadius: 12,
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }
                    },
                      H('input', {
                        type: 'radio',
                        name: 'tier',
                        value: 'basic',
                        checked: selectedTier === 'basic',
                        onChange: () => setSelectedTier('basic'),
                        style: { width: 20, height: 20, cursor: 'pointer' }
                      }),
                      H('div', { style: { flex: 1 } },
                        H('div', { style: { fontWeight: 700, fontSize: 16 } }, `${donationText} once`),
                        H('div', { className: 'muted', style: { fontSize: 14 } }, 'Golden supporter badge')
                      )
                    ),
                    H('label', {
                      className: `tier-option ${selectedTier === 'premium' ? 'tier-option--selected' : ''}`,
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: 16,
                        border: '2px solid',
                        borderColor: selectedTier === 'premium' ? '#8b5cf6' : '#e5e7eb',
                        borderRadius: 12,
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }
                    },
                      H('input', {
                        type: 'radio',
                        name: 'tier',
                        value: 'premium',
                        checked: selectedTier === 'premium',
                        onChange: () => setSelectedTier('premium'),
                        style: { width: 20, height: 20, cursor: 'pointer' }
                      }),
                      H('div', { style: { flex: 1 } },
                        H('div', { style: { fontWeight: 700, fontSize: 16 } }, `${premiumText}/month`),
                        H('div', { className: 'muted', style: { fontSize: 14 } }, 'Premium platinum badge + perks')
                      ),
                      H('span', {
                        style: {
                          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                          color: 'white',
                          padding: '4px 10px',
                          borderRadius: 6,
                          fontSize: 12,
                          fontWeight: 700
                        }
                      }, 'PREMIUM')
                    )
                  )
                )
              : H('p', { className: 'supporter-modal__body' },
                  'Thanks for fueling the marketplace and showing off the shiniest badge on Trovelr!'
                ),
            error && H('div', { className: 'supporter-modal__error' }, error),
            H('div', { className: 'supporter-modal__actions' },
              H('button', {
                type: 'button',
                className: 'btn',
                onClick: () => onClose?.(),
                disabled: busy
              }, isPrompt ? 'Maybe later' : 'Close'),
              isPrompt && typeof onJoin === 'function' && H('button', {
                type: 'button',
                className: 'btn primary',
                onClick: () => {
                  onJoin(selectedTier);
                },
                disabled: busy
              }, busy ? 'Redirecting…' : 'Continue')
            )
          )
        ),
        document.body
      );
    }

    return {
      SupporterBadge,
      SupporterInfoModal,
      SupporterUpsellModal
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.components = window.ListItApp.components || {};
  window.ListItApp.components.supporter = {
    createSupporterComponents
  };
})();
