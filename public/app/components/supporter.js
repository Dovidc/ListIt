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
      useEffect,
      useCallback
    } = React;

    const H = (tag, props, ...children) => React.createElement(tag, props || null, ...children);

    // Detect if running in iOS native app (Capacitor)
    function isIOSNativeApp() {
      try {
        const platform = window.Capacitor?.getPlatform?.();
        return platform === 'ios';
      } catch {
        return false;
      }
    }

    // Copy link for iOS users - "Subscribe at trovelr.com [copy icon]"
    function CopySubscribeLink() {
      const [copied, setCopied] = useState(false);

      const handleCopy = useCallback(async () => {
        try {
          await navigator.clipboard.writeText('https://trovelr.com');
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch (err) {
          console.error('Failed to copy:', err);
        }
      }, []);

      return H('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          marginTop: 12,
          fontSize: 14,
          color: '#64748b'
        }
      },
        H('span', null, 'Subscribe at '),
        H('span', {
          style: {
            color: '#2563eb',
            fontWeight: 600
          }
        }, 'trovelr.com'),
        H('button', {
          type: 'button',
          onClick: handleCopy,
          title: copied ? 'Copied!' : 'Copy link',
          style: {
            background: 'none',
            border: 'none',
            padding: 4,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: copied ? '#10b981' : '#64748b',
            transition: 'color 0.2s'
          }
        },
          // Clipboard icon SVG
          H('svg', {
            width: 18,
            height: 18,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round'
          },
            copied
              ? H('path', { d: 'M20 6L9 17l-5-5' }) // Checkmark
              : [
                H('rect', { key: 'rect', x: 9, y: 9, width: 13, height: 13, rx: 2, ry: 2 }),
                H('path', { key: 'path', d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' })
              ]
          )
        )
      );
    }

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
      const Component = (onClick || as === 'button') ? 'button' : 'span';
      const badgeLabel = 'Subscriber';
      const computedTitle = title || (since ? `${badgeLabel} since ${formatSinceLabel(since) || since}` : badgeLabel);

      const sizes = {
        sm: 16,
        md: 18,
        lg: 22
      };
      const iconSize = sizes[size] || sizes.md;

      const sharedProps = {
        className: `subscriber-badge ${className || ''}`.trim(),
        title: computedTitle,
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: onClick ? 'pointer' : 'default',
          background: 'none',
          border: 'none',
          padding: 0,
          ...style
        },
        type: Component === 'button' ? 'button' : undefined,
        onClick: onClick ? (evt) => {
          evt.stopPropagation();
          onClick(evt);
        } : undefined
      };

      // Trovelr location pin badge in circle
      return H(Component, sharedProps,
        H('svg', {
          width: iconSize,
          height: iconSize,
          viewBox: '0 0 40 40',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          className: 'subscriber-badge-icon'
        },
          H('defs', null,
            H('linearGradient', { id: 'pinBodyGrad', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
              H('stop', { offset: '0%', stopColor: '#fde68a' }),
              H('stop', { offset: '40%', stopColor: '#fbbf24' }),
              H('stop', { offset: '100%', stopColor: '#f59e0b' })
            ),
            H('radialGradient', { id: 'pinCoreGrad', cx: '35%', cy: '35%', r: '60%' },
              H('stop', { offset: '0%', stopColor: '#ffffff' }),
              H('stop', { offset: '50%', stopColor: '#fef3c7' }),
              H('stop', { offset: '100%', stopColor: '#fcd34d' })
            ),
            H('linearGradient', { id: 'circleGrad', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
              H('stop', { offset: '0%', stopColor: '#1e293b' }),
              H('stop', { offset: '100%', stopColor: '#0f172a' })
            ),
            H('filter', { id: 'pinGlow', x: '-50%', y: '-50%', width: '200%', height: '200%' },
              H('feDropShadow', { dx: '0', dy: '0', stdDeviation: '0.5', floodColor: '#fbbf24', floodOpacity: '0.6' })
            )
          ),
          // Outer circle background
          H('circle', {
            cx: '20',
            cy: '20',
            r: '18',
            fill: 'url(#circleGrad)',
            stroke: '#fbbf24',
            strokeWidth: '2'
          }),
          // Pin body (teardrop) - centered and scaled
          H('path', {
            d: 'M20 8c-3.3 0-6 2.7-6 6 0 4.3 6 12 6 12s6-7.7 6-12c0-3.3-2.7-6-6-6z',
            fill: 'url(#pinBodyGrad)',
            stroke: '#d97706',
            strokeWidth: '0.8',
            filter: 'url(#pinGlow)'
          }),
          // Inner circle
          H('circle', {
            cx: '20',
            cy: '14',
            r: '3.2',
            fill: 'url(#pinCoreGrad)',
            stroke: '#f59e0b',
            strokeWidth: '0.5'
          }),
          // Tiny T
          H('text', {
            x: '20',
            y: '16.2',
            textAnchor: 'middle',
            fontSize: '5',
            fontWeight: 'bold',
            fill: '#b45309',
            fontFamily: 'system-ui, sans-serif'
          }, 'T')
        )
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

    function SupporterInfoModal({ open, onClose, username, since, onJoin, isSelf = false, paymentsDisabled = false }) {
      useModalLifecycle(open, onClose);
      if (!open) return null;

      const sinceLabel = formatSinceLabel(since);
      const isIOS = isIOSNativeApp();

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
              isSelf
                ? 'You already have an active supporter subscription. Thanks for keeping Trovelr running!'
                : 'Supporters keep Trovelr running and get special cusomization options for their profile and listing cards.'
            ),
            // Show copy link for iOS native app users
            isIOS && !isSelf && H(CopySubscribeLink),

            H('div', { className: 'supporter-modal__actions' },
              H('button', {
                type: 'button',
                className: 'btn',
                onClick: () => {
                  onClose?.();
                }
              }, 'Close'),
              isSelf
                ? H('span', {
                  className: 'muted',
                  style: {
                    fontSize: 13,
                    fontWeight: 600,
                    marginTop: 4
                  }
                }, 'Already subscribed')
                // Hide payment button on iOS native app (App Store rules)
                : (!isIOS && !paymentsDisabled && typeof onJoin === 'function') && H('button', {
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
      premiumAmount,
      selectedTier = 'premium',
      onTierChange,
      paymentsDisabled = false,
      notice = ''
    }) {
      useModalLifecycle(open, onClose);

      const donationText = formatDonation(Number(amount), currency);
      const premiumText = formatDonation(Number(premiumAmount || 199), currency);
      const handleOverlay = (evt) => {
        if (evt.target === evt.currentTarget) {
          onClose?.();
        }
      };

      const isPrompt = mode !== 'success';
      const isIOS = isIOSNativeApp();

      if (!open) return null;

      const handleTierClick = (tier) => {
        if (onTierChange) {
          onTierChange(tier);
        }
      };

      // Notice for non-iOS users (iOS gets CopySubscribeLink component instead)
      const effectiveNotice = paymentsDisabled
        ? (notice || 'Supporter payments are currently disabled, so premium perks are unlocked for everyone.')
        : notice;

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
              H(SupporterBadge, { size: 'lg', tier: 'premium' })
            ),
            H('h2', { className: 'supporter-modal__title' },
              isPrompt ? 'Become a Premium Supporter' : 'You are a Premium Supporter!'
            ),
            isPrompt
              ? H('div', { style: { display: 'grid', gap: 16 } },
                H('p', { className: 'supporter-modal__body', style: { marginBottom: 0 } },
                  'Subscribe to unlock exclusive premium features:'
                ),
                // Benefits list
                H('div', { style: { display: 'grid', gap: 10, padding: '0 4px' } },
                  H('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 10 } },
                    H('span', { style: { fontSize: 18, lineHeight: 1 } }, '✨'),
                    H('div', null,
                      H('div', { style: { fontWeight: 700, fontSize: 14, marginBottom: 2 } }, 'Premium Subscriber Badge'),
                      H('div', { style: { fontSize: 13, color: '#666' } }, 'A shimmering badge displayed on your profile card and all your listings')
                    )
                  ),
                  H('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 10 } },
                    H('span', { style: { fontSize: 18, lineHeight: 1 } }, '🎨'),
                    H('div', null,
                      H('div', { style: { fontWeight: 700, fontSize: 14, marginBottom: 2 } }, 'Profile Customization'),
                      H('div', { style: { fontSize: 13, color: '#666' } }, 'Upload a custom banner image to personalize your profile')
                    )
                  ),
                  H('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 10 } },
                    H('span', { style: { fontSize: 18, lineHeight: 1 } }, '⭐'),
                    H('div', null,
                      H('div', { style: { fontWeight: 700, fontSize: 14, marginBottom: 2 } }, 'Karma System'),
                      H('div', { style: { fontSize: 13, color: '#666' } }, 'Award karma points to buyers when you complete a sale')
                    )
                  )
                ),
                // Pricing
                H('div', {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '16px 20px',
                    border: '2px solid #e5e7eb',
                    borderRadius: 12,
                    background: '#fafafa',
                    marginTop: 4
                  }
                },
                  H('div', null,
                    H('div', { style: { fontWeight: 800, fontSize: 22 } }, `${premiumText}/month`),
                    H('div', { style: { fontSize: 12, color: '#666' } }, 'Cancel anytime from your profile')
                  ),
                  H('span', {
                    style: {
                      background: 'linear-gradient(135deg, #c0c0c0, #909090)',
                      color: 'white',
                      padding: '6px 12px',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      textShadow: '0 1px 2px rgba(0,0,0,0.3)'
                    }
                  }, 'PREMIUM')
                )
              )
              : H('p', { className: 'supporter-modal__body' },
                'Thanks for supporting Trovelr! Enjoy your premium badge and profile customization features.'
              ),
            isIOS && isPrompt && H(CopySubscribeLink),
            effectiveNotice && H('div', { className: 'supporter-modal__notice' }, effectiveNotice),
            error && H('div', { className: 'supporter-modal__error' }, error),
            H('div', { className: 'supporter-modal__actions' },
              H('button', {
                type: 'button',
                className: 'btn',
                onClick: () => onClose?.(),
                disabled: busy
              }, isPrompt ? (isIOS ? 'Close' : 'Maybe later') : 'Close'),
              // Hide payment button on iOS native app (App Store rules prohibit external payment links)
              isPrompt && !isIOS && typeof onJoin === 'function' && H('button', {
                type: 'button',
                className: 'btn primary',
                onClick: () => {
                  onJoin('premium');
                },
                disabled: busy || paymentsDisabled
              }, paymentsDisabled ? 'Payments disabled' : (busy ? 'Redirecting…' : 'Subscribe'))
            )
          )
        ),
        document.body
      );
    }

    function SelectBuyerModal({
      open,
      onClose,
      listingId,
      onBuyerSelected,
      onSkip,
      busy = false,
      error = '',
      premiumFreeForAll = false
    }) {
      const [buyers, setBuyers] = useState([]);
      const [loading, setLoading] = useState(false);
      const [selecting, setSelecting] = useState(false);

      useModalLifecycle(open, onClose);

      useEffect(() => {
        if (!open || !listingId) {
          setBuyers([]);
          setSelecting(false);
          return;
        }

        setLoading(true);
        setSelecting(false);
        fetch(`/api/listings/${listingId}/potential-buyers`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        })
          .then(res => res.json())
          .then(data => {
            setBuyers(data.buyers || []);
            setLoading(false);
          })
          .catch(err => {
            console.error('Failed to load buyers:', err);
            setLoading(false);
          });
      }, [open, listingId]);

      const handleOverlay = (evt) => {
        if (evt.target === evt.currentTarget && !busy && !selecting) {
          onClose?.();
        }
      };

      const handleSelectBuyer = async (buyerId) => {
        if (selecting || busy) return;
        setSelecting(true);

        try {
          const response = await fetch(`/api/listings/${listingId}/award-karma`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ buyer_id: buyerId })
          });

          const result = await response.json();

          if (!response.ok) {
            throw new Error(result.error || 'Failed to award karma');
          }

          setSelecting(false);
          onBuyerSelected?.(result);
        } catch (err) {
          console.error('Award karma error:', err);
          setSelecting(false);
        }
      };

      const handleSkip = () => {
        if (busy || selecting) return;
        // Call onSkip if provided, otherwise fall back to onClose
        if (onSkip) {
          onSkip();
        } else {
          onClose?.();
        }
      };

      if (!open) return null;

      return ReactDOM.createPortal(
        H('div', { className: 'supporter-modal__overlay', onClick: handleOverlay },
          H('div', {
            className: 'supporter-modal__card',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': 'Select buyer for karma'
          },
            H('button', {
              type: 'button',
              className: 'supporter-modal__close',
              onClick: () => !busy && !selecting && onClose?.(),
              disabled: busy || selecting
            }, '×'),
            H('h2', { className: 'supporter-modal__title' }, 'Who bought this item?'),
            H('p', { className: 'supporter-modal__body', style: { marginBottom: 16 } },
              'Select the buyer to award karma points. You\'ll get 1 point, they\'ll get 2 points.'
            ),
            loading
              ? H('div', { style: { textAlign: 'center', padding: 32, color: '#999' } }, 'Loading...')
              : buyers.length === 0
                ? H('div', { style: { textAlign: 'center', padding: 32, color: '#999' } },
                  'No one messaged you about this item.'
                )
                : H('div', {
                  className: 'buyer-list',
                  style: {
                    display: 'grid',
                    gap: 12,
                    maxHeight: 400,
                    overflowY: 'auto',
                    marginBottom: 16
                  }
                },
                  ...buyers.map(buyer =>
                    H('button', {
                      key: buyer.id,
                      type: 'button',
                      className: 'buyer-item',
                      onClick: () => handleSelectBuyer(buyer.id),
                      disabled: selecting || busy,
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: 12,
                        border: '1px solid #e5e7eb',
                        borderRadius: 8,
                        background: 'white',
                        cursor: selecting || busy ? 'default' : 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.2s',
                        opacity: selecting || busy ? 0.6 : 1
                      }
                    },
                      H('img', {
                        src: buyer.profile_picture_url || '/img/default-profile.png',
                        alt: buyer.username,
                        style: {
                          width: 48,
                          height: 48,
                          borderRadius: '50%',
                          objectFit: 'cover'
                        }
                      }),
                      H('div', { style: { flex: 1 } },
                        H('div', { style: { fontWeight: 600, marginBottom: 4 } }, buyer.username),
                        buyer.last_message_at && H('div', {
                          className: 'muted',
                          style: { fontSize: 13 }
                        }, `Last messaged ${new Date(buyer.last_message_at).toLocaleDateString()}`)
                      ),
                      buyer.supporter_badge && H(SupporterBadge, {
                        size: 'sm',
                        badge: buyer.supporter_badge
                      })
                    )
                  )
                ),
            error && H('div', {
              className: 'supporter-modal__error',
              style: { marginBottom: 12 }
            }, error),
            H('div', {
              className: 'supporter-modal__actions',
              style: { justifyContent: 'center' }
            },
              H('button', {
                type: 'button',
                className: 'btn',
                onClick: handleSkip,
                disabled: busy || selecting,
                style: {
                  fontSize: 13,
                  padding: '6px 12px',
                  opacity: 0.7
                }
              }, 'Skip')
            ),
            selecting && H('div', {
              style: {
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(255,255,255,0.8)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 16,
                fontSize: 14,
                color: '#666'
              }
            }, 'Awarding karma...')
          )
        ),
        document.body
      );
    }

    return {
      SupporterBadge,
      SupporterInfoModal,
      SupporterUpsellModal,
      SelectBuyerModal
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.components = window.ListItApp.components || {};
  window.ListItApp.components.supporter = {
    createSupporterComponents
  };
})();
