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

    // Copy link button for iOS users
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
          gap: 8,
          marginTop: 8,
          fontSize: 13,
          color: '#666'
        }
      },
        H('span', null, 'Subscribe at '),
        H('button', {
          type: 'button',
          onClick: handleCopy,
          style: {
            background: copied ? '#10b981' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s'
          }
        }, copied ? 'Copied!' : 'Copy Link')
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

      return H(Component, sharedProps,
        H('span', { className: 'supporter-badge__glimmer-3' }),
        H('span', { className: 'supporter-badge__glimmer-6' }),
        H('span', { className: 'supporter-badge__glimmer-7' }),
        H('span', { className: 'supporter-badge__glimmer-8' }),
        isPremium && H('span', { className: 'supporter-badge__glimmer-4' }),
        isPremium && H('span', { className: 'supporter-badge__glimmer-5' }),
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
                : 'Supporters keep Trovelr running and get a signature golden badge on every listing they share.'
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
