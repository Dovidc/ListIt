(() => {
  function createProfileFeature({
    React,
    ReactDOM,
    api,
    helpers = {},
    components = {},
    appNav
  } = {}) {
    if (!React || typeof React.createElement !== 'function') {
      throw new Error('Profile feature requires React.');
    }
    const resolvedReactDOM = ReactDOM || (typeof window !== 'undefined' ? window.ReactDOM : null);
    if (!resolvedReactDOM || typeof resolvedReactDOM.createPortal !== 'function') {
      throw new Error('Profile feature requires ReactDOM.');
    }
    if (!api) {
      throw new Error('Profile feature requires an API client.');
    }

    const { asArray } = helpers;
    if (typeof asArray !== 'function') {
      throw new Error('Profile feature requires asArray helper.');
    }

    const {
      ImageWithSkeleton,
      InfoHelpModal,
      AutoListHelpModal,
      ListingModal,
      ProfilePictureUploadModal,
      ListingsGrid,
      SupporterBadge
    } = components;

    if (typeof ImageWithSkeleton !== 'function') {
      throw new Error('Profile feature requires ImageWithSkeleton component.');
    }
    if (typeof InfoHelpModal !== 'function') {
      throw new Error('Profile feature requires InfoHelpModal component.');
    }
    if (typeof AutoListHelpModal !== 'function') {
      throw new Error('Profile feature requires AutoListHelpModal component.');
    }
    if (typeof ListingModal !== 'function') {
      throw new Error('Profile feature requires ListingModal component.');
    }
    if (typeof SupporterBadge !== 'function') {
      throw new Error('Profile feature requires SupporterBadge component.');
    }
    // ListingsGrid is optional - we'll fall back to custom rendering if not available

    const H = (tag, props, ...children) => React.createElement(tag, props || null, ...children);
    const {
      useState,
      useCallback,
      useRef: reactUseRef,
      useMemo
    } = React;
    const useEffect = typeof React.useEffect === 'function' ? React.useEffect : null;
    const useRef = typeof reactUseRef === 'function' ? reactUseRef : ((initial) => ({ current: initial }));
    const { createPortal } = resolvedReactDOM;

    const navBridge = appNav || { setUser: () => { } };

    const iconButtonStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 36,
      height: 36,
      padding: 0,
      border: 'none',
      background: 'transparent'
    };

    function formatElapsedSince(value) {
      if (!value) return null;
      const date = new Date(value);
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
      const diff = Date.now() - date.getTime();
      if (!Number.isFinite(diff) || diff <= 0) return 'just now';
      const units = [
        { label: 'year', ms: 1000 * 60 * 60 * 24 * 365 },
        { label: 'month', ms: 1000 * 60 * 60 * 24 * 30 },
        { label: 'week', ms: 1000 * 60 * 60 * 24 * 7 },
        { label: 'day', ms: 1000 * 60 * 60 * 24 },
        { label: 'hour', ms: 1000 * 60 * 60 },
        { label: 'minute', ms: 1000 * 60 }
      ];
      for (const unit of units) {
        const valueCount = Math.floor(diff / unit.ms);
        if (valueCount >= 1) {
          return `${valueCount} ${unit.label}${valueCount === 1 ? '' : 's'} ago`;
        }
      }
      return 'just now';
    }

    function formatSubscriptionEndDate(value) {
      if (!value) return null;
      try {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return null;
        return date.toLocaleDateString(undefined, {
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        });
      } catch (err) {
        console.warn('Failed to format subscription period end date:', err);
        return null;
      }
    }

    function SettingsIcon(props = {}) {
      return H('svg', Object.assign({
        viewBox: '0 0 24 24',
        width: 20,
        height: 20,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        focusable: 'false',
        'aria-hidden': 'true'
      }, props),
        H('path', {
          d: 'M19.4 15a1.7 1.7 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.82-.33 1.7 1.7 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.17a1.7 1.7 0 0 0-1-1.51 1.7 1.7 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .33-1.82 1.7 1.7 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.17a1.7 1.7 0 0 0 1.51-1 1.7 1.7 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.82.33h.17A1.7 1.7 0 0 0 10 3.17V3a2 2 0 0 1 4 0v.17a1.7 1.7 0 0 0 1 1.51 1.7 1.7 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.33 1.82v.17a1.7 1.7 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.17a1.7 1.7 0 0 0-1.51 1z'
        }),
        H('circle', { cx: 12, cy: 12, r: 3.2 }));
    }

    function LogoutIcon(props = {}) {
      return H('svg', Object.assign({
        viewBox: '0 0 24 24',
        width: 20,
        height: 20,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        focusable: 'false',
        'aria-hidden': 'true'
      }, props),
        H('path', { d: 'M14 5h5a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5' }),
        H('polyline', { points: '9 8 4 12 9 16' }),
        H('line', { x1: 4, y1: 12, x2: 16, y2: 12 }));
    }

    function PresetIcon(props = {}) {
      return H('svg', Object.assign({
        viewBox: '0 0 24 24',
        width: 20,
        height: 20,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        focusable: 'false',
        'aria-hidden': 'true'
      }, props),
        H('line', { x1: 4, y1: 6.5, x2: 20, y2: 6.5 }),
        H('line', { x1: 4, y1: 12, x2: 20, y2: 12 }),
        H('line', { x1: 4, y1: 17.5, x2: 20, y2: 17.5 }),
        H('circle', { cx: 9, cy: 6.5, r: 2.1, fill: 'currentColor', stroke: 'none' }),
        H('circle', { cx: 15.5, cy: 12, r: 2.1, fill: 'currentColor', stroke: 'none' }),
        H('circle', { cx: 7.5, cy: 17.5, r: 2.1, fill: 'currentColor', stroke: 'none' }));
    }

    function PaypalPresetIcon(props = {}) {
      const { size = 22, stroke = 'currentColor', style, ...rest } = props;
      return H('svg', Object.assign({
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke,
        'stroke-width': 1.8,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        focusable: 'false',
        'aria-hidden': 'true',
        style
      }, rest),
        H('rect', { x: 3.2, y: 7.6, width: 17.6, height: 11.6, rx: 2.8, ry: 2.8 }),
        H('path', { d: 'M6.2 7.6V6.1c0-2 1.6-3.6 3.6-3.6h8.2a1.8 1.8 0 0 1 0 3.6H6.2' }),
        H('path', { d: 'M10.8 11.2h2.3a1.9 1.9 0 0 1 0 3.8h-2.3V18' }),
        H('path', { d: 'M10.8 15h1.8' }),
        H('circle', { cx: 16.8, cy: 13.4, r: 1.5 }));
    }

    function LocationPresetIcon(props = {}) {
      const { size = 22, stroke = 'currentColor', style, ...rest } = props;
      return H('svg', Object.assign({
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke,
        'stroke-width': 1.8,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        focusable: 'false',
        'aria-hidden': 'true',
        style
      }, rest),
        H('path', { d: 'M12 21s6-5.2 6-11a6 6 0 0 0-12 0c0 5.8 6 11 6 11z' }),
        H('circle', { cx: 12, cy: 10, r: 2.6 }));
    }

    function NotificationIcon(props = {}) {
      return H('svg', Object.assign({
        viewBox: '0 0 24 24',
        width: 20,
        height: 20,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        focusable: 'false',
        'aria-hidden': 'true'
      }, props),
        H('path', { d: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9' }),
        H('path', { d: 'M13.73 21a2 2 0 0 1-3.46 0' }));
    }

    function StarIcon(props = {}) {
      return H('svg', Object.assign({
        viewBox: '0 0 24 24',
        width: 20,
        height: 20,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        focusable: 'false',
        'aria-hidden': 'true'
      }, props),
        H('polygon', { points: '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2' }));
    }

    // KARMA DISABLED - commented out for now, can re-enable later
    // // Karma badge component - circle with count, pill if 100+
    // function KarmaBadge({ karma, size = 'md', onClick }) {
    //   const [showTooltip, setShowTooltip] = React.useState(false);
    //   const badgeRef = React.useRef(null);

    //   // Click outside to dismiss
    //   React.useEffect(() => {
    //     if (!showTooltip) return;
    //     const handleClickOutside = (e) => {
    //       if (badgeRef.current && !badgeRef.current.contains(e.target)) {
    //         setShowTooltip(false);
    //       }
    //     };
    //     document.addEventListener('click', handleClickOutside, true);
    //     return () => document.removeEventListener('click', handleClickOutside, true);
    //   }, [showTooltip]);

    //   if (typeof karma !== 'number' || karma <= 0) return null;

    //   const sizes = {
    //     sm: { size: 24, fontSize: 11, minWidth: 24 },
    //     md: { size: 28, fontSize: 13, minWidth: 28 }
    //   };
    //   const s = sizes[size] || sizes.md;

    //   // Determine if we need pill shape (3+ digits)
    //   const isPill = karma >= 100;
    //   const displayKarma = karma >= 1000 ? `${(karma / 1000).toFixed(1)}k` : karma;

    //   const handleClick = (e) => {
    //     e.stopPropagation();
    //     setShowTooltip(true);
    //     onClick?.();
    //   };

    //   return H('div', { ref: badgeRef, style: { position: 'relative', display: 'inline-flex' } },
    //     H('div', {
    //       onClick: handleClick,
    //       style: {
    //         display: 'inline-flex',
    //         alignItems: 'center',
    //         justifyContent: 'center',
    //         minWidth: isPill ? s.minWidth + 8 : s.size,
    //         height: s.size,
    //         padding: isPill ? '0 8px' : 0,
    //         background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
    //         borderRadius: isPill ? s.size / 2 : '50%',
    //         fontSize: s.fontSize,
    //         fontWeight: 800,
    //         color: '#fff',
    //         cursor: 'pointer',
    //         boxShadow: '0 2px 6px rgba(245, 158, 11, 0.4)',
    //         textShadow: '0 1px 2px rgba(0,0,0,0.2)',
    //         transition: 'transform 0.15s ease',
    //         userSelect: 'none',
    //         transform: showTooltip ? 'scale(1.1)' : 'scale(1)'
    //       }
    //     }, displayKarma),
    //     showTooltip && H('div', {
    //       style: {
    //         position: 'absolute',
    //         bottom: '100%',
    //         left: '50%',
    //         transform: 'translateX(-50%)',
    //         marginBottom: 8,
    //         background: 'rgba(0, 0, 0, 0.9)',
    //         color: '#fff',
    //         padding: '8px 12px',
    //         borderRadius: 8,
    //         fontSize: 12,
    //         fontWeight: 500,
    //         whiteSpace: 'nowrap',
    //         zIndex: 1000,
    //         pointerEvents: 'none',
    //         border: '1px solid rgba(251, 191, 36, 0.6)',
    //         textAlign: 'center'
    //       }
    //     },
    //       H('div', { style: { fontWeight: 700, marginBottom: 4, color: '#fbbf24' } }, 'Karma'),
    //       H('div', { style: { fontSize: 11, color: '#d1d5db' } }, 'Points earned from successful sales')
    //     )
    //   );
    // }
    function KarmaBadge() { return null; } // KARMA DISABLED - stub

    // Default profile banner with trovelr branding
    function DefaultProfileBanner() {
      return H('svg', {
        viewBox: '0 0 800 220',
        preserveAspectRatio: 'xMidYMid slice',
        style: {
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%'
        },
        'aria-hidden': 'true'
      },
        // Background gradient
        H('defs', null,
          H('linearGradient', { id: 'bannerBg', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
            H('stop', { offset: '0%', stopColor: '#0f172a' }),
            H('stop', { offset: '50%', stopColor: '#1e293b' }),
            H('stop', { offset: '100%', stopColor: '#0f172a' })
          ),
          H('linearGradient', { id: 'bannerAccent', x1: '0%', y1: '0%', x2: '100%', y2: '0%' },
            H('stop', { offset: '0%', stopColor: '#3b82f6', stopOpacity: '0.3' }),
            H('stop', { offset: '50%', stopColor: '#8b5cf6', stopOpacity: '0.4' }),
            H('stop', { offset: '100%', stopColor: '#3b82f6', stopOpacity: '0.3' })
          ),
          H('linearGradient', { id: 'textGradient', x1: '0%', y1: '0%', x2: '100%', y2: '0%' },
            H('stop', { offset: '0%', stopColor: '#60a5fa' }),
            H('stop', { offset: '50%', stopColor: '#a78bfa' }),
            H('stop', { offset: '100%', stopColor: '#60a5fa' })
          ),
          H('filter', { id: 'glow' },
            H('feGaussianBlur', { stdDeviation: '3', result: 'coloredBlur' }),
            H('feMerge', null,
              H('feMergeNode', { in: 'coloredBlur' }),
              H('feMergeNode', { in: 'SourceGraphic' })
            )
          ),
          // Pattern for subtle texture
          H('pattern', { id: 'dots', x: '0', y: '0', width: '20', height: '20', patternUnits: 'userSpaceOnUse' },
            H('circle', { cx: '2', cy: '2', r: '1', fill: 'rgba(148, 163, 184, 0.08)' })
          )
        ),
        // Main background
        H('rect', { x: '0', y: '0', width: '800', height: '220', fill: 'url(#bannerBg)' }),
        // Dot pattern overlay
        H('rect', { x: '0', y: '0', width: '800', height: '220', fill: 'url(#dots)' }),
        // Accent gradient stripe
        H('rect', { x: '0', y: '60', width: '800', height: '100', fill: 'url(#bannerAccent)' }),
        // Decorative circles
        H('circle', { cx: '650', cy: '110', r: '120', fill: 'none', stroke: 'rgba(99, 102, 241, 0.15)', strokeWidth: '1' }),
        H('circle', { cx: '680', cy: '90', r: '80', fill: 'none', stroke: 'rgba(139, 92, 246, 0.12)', strokeWidth: '1' }),
        H('circle', { cx: '100', cy: '150', r: '100', fill: 'none', stroke: 'rgba(59, 130, 246, 0.1)', strokeWidth: '1' }),
        // Location pin icon (subtle, top right area)
        H('g', { transform: 'translate(720, 30)', opacity: '0.15' },
          H('path', {
            d: 'M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20c0-6.6-5.4-12-12-12zm0 16c-2.2 0-4-1.8-4-4s1.8-4 4-4 4 1.8 4 4-1.8 4-4 4z',
            fill: '#60a5fa',
            transform: 'scale(1.5)'
          })
        ),
        // "trovelr" text - positioned right side, subtle
        H('text', {
          x: '760',
          y: '195',
          textAnchor: 'end',
          style: {
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: '28px',
            fontWeight: '700',
            letterSpacing: '2px'
          },
          fill: 'url(#textGradient)',
          filter: 'url(#glow)',
          opacity: '0.6'
        }, 'trovelr')
      );
    }

    const AutoPostNearbyHelpModal = React.memo(function AutoPostNearbyHelpModal({ onClose }) {
      return H(InfoHelpModal, {
        onClose,
        title: 'Enable distance tags',
        intro: 'When enabled, distance tags will be added to your listings.',
        bullets: [
          'Uses your latest saved location to set latitude and longitude.',
          'Allows users to see the distance your item is from them.',
        ],
        footer: 'You can always edit the listing afterwards to adjust its location or disable distance tags.'
      });
    });

    const InquiryHelpModal = React.memo(function InquiryHelpModal({ onClose }) {
      return H(InfoHelpModal, {
        onClose,
        title: 'Offer Message',
        intro: 'When Offer is enabled it will:',
        bullets: [
          'Overlay the listing image with a banner inviting buyers to make an offer.'
        ],
        footer: 'Best used for items that you want to sell fast.'
      });
    });

    const PresetModal = React.memo(function PresetModal({
      open,
      onClose,
      locationPreset,
      onChangeLocationPreset,
      onSaveLocation,
      locationStatusMessage,
      profileAbout,
      onChangeProfileAbout,
      onSaveProfileAbout,
      profileAboutStatusMessage,
      onOpenBlockedUsers
    }) {
      const [saving, setSaving] = useState(false);
      const [saveStatus, setSaveStatus] = useState('');

      // Hide mobile dashboard when modal is open
      useEffect(() => {
        if (open) {
          document.body.classList.add('modal-open');
          return () => document.body.classList.remove('modal-open');
        }
      }, [open]);

      const hasDom = typeof document !== 'undefined' && document.body;
      if (!open || !hasDom) {
        return null;
      }

      const handleOverlayClick = (evt) => {
        if (evt.target && evt.target.classList && evt.target.classList.contains('modal')) {
          onClose?.();
        }
      };

      const handleSaveAll = async () => {
        setSaving(true);
        setSaveStatus('');
        try {
          await onSaveLocation?.();
          await onSaveProfileAbout?.();
          onClose?.();
        } catch (err) {
          setSaveStatus('Error saving. Please try again.');
          setSaving(false);
        }
      };

      return createPortal(
        H('div', {
          className: 'modal open',
          onClick: handleOverlayClick
        },
          H('div', {
            className: 'modal-inner preset-modal',
            style: {
              maxWidth: '460px',
              width: 'min(460px, 92vw)',
              padding: '24px',
              borderRadius: 16,
              display: 'grid',
              gap: 16,
              position: 'relative'
            }
          },
            H('div', { style: { display: 'grid', gap: 8 } },
              H('h2', {
                style: {
                  fontSize: 20,
                  fontWeight: 800,
                  margin: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8
                }
              },
                'Message presets',
                H(LocationPresetIcon, { size: 22 })
              ),
              H('p', {
                className: 'muted',
                style: { fontSize: 13, margin: 0 }
              }, 'Save info you want to quickly share when messaging.')
            ),
            H('section', { style: { display: 'grid', gap: 12 } },
              H('div', {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8
                }
              },
                H('span', { style: { fontWeight: 600 } }, 'Saved address'),
                H(LocationPresetIcon, { size: 18 })
              ),
              H('input', {
                value: locationPreset,
                onChange: (evt) => onChangeLocationPreset?.(evt.target.value),
                placeholder: '123 Main St, City, State',
                maxLength: 240,
                style: { width: '100%' }
              })
            ),
            H('section', { style: { display: 'grid', gap: 12 } },
              H('div', {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap'
                }
              },
                H('span', { style: { fontWeight: 600 } }, 'About this seller'),
                H('span', {
                  className: 'muted',
                  style: { fontSize: 12 }
                }, 'Shown on your profile preview')
              ),
              H('input', {
                value: profileAbout,
                onChange: (evt) => onChangeProfileAbout?.(evt.target.value),
                placeholder: 'Share a short bio, shipping info, or what you sell.',
                maxLength: 80,
                style: { width: '100%' }
              }),
              H('div', {
                style: {
                  display: 'flex',
                  justifyContent: 'flex-end',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 8
                }
              },
                H('span', {
                  className: 'muted',
                  style: { fontSize: 12 }
                }, `${(profileAbout || '').length}/80 characters`)
              )
            ),
            // Blocked Users button
            H('button', {
              type: 'button',
              onClick: () => {
                onClose?.();
                onOpenBlockedUsers?.();
              },
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 16px',
                background: 'rgba(254, 242, 242, 0.5)',
                border: '1px solid rgba(254, 202, 202, 0.5)',
                borderRadius: 10,
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%'
              }
            },
              H('div', {
                style: {
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: 'rgba(254, 226, 226, 0.8)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }
              },
                H('svg', {
                  width: 18,
                  height: 18,
                  viewBox: '0 0 24 24',
                  fill: 'none',
                  stroke: '#dc2626',
                  strokeWidth: 2,
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round'
                },
                  H('circle', { cx: 12, cy: 12, r: 10 }),
                  H('line', { x1: 4.93, y1: 4.93, x2: 19.07, y2: 19.07 })
                )
              ),
              H('div', { style: { flex: 1 } },
                H('div', { style: { fontWeight: 600, fontSize: 14 } }, 'Blocked Users'),
                H('div', { style: { fontSize: 12, opacity: 0.7 } }, 'Manage users you\'ve blocked')
              ),
              H('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', style: { opacity: 0.5 } },
                H('polyline', { points: '9 18 15 12 9 6' })
              )
            ),
            H('div', {
              style: {
                marginTop: 8,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12
              }
            },
              saveStatus && H('div', {
                role: 'status',
                'aria-live': 'polite',
                style: {
                  fontSize: 13,
                  color: saveStatus === 'Saved' ? '#047857' : '#dc2626',
                  fontWeight: 600
                }
              }, saveStatus),
              H('button', {
                className: 'btn primary',
                type: 'button',
                onClick: handleSaveAll,
                disabled: saving,
                style: { marginLeft: 'auto' }
              }, saving ? 'Saving...' : 'Save')
            ),
            H('p', {
              className: 'muted',
              style: { fontSize: 12, margin: 0 }
            }, 'When you press the preset icon in a conversation, the info you save here will be sent as a normal message.')
          )
        ),
        document.body
      );
    });

    // Blocked Users List Modal
    const BlockedUsersListModal = React.memo(function BlockedUsersListModal({
      open,
      onClose,
      blockedUsers,
      loading,
      onUnblock
    }) {
      const hasDom = typeof document !== 'undefined' && document.body;
      if (!open || !hasDom) {
        return null;
      }

      const handleOverlayClick = (evt) => {
        if (evt.target && evt.target.classList && evt.target.classList.contains('modal')) {
          onClose?.();
        }
      };

      const formatDate = (dateStr) => {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        return d.toLocaleDateString();
      };

      return createPortal(
        H('div', {
          className: 'modal open',
          onClick: handleOverlayClick
        },
          H('div', {
            className: 'modal-inner blocked-users-modal',
            style: {
              maxWidth: '500px',
              width: 'min(500px, 94vw)',
              maxHeight: '80vh',
              padding: '20px',
              borderRadius: 14,
              display: 'grid',
              gap: 16,
              overflow: 'hidden'
            }
          },
            H('div', {
              style: {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }
            },
              H('h3', {
                style: {
                  margin: 0,
                  fontSize: 18,
                  fontWeight: 700
                }
              }, 'Blocked Users'),
              H('button', {
                type: 'button',
                onClick: onClose,
                style: {
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 4,
                  opacity: 0.6
                }
              },
                H('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
                  H('line', { x1: 18, y1: 6, x2: 6, y2: 18 }),
                  H('line', { x1: 6, y1: 6, x2: 18, y2: 18 })
                )
              )
            ),
            H('div', {
              style: {
                overflowY: 'auto',
                maxHeight: 'calc(80vh - 100px)',
                display: 'grid',
                gap: 8
              }
            },
              loading
                ? H('div', { style: { textAlign: 'center', padding: 20, opacity: 0.6 } }, 'Loading...')
                : (!blockedUsers || blockedUsers.length === 0)
                  ? H('div', { style: { textAlign: 'center', padding: 20, opacity: 0.6 } }, 'No blocked users.')
                  : blockedUsers.map(user => H('div', {
                      key: user.id,
                      style: {
                        display: 'flex',
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '12px',
                        padding: '12px',
                        background: 'rgba(0,0,0,0.05)',
                        borderRadius: '10px',
                        border: '1px solid rgba(0,0,0,0.1)'
                      }
                    },
                      H('div', { style: { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minWidth: '80px' } },
                        H('span', { style: { fontWeight: 600, fontSize: '14px', color: 'inherit' } }, user.username || `User #${user.id}`),
                        H('span', { style: { fontSize: '11px', opacity: 0.6, color: 'inherit' } }, formatDate(user.blocked_at))
                      ),
                      H('button', {
                        type: 'button',
                        onClick: () => onUnblock?.(user.id),
                        className: 'btn',
                        style: {
                          padding: '6px 10px',
                          fontSize: '12px',
                          fontWeight: 500,
                          flexShrink: 0,
                          whiteSpace: 'nowrap'
                        }
                      }, 'Unblock')
                    ))
            )
          )
        ),
        document.body
      );
    });

    const ProfileCustomizationModal = React.memo(function ProfileCustomizationModal({
      open,
      onClose,
      borderColor,
      onChangeBorderColor,
      borderStyle,
      onChangeBorderStyle,
      bgImageUrl,
      onUploadBgImage,
      onClearBgImage,
      bgImageUploading,
      bgImageUploadError,
      onSave,
      statusMessage,
      isPremium: isPremiumProp,
      username,
      profilePictureUrl
    }) {
      const isPremium = isPremiumProp;
      const displayName = username || 'You';
      const initials = displayName.trim().slice(0, 1).toUpperCase();
      const avatarBorderColor = borderColor || '#ffffff';
      const avatarBorderStyle = borderStyle === 'dashed' ? 'dashed' : 'solid';

      // Detect dark mode
      const isDarkMode = typeof document !== 'undefined' &&
        (document.documentElement.getAttribute('data-theme') === 'dark' ||
        localStorage.getItem('theme') === 'dark');

      // Detect if desktop (no touch support or wide screen)
      const isDesktop = typeof window !== 'undefined' &&
        (!('ontouchstart' in window) || window.innerWidth >= 1024);

      // Theme colors
      const theme = {
        bg: isDarkMode ? '#1e293b' : '#fff',
        bgSecondary: isDarkMode ? '#334155' : '#f8fafc',
        bgTertiary: isDarkMode ? '#475569' : '#f1f5f9',
        border: isDarkMode ? 'rgba(255,255,255,0.1)' : '#e5e7eb',
        text: isDarkMode ? '#f1f5f9' : '#0f172a',
        textSecondary: isDarkMode ? '#94a3b8' : '#64748b',
        textMuted: isDarkMode ? '#64748b' : '#94a3b8',
        sliderBg: isDarkMode ? '#475569' : '#e2e8f0',
        errorBg: isDarkMode ? 'rgba(239, 68, 68, 0.15)' : '#fee2e2',
        errorText: isDarkMode ? '#f87171' : '#991b1b',
        premiumBg: isDarkMode ? 'rgba(99, 102, 241, 0.2)' : '#dbeafe',
        premiumBorder: isDarkMode ? 'rgba(147, 197, 253, 0.3)' : '#93c5fd',
        premiumText: isDarkMode ? '#a5b4fc' : '#1e40af'
      };

      // Profile card dimensions (scaled down ~75% to fit modal nicely)
      // Maintains same proportions as ProfilePreviewModal
      const PREVIEW_WIDTH = 280;
      const BANNER_HEIGHT = 155;
      const AVATAR_SIZE = 72;
      const AVATAR_OVERLAP = 26;
      const AVATAR_BORDER = 3;

      const uploadInputRef = useRef(null);
      const imageRef = useRef(null);
      const canvasRef = useRef(null);
      const cropAreaRef = useRef(null);
      const dragStartRef = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
      const pinchStartRef = useRef({ distance: 0, zoom: 1 });

      // Local preview state for cropping before upload
      const [localPreviewUrl, setLocalPreviewUrl] = useState(null);
      const [localFile, setLocalFile] = useState(null);
      const [zoom, setZoom] = useState(1);
      const [position, setPosition] = useState({ x: 0, y: 0 });
      const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
      const [isDragging, setIsDragging] = useState(false);
      const [cropError, setCropError] = useState(null);

      // Crop dimensions (aspect ratio matches banner 1.8:1)
      const CROP_WIDTH = PREVIEW_WIDTH;
      const CROP_HEIGHT = BANNER_HEIGHT;
      const OUTPUT_WIDTH = 900;
      const OUTPUT_HEIGHT = 500;

      const clampPosition = useCallback((x, y, currentZoom) => {
        if (!imageDimensions.width || !imageDimensions.height) return { x: 0, y: 0 };

        const scaledWidth = imageDimensions.width * currentZoom;
        const scaledHeight = imageDimensions.height * currentZoom;

        const maxX = Math.max(0, (scaledWidth - CROP_WIDTH) / 2);
        const maxY = Math.max(0, (scaledHeight - CROP_HEIGHT) / 2);

        return {
          x: Math.max(-maxX, Math.min(maxX, x)),
          y: Math.max(-maxY, Math.min(maxY, y))
        };
      }, [imageDimensions, CROP_WIDTH, CROP_HEIGHT]);

      // Calculate minimum zoom to ensure crop region stays within image bounds
      const getMinZoom = useCallback(() => {
        if (!imageDimensions.width || !imageDimensions.height) return 0.3;
        const minZoomX = CROP_WIDTH / imageDimensions.width;
        const minZoomY = CROP_HEIGHT / imageDimensions.height;
        return Math.max(minZoomX, minZoomY);
      }, [imageDimensions, CROP_WIDTH, CROP_HEIGHT]);

      const handlePointerMove = useCallback((evt) => {
        if (!isDragging) return;
        evt.preventDefault();
        const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
        const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
        const deltaX = clientX - dragStartRef.current.x;
        const deltaY = clientY - dragStartRef.current.y;
        const newPos = clampPosition(
          dragStartRef.current.posX + deltaX,
          dragStartRef.current.posY + deltaY,
          zoom
        );
        setPosition(newPos);
      }, [isDragging, zoom, clampPosition]);

      const handlePointerUp = useCallback(() => {
        setIsDragging(false);
      }, []);

      // Reset state when modal closes
      useEffect(() => {
        if (!open) {
          setLocalPreviewUrl(null);
          setLocalFile(null);
          setZoom(1);
          setPosition({ x: 0, y: 0 });
          setImageDimensions({ width: 0, height: 0 });
          setCropError(null);
        }
      }, [open]);

      // Hide mobile dashboard when modal is open
      useEffect(() => {
        if (open) {
          document.body.classList.add('modal-open');
          return () => document.body.classList.remove('modal-open');
        }
      }, [open]);

      useEffect(() => {
        if (isDragging) {
          document.addEventListener('mousemove', handlePointerMove);
          document.addEventListener('mouseup', handlePointerUp);
          document.addEventListener('touchmove', handlePointerMove, { passive: false });
          document.addEventListener('touchend', handlePointerUp);
          return () => {
            document.removeEventListener('mousemove', handlePointerMove);
            document.removeEventListener('mouseup', handlePointerUp);
            document.removeEventListener('touchmove', handlePointerMove);
            document.removeEventListener('touchend', handlePointerUp);
          };
        }
      }, [isDragging, handlePointerMove, handlePointerUp]);

      const hasDom = typeof document !== 'undefined' && document.body;
      if (!open || !hasDom) {
        return null;
      }

      const handleOverlayClick = (evt) => {
        if (evt.target && evt.target.classList && evt.target.classList.contains('modal')) {
          onClose?.();
        }
      };

      const handleFileSelect = (evt) => {
        if (!isPremium || bgImageUploading) {
          evt.target.value = '';
          return;
        }
        const file = evt.target?.files?.[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
          setCropError('Please select an image file');
          evt.target.value = '';
          return;
        }

        if (file.size > 8 * 1024 * 1024) {
          setCropError('Image must be less than 8MB');
          evt.target.value = '';
          return;
        }

        setLocalFile(file);
        setCropError(null);
        setZoom(1);
        setPosition({ x: 0, y: 0 });

        const reader = new FileReader();
        reader.onload = (e) => {
          setLocalPreviewUrl(e.target.result);
        };
        reader.readAsDataURL(file);
        evt.target.value = '';
      };

      const handleImageLoad = () => {
        if (!imageRef.current) return;
        const img = imageRef.current;
        setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
        // Calculate initial zoom to cover the crop area
        const scaleX = CROP_WIDTH / img.naturalWidth;
        const scaleY = CROP_HEIGHT / img.naturalHeight;
        const initialZoom = Math.max(scaleX, scaleY);
        setZoom(initialZoom);
        setPosition({ x: 0, y: 0 });
      };

      const handlePointerDown = (evt) => {
        if (!localPreviewUrl) return;
        setIsDragging(true);
        const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
        const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
        dragStartRef.current = { x: clientX, y: clientY, posX: position.x, posY: position.y };

        // Handle pinch-to-zoom start
        if (evt.touches && evt.touches.length === 2) {
          const dx = evt.touches[0].clientX - evt.touches[1].clientX;
          const dy = evt.touches[0].clientY - evt.touches[1].clientY;
          pinchStartRef.current = {
            distance: Math.sqrt(dx * dx + dy * dy),
            zoom: zoom
          };
        }
      };

      const handleTouchMove = (evt) => {
        if (!localPreviewUrl) return;

        // Handle pinch-to-zoom
        if (evt.touches && evt.touches.length === 2) {
          evt.preventDefault();
          const dx = evt.touches[0].clientX - evt.touches[1].clientX;
          const dy = evt.touches[0].clientY - evt.touches[1].clientY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const scale = distance / pinchStartRef.current.distance;
          const newZoom = Math.max(getMinZoom(), Math.min(3, pinchStartRef.current.zoom * scale));
          setZoom(newZoom);
          setPosition(prev => clampPosition(prev.x, prev.y, newZoom));
        }
      };

      const handleWheel = (evt) => {
        if (!localPreviewUrl) return;
        evt.preventDefault();
        const delta = evt.deltaY > 0 ? -0.1 : 0.1;
        const newZoom = Math.max(getMinZoom(), Math.min(3, zoom + delta));
        setZoom(newZoom);
        setPosition(prev => clampPosition(prev.x, prev.y, newZoom));
      };

      const handleZoomChange = (newZoom) => {
        const clampedZoom = Math.max(getMinZoom(), Math.min(3, newZoom));
        setZoom(clampedZoom);
        setPosition(prev => clampPosition(prev.x, prev.y, clampedZoom));
      };

      const handleCropAndUpload = async () => {
        if (!localFile || !canvasRef.current || !imageRef.current) return;

        try {
          const canvas = canvasRef.current;
          const ctx = canvas.getContext('2d');
          const img = imageRef.current;

          canvas.width = OUTPUT_WIDTH;
          canvas.height = OUTPUT_HEIGHT;

          // Match the exact preview positioning:
          // Preview image left = (CROP_WIDTH - scaledW) / 2 + position.x
          // Preview image top = (CROP_HEIGHT - scaledH) / 2 + position.y
          const scaledWidth = imageDimensions.width * zoom;
          const scaledHeight = imageDimensions.height * zoom;

          const imgLeft = (CROP_WIDTH - scaledWidth) / 2 + position.x;
          const imgTop = (CROP_HEIGHT - scaledHeight) / 2 + position.y;

          // Convert screen crop area (0,0 to CROP_W,CROP_H) to original image coordinates
          const srcX = -imgLeft / zoom;
          const srcY = -imgTop / zoom;
          const srcWidth = CROP_WIDTH / zoom;
          const srcHeight = CROP_HEIGHT / zoom;

          ctx.drawImage(
            img,
            srcX,
            srcY,
            srcWidth,
            srcHeight,
            0,
            0,
            OUTPUT_WIDTH,
            OUTPUT_HEIGHT
          );

          const blob = await new Promise((resolve) => {
            canvas.toBlob(resolve, 'image/jpeg', 0.9);
          });

          const croppedFile = new File([blob], 'banner.jpg', { type: 'image/jpeg' });

          // Clear local preview and upload
          setLocalPreviewUrl(null);
          setLocalFile(null);

          onUploadBgImage?.(croppedFile);
        } catch (err) {
          console.error('Crop failed:', err);
          setCropError('Failed to process image');
        }
      };

      const handleCancelCrop = () => {
        setLocalPreviewUrl(null);
        setLocalFile(null);
        setZoom(1);
        setPosition({ x: 0, y: 0 });
        setCropError(null);
      };

      // Handle clicking on banner area - always opens file picker
      // (Can't re-crop existing banners due to CDN CORS restrictions)
      const handleBannerClick = () => {
        if (!isPremium || bgImageUploading) return;
        uploadInputRef.current?.click();
      };

      const premiumMsg = !isPremium ? H('div', {
        style: {
          padding: '12px',
          background: theme.premiumBg,
          border: `1px solid ${theme.premiumBorder}`,
          borderRadius: 8,
          fontSize: 13,
          color: theme.premiumText,
          marginBottom: 12
        }
      }, 'Profile customization is a premium subscriber feature') : null;

      // Helper to render the profile card preview (matching ProfilePreviewModal exactly)
      const renderProfileCardPreview = (bannerSrc, isLive = false, onBannerClick = null) => {
        const isClickable = !isLive && onBannerClick && isPremium;
        return H('div', {
          style: {
            width: PREVIEW_WIDTH,
            background: '#0f172a',
            borderRadius: 24,
            overflow: 'hidden',
            boxShadow: '0 35px 90px rgba(0, 0, 0, 0.55)',
            margin: '0 auto',
            fontFamily: 'Inter, system-ui'
          }
        },
          // Banner area with avatar overlap space
          H('div', {
            style: {
              position: 'relative',
              minHeight: BANNER_HEIGHT,
              paddingBottom: AVATAR_OVERLAP + 10
            }
          },
            // Banner background container
            H('div', {
              style: {
                position: 'absolute',
                inset: 0,
                overflow: 'hidden',
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                background: 'linear-gradient(120deg, #1d1f3b, #3730a3)',
                cursor: isLive ? (isDragging ? 'grabbing' : 'grab') : (isClickable ? 'pointer' : 'default'),
                touchAction: isLive ? 'none' : 'auto'
              },
              onClick: isClickable ? onBannerClick : undefined,
              onMouseDown: isLive ? handlePointerDown : undefined,
              onTouchStart: isLive ? handlePointerDown : undefined,
              onTouchMove: isLive ? handleTouchMove : undefined,
              onWheel: isLive ? handleWheel : undefined
            },
              bannerSrc ? (
                isLive ? H('img', {
                  src: bannerSrc,
                  alt: 'Banner preview',
                  style: {
                    position: 'absolute',
                    left: `${(CROP_WIDTH - imageDimensions.width * zoom) / 2 + position.x}px`,
                    top: `${(CROP_HEIGHT - imageDimensions.height * zoom) / 2 + position.y}px`,
                    width: `${imageDimensions.width * zoom}px`,
                    height: `${imageDimensions.height * zoom}px`,
                    maxWidth: 'none',
                    pointerEvents: 'none'
                  }
                }) : H('img', {
                  src: bannerSrc,
                  alt: 'Banner',
                  style: {
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover'
                  }
                })
              ) : H('div', {
                style: {
                  width: '100%',
                  height: '100%',
                  display: 'grid',
                  placeItems: 'center',
                  color: 'rgba(248, 250, 252, 0.5)'
                }
              },
                // Image/gallery placeholder icon SVG
                H('svg', { width: 40, height: 40, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
                  H('rect', { x: 3, y: 3, width: 18, height: 18, rx: 2, ry: 2 }),
                  H('circle', { cx: 8.5, cy: 8.5, r: 1.5 }),
                  H('polyline', { points: '21 15 16 10 5 21' })
                )
              ),
              // Gradient overlay
              H('div', {
                style: {
                  position: 'absolute',
                  inset: 0,
                  background: 'linear-gradient(180deg, rgba(2, 6, 23, 0) 40%, rgba(2, 6, 23, 0.9) 100%)'
                }
              }),
              // Clickable hint overlay (only in main view, not crop view)
              isClickable && H('div', {
                style: {
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(0, 0, 0, 0.3)',
                  opacity: 0.85,
                  transition: 'opacity 0.2s'
                }
              },
                H('div', {
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 6,
                    color: '#fff',
                    fontSize: 13,
                    fontWeight: 600
                  }
                },
                  // Camera icon SVG
                  H('svg', { width: 28, height: 28, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' },
                    H('path', { d: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z' }),
                    H('circle', { cx: 12, cy: 13, r: 4 })
                  ),
                  bannerSrc ? 'Tap to change' : 'Tap to add banner'
                )
              )
            ),
            // Avatar positioned at bottom left, overlapping banner
            H('div', {
              style: {
                position: 'absolute',
                left: 18,
                bottom: -AVATAR_OVERLAP,
                width: AVATAR_SIZE,
                height: AVATAR_SIZE,
                borderRadius: '50%',
                border: `${AVATAR_BORDER}px ${avatarBorderStyle} ${avatarBorderColor}`,
                background: '#0f172a',
                boxShadow: '0 14px 35px rgba(0, 0, 0, 0.45)',
                overflow: 'hidden'
              }
            },
              profilePictureUrl
                ? H('img', {
                    src: profilePictureUrl,
                    alt: 'Avatar',
                    style: { width: '100%', height: '100%', objectFit: 'cover' }
                  })
                : H('span', {
                    style: {
                      width: '100%',
                      height: '100%',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 28,
                      fontWeight: 800,
                      color: '#e2e8f0'
                    }
                  }, initials)
            )
          ),
          // Content area below banner (scaled to match smaller preview)
          H('div', {
            style: {
              padding: `${AVATAR_OVERLAP + 28}px 18px 20px`,
              display: 'grid',
              gap: 3
            }
          },
            // Username
            H('div', {
              style: {
                fontSize: 17,
                fontWeight: 800,
                color: '#f8fafc'
              }
            }, displayName),
            // Preview label
            H('div', {
              style: {
                fontSize: 11,
                color: '#94a3b8',
                marginTop: 2
              }
            }, 'How others see your profile')
          )
        );
      };

      // Cropping view with live preview
      if (localPreviewUrl) {
        return createPortal(
          H('div', {
            className: 'modal open',
            onClick: handleOverlayClick,
            style: { background: 'rgba(0, 0, 0, 0.8)' }
          },
            H('div', {
              className: 'modal-inner',
              style: {
                maxWidth: '420px',
                width: 'min(420px, 94vw)',
                padding: '20px',
                background: theme.bg,
                color: theme.text,
                borderRadius: 16,
                display: 'grid',
                gap: 16
              }
            },
              // Header
              H('div', {
                style: {
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }
              },
                H('h2', {
                  style: { fontSize: 18, fontWeight: 700, margin: 0, color: theme.text }
                }, 'Adjust Banner'),
                H('button', {
                  onClick: handleCancelCrop,
                  style: {
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    border: 'none',
                    background: theme.bgTertiary,
                    color: theme.textSecondary,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }
                },
                  // X icon SVG
                  H('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
                    H('line', { x1: 18, y1: 6, x2: 6, y2: 18 }),
                    H('line', { x1: 6, y1: 6, x2: 18, y2: 18 })
                  )
                )
              ),

              cropError && H('div', {
                style: {
                  padding: 12,
                  background: theme.errorBg,
                  color: theme.errorText,
                  borderRadius: 8,
                  fontSize: 14
                }
              }, cropError),

              // Live profile card preview
              renderProfileCardPreview(localPreviewUrl, true),

              // Hidden file input for changing image
              H('input', {
                ref: uploadInputRef,
                type: 'file',
                accept: 'image/*',
                onChange: handleFileSelect,
                style: { display: 'none' }
              }),

              // Hidden image for loading dimensions (crossOrigin for CORS)
              H('img', {
                ref: imageRef,
                src: localPreviewUrl,
                alt: 'Source',
                crossOrigin: 'anonymous',
                onLoad: handleImageLoad,
                style: { display: 'none' }
              }),

              // Zoom slider with change image button
              H('div', {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '0 8px'
                }
              },
                // Change image button (gallery icon)
                H('button', {
                  onClick: () => uploadInputRef.current?.click(),
                  style: {
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    border: 'none',
                    background: theme.bgTertiary,
                    color: theme.textSecondary,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  },
                  title: 'Choose different image'
                },
                  // Image/gallery icon SVG
                  H('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
                    H('rect', { x: 3, y: 3, width: 18, height: 18, rx: 2, ry: 2 }),
                    H('circle', { cx: 8.5, cy: 8.5, r: 1.5 }),
                    H('polyline', { points: '21 15 16 10 5 21' })
                  )
                )
              ),

              // Mobile hint text
              !isDesktop && H('p', {
                style: { fontSize: 12, color: theme.textSecondary, textAlign: 'center', margin: 0 }
              }, 'Pinch to zoom'),

              // Desktop zoom slider
              isDesktop && H('div', {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  marginTop: 8
                }
              },
                // Zoom out icon (minus)
                H('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: theme.textSecondary, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
                  H('circle', { cx: 11, cy: 11, r: 8 }),
                  H('line', { x1: 8, y1: 11, x2: 14, y2: 11 })
                ),
                H('input', {
                  type: 'range',
                  min: getMinZoom(),
                  max: '3',
                  step: '0.05',
                  value: zoom,
                  onChange: (e) => handleZoomChange(parseFloat(e.target.value)),
                  style: {
                    flex: 1,
                    height: 8,
                    borderRadius: 4,
                    appearance: 'none',
                    background: theme.sliderBg,
                    cursor: 'pointer'
                  }
                }),
                // Zoom in icon (plus)
                H('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: theme.textSecondary, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
                  H('circle', { cx: 11, cy: 11, r: 8 }),
                  H('line', { x1: 11, y1: 8, x2: 11, y2: 14 }),
                  H('line', { x1: 8, y1: 11, x2: 14, y2: 11 })
                )
              ),

              // Hidden canvas
              H('canvas', { ref: canvasRef, style: { display: 'none' } }),

              // Action buttons
              H('div', { style: { display: 'flex', gap: 12 } },
                H('button', {
                  onClick: handleCancelCrop,
                  style: {
                    flex: 1,
                    padding: '14px',
                    background: theme.bgTertiary,
                    color: theme.textSecondary,
                    border: 'none',
                    borderRadius: 12,
                    fontSize: 15,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }
                }, 'Cancel'),
                H('button', {
                  onClick: handleCropAndUpload,
                  style: {
                    flex: 1,
                    padding: '14px',
                    background: '#2563eb',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 12,
                    fontSize: 15,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }
                }, 'Apply')
              )
            )
          ),
          document.body
        );
      }

      // Main modal view
      return createPortal(
        H('div', {
          className: 'modal open',
          onClick: handleOverlayClick
        },
          H('div', {
            className: 'modal-inner',
            style: {
              maxWidth: '420px',
              width: 'min(420px, 92vw)',
              padding: '24px',
              background: theme.bg,
              color: theme.text,
              borderRadius: 16,
              display: 'grid',
              gap: 16,
              position: 'relative'
            }
          },
            H('button', {
              onClick: onClose,
              style: {
                position: 'absolute',
                top: '12px',
                right: '12px',
                width: '36px',
                height: '36px',
                border: 'none',
                background: theme.bgTertiary,
                borderRadius: '50%',
                cursor: 'pointer',
                color: theme.textSecondary,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }
            },
              // X icon SVG
              H('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
                H('line', { x1: 18, y1: 6, x2: 6, y2: 18 }),
                H('line', { x1: 6, y1: 6, x2: 18, y2: 18 })
              )
            ),

            H('div', { style: { display: 'grid', gap: 4 } },
              H('h2', {
                style: {
                  fontSize: 18,
                  fontWeight: 700,
                  margin: 0,
                  color: theme.text,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8
                }
              },
                'Profile Banner',
                !isPremium && H('span', {
                  style: {
                    padding: '2px 8px',
                    background: theme.premiumBg,
                    color: theme.premiumText,
                    borderRadius: 10,
                    fontSize: 11,
                    fontWeight: 600
                  }
                }, 'Premium')
              ),
              H('p', {
                style: { fontSize: 13, color: theme.textSecondary, margin: 0 }
              }, 'Customize how your profile appears to others')
            ),

            premiumMsg,

            // Profile card preview - clickable to edit/add banner
            renderProfileCardPreview(bgImageUrl, false, handleBannerClick),

            // Hidden file input
            H('input', {
              ref: uploadInputRef,
              type: 'file',
              accept: 'image/*',
              disabled: !isPremium || bgImageUploading,
              onChange: handleFileSelect,
              style: { display: 'none' }
            }),

            // Status messages
            H('div', { style: { display: 'grid', gap: 8 } },
              bgImageUploading && H('div', {
                style: {
                  padding: 10,
                  background: theme.premiumBg,
                  color: theme.premiumText,
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  textAlign: 'center'
                }
              }, 'Uploading...'),

              bgImageUploadError && H('div', {
                style: {
                  padding: 10,
                  background: theme.errorBg,
                  color: theme.errorText,
                  borderRadius: 8,
                  fontSize: 13
                }
              }, bgImageUploadError),

              statusMessage && H('div', {
                style: {
                  padding: 10,
                  background: isDarkMode ? 'rgba(16, 185, 129, 0.15)' : '#d1fae5',
                  color: isDarkMode ? '#34d399' : '#065f46',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600
                }
              }, statusMessage)
            ),

            // Save button (blue)
            H('button', {
              onClick: async () => {
                await onSave?.();
                onClose?.();
              },
              style: {
                width: '100%',
                padding: '14px',
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: 12,
                fontSize: 15,
                fontWeight: 600,
                cursor: 'pointer'
              }
            }, 'Save')
          )
        ),
        document.body
      );
    });

    const ProfileSettingsModal = React.memo(function ProfileSettingsModal({
      open,
      onClose,
      onRequestHelp,
      autoInquiryEnabled,
      setAutoInquiryEnabled,
      autoPostNearbyEnabled,
      setAutoPostNearbyEnabled,
      onRequestDeleteAccount,
      onRequestCancelSubscription,
      onClearListingLocations,
      isMobile,
      user,
      subscriptionStatus: modalSubscriptionStatus
    }) {
      const [clearingLocations, setClearingLocations] = useState(false);
      const [dangerZoneOpen, setDangerZoneOpen] = useState(false);

      useEffect(() => {
        if (!open) {
          setDangerZoneOpen(false);
        }
      }, [open]);

      const [isDarkMode, setIsDarkMode] = useState(() => {
        if (typeof localStorage !== 'undefined') {
          return localStorage.getItem('theme') === 'dark';
        }
        return false;
      });

      useEffect(() => {
        const themeColorMeta = document.getElementById('theme-color-meta');
        if (isDarkMode) {
          document.documentElement.setAttribute('data-theme', 'dark');
          localStorage.setItem('theme', 'dark');
          if (themeColorMeta) themeColorMeta.content = '#0f172a';
        } else {
          document.documentElement.removeAttribute('data-theme');
          localStorage.setItem('theme', 'light');
          if (themeColorMeta) themeColorMeta.content = '#ffffff';
        }
        // Update iOS status bar style based on theme
        if (window.Capacitor?.isNativePlatform?.()) {
          try {
            const { StatusBar } = window.Capacitor.Plugins;
            if (StatusBar) {
              // Capacitor StatusBar naming is counterintuitive:
              // 'Light' = light/white TEXT (use on dark backgrounds)
              // 'Dark' = dark/black TEXT (use on light backgrounds)
              StatusBar.setStyle({ style: isDarkMode ? 'Light' : 'Dark' });
            }
          } catch (e) {
            console.log('StatusBar error:', e);
          }
        }
      }, [isDarkMode]);

      // Hide mobile dashboard when modal is open
      useEffect(() => {
        if (open) {
          document.body.classList.add('modal-open');
          return () => document.body.classList.remove('modal-open');
        }
      }, [open]);

      const hasDom = typeof document !== 'undefined' && document.body;
      if (!open || !hasDom) {
        return null;
      }

      const subscriptionStatus = modalSubscriptionStatus ?? user?.subscription_status ?? null;
      const cancellationDateText = formatSubscriptionEndDate(user?.subscription_current_period_end);
      const subscriptionMessage = subscriptionStatus === 'canceling'
        ? (cancellationDateText
          ? `Your cancellation is scheduled. Your subscription will end on ${cancellationDateText}. You will keep your supporter perks until then and can renew your subscription once it ends.`
          : 'Your cancellation is scheduled. You will keep your supporter perks until the end of your current billing period and can renew your subscription once it ends.')
        : 'You have an active monthly subscription';

      const handleOverlayClick = (evt) => {
        if (evt.target && evt.target.classList && evt.target.classList.contains('modal')) {
          onClose?.();
        }
      };

      const requestHelp = (topic) => {
        if (typeof onRequestHelp === 'function') {
          onRequestHelp(topic);
        }
      };

      return createPortal(
        H('div', {
          className: 'modal open',
          onClick: handleOverlayClick
        },
          H('div', {
            className: 'modal-inner profile-settings-modal',
            style: {
              maxWidth: '520px',
              width: 'min(520px, 92vw)',
              padding: '24px',
              borderRadius: 16,
              position: 'relative'
            }
          },
            H('button', {
              type: 'button',
              onClick: onClose,
              'aria-label': 'Close',
              style: {
                position: 'absolute',
                top: 8,
                right: 8,
                width: 28,
                height: 28,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#dc2626',
                fontSize: 22,
                fontWeight: 'bold',
                lineHeight: 1,
                zIndex: 10
              }
            }, '\u00D7'),
            H('div', { style: { display: 'grid', gap: 12 } },
              H('label', { className: 'toggle-card', style: { padding: '10px 14px', width: '100%' } },
                H('input', {
                  type: 'checkbox',
                  className: 'toggle-input',
                  checked: !!autoInquiryEnabled,
                  onChange: (e) => {
                    if (typeof setAutoInquiryEnabled === 'function') {
                      setAutoInquiryEnabled(e.target.checked);
                    }
                  }
                }),
                H('span', { className: 'toggle-slider', 'aria-hidden': true }),
                H('div', { className: 'toggle-copy' },
                  H('div', { style: { fontWeight: 700 } }, 'Or Best Offer'),
                  H('div', { className: 'muted', style: { fontSize: 12 } }, 'Add an offer banner to all subsequent listings')
                ),
                H('button', {
                  type: 'button',
                  className: 'help-btn',
                  onClick: (e) => { e.preventDefault(); e.stopPropagation(); requestHelp('inquiry'); },
                  title: 'OBO info',
                  style: {
                    marginLeft: 6, width: 24, height: 24, lineHeight: '22px',
                    borderRadius: 12, cursor: 'pointer'
                  }
                }, '?')
              ),
              isMobile && H('label', { className: 'toggle-card', style: { padding: '10px 14px', width: '100%' } },
                H('input', {
                  type: 'checkbox',
                  className: 'toggle-input',
                  checked: !!autoPostNearbyEnabled,
                  onChange: (e) => setAutoPostNearbyEnabled?.(e.target.checked)
                }),
                H('span', { className: 'toggle-slider', 'aria-hidden': true }),
                H('div', { className: 'toggle-copy' },
                  H('div', { style: { fontWeight: 700 } }, 'Distance Tag'),
                  H('div', { className: 'muted', style: { fontSize: 12 } }, 'Apply listing proximity to all subsequent listings')
                ),
                H('button', {
                  type: 'button',
                  className: 'help-btn',
                  onClick: (e) => { e.preventDefault(); e.stopPropagation(); requestHelp('nearby'); },
                  title: 'Nearby auto-post info',
                  style: {
                    marginLeft: 6, width: 24, height: 24, lineHeight: '22px',
                    borderRadius: 12, cursor: 'pointer'
                  }
                }, '?')
              ),
              H('label', { className: 'toggle-card', style: { padding: '10px 14px', width: '100%' } },
                H('input', {
                  type: 'checkbox',
                  className: 'toggle-input',
                  checked: isDarkMode,
                  onChange: (e) => setIsDarkMode(e.target.checked)
                }),
                H('span', { className: 'toggle-slider', 'aria-hidden': true }),
                H('div', { className: 'toggle-copy' },
                  H('div', { style: { fontWeight: 700 } }, 'Dark Mode'),
                  H('div', { className: 'muted', style: { fontSize: 12 } }, 'Tokyo Night theme')
                )
              ),
              // Show Apple subscription management info for Apple subscribers
              user?.apple_original_transaction_id && !user?.stripe_subscription_id && H('div', {
                style: {
                  marginTop: 24,
                  paddingTop: 24,
                  borderTop: '1px solid #e5e7eb'
                }
              },
                H('div', { style: { fontWeight: 700, marginBottom: 8 } }, 'Subscription'),
                H('div', { className: 'muted', style: { fontSize: 14, marginBottom: 12 } },
                  'Your subscription is managed through Apple. To cancel or manage your subscription, go to iOS Settings → Apple ID → Subscriptions.'
                )
              ),
              // Show cancel subscription button for subscribers with active Stripe subscription
              user?.stripe_subscription_id && H('div', {
                style: {
                  marginTop: 24,
                  paddingTop: 24,
                  borderTop: '1px solid #e5e7eb'
                }
              },
                H('div', { style: { fontWeight: 700, marginBottom: 8 } }, 'Subscription'),
                H('div', { className: 'muted', style: { fontSize: 14, marginBottom: 12 } }, subscriptionMessage),
                H('button', {
                  className: 'btn',
                  onClick: subscriptionStatus === 'canceling' ? undefined : onRequestCancelSubscription,
                  disabled: subscriptionStatus === 'canceling',
                  style: {
                    width: '100%',
                    background: '#f59e0b',
                    color: 'white',
                    border: 'none',
                    cursor: subscriptionStatus === 'canceling' ? 'not-allowed' : 'pointer',
                    opacity: subscriptionStatus === 'canceling' ? 0.7 : 1
                  }
                }, subscriptionStatus === 'canceling' ? 'Cancellation Scheduled' : 'Cancel Subscription')
              ),
              H('div', {
                style: {
                  marginTop: 24,
                  paddingTop: 24,
                  borderTop: '1px solid #e5e7eb'
                }
              },
                H('button', {
                  onClick: () => setDangerZoneOpen(!dangerZoneOpen),
                  className: 'btn',
                  style: {
                    width: '100%',
                    background: 'transparent',
                    color: '#dc2626',
                    border: '1px solid #dc2626',
                    fontWeight: 700
                  }
                }, 'Danger Zone'),
                dangerZoneOpen && H('div', {
                  style: {
                    marginTop: 12,
                    paddingTop: 12,
                    borderTop: '1px solid #e5e7eb'
                  }
                },
                  H('div', { className: 'muted', style: { fontSize: 13, marginBottom: 12 } },
                    'Clear coordinates from all your listings, doing so will remove the distance tag from all your listings that have them.'
                  ),
                  H('button', {
                    className: 'btn',
                    onClick: async () => {
                      if (!confirm('Are you sure you want to remove location data from ALL your listings? This cannot be undone.')) {
                        return;
                      }
                      setClearingLocations(true);
                      try {
                        await onClearListingLocations?.();
                      } catch (e) {
                        alert('Failed to clear locations. Please try again.');
                      } finally {
                        setClearingLocations(false);
                      }
                    },
                    disabled: clearingLocations,
                    style: {
                      width: '100%',
                      background: 'transparent',
                      color: '#f59e0b',
                      border: '1px solid #f59e0b',
                      marginBottom: 12,
                      opacity: clearingLocations ? 0.7 : 1
                    }
                  }, clearingLocations ? 'Clearing...' : 'Clear distance tags'),
                  H('button', {
                    className: 'btn',
                    onClick: onRequestDeleteAccount,
                    style: {
                      width: '100%',
                      background: 'transparent',
                      color: '#dc2626',
                      border: '1px solid #dc2626'
                    }
                  }, 'Delete Account')
                )
              )
            )
          )
        ),
        document.body
      );
    });

    const NotificationSettingsModal = React.memo(function NotificationSettingsModal({
      open,
      onClose,
      notificationsDisabled,
      setNotificationsDisabled,
      quietHoursEnabled,
      setQuietHoursEnabled,
      quietHoursStart,
      setQuietHoursStart,
      quietHoursEnd,
      setQuietHoursEnd,
      onSave,
      saving
    }) {
      // Hide mobile dashboard when modal is open
      useEffect(() => {
        if (open) {
          document.body.classList.add('modal-open');
          return () => document.body.classList.remove('modal-open');
        }
      }, [open]);

      const hasDom = typeof document !== 'undefined' && document.body;
      if (!open || !hasDom) {
        return null;
      }

      const handleOverlayClick = (evt) => {
        if (evt.target && evt.target.classList && evt.target.classList.contains('modal')) {
          onClose?.();
        }
      };

      return createPortal(
        H('div', {
          className: 'modal open',
          onClick: handleOverlayClick
        },
          H('div', {
            className: 'modal-inner notification-settings-modal',
            style: {
              maxWidth: '420px',
              width: 'min(420px, 92vw)',
              padding: '24px',
              borderRadius: 16,
              position: 'relative'
            }
          },
            H('div', { style: { display: 'grid', gap: 16 } },
              H('label', { className: 'toggle-card', style: { padding: '12px 14px', width: '100%' } },
                H('input', {
                  type: 'checkbox',
                  className: 'toggle-input',
                  checked: !!notificationsDisabled,
                  onChange: (e) => setNotificationsDisabled?.(e.target.checked)
                }),
                H('span', { className: 'toggle-slider', 'aria-hidden': true }),
                H('div', { className: 'toggle-copy' },
                  H('div', { style: { fontWeight: 700 } }, 'Disable all notifications'),
                  H('div', { className: 'muted', style: { fontSize: 12 } }, 'Stop all push notifications')
                )
              ),
              !notificationsDisabled && H('div', {
                className: 'quiet-hours-section',
                style: {
                  borderRadius: 12,
                  padding: 16
                }
              },
                H('label', { className: 'toggle-card', style: { padding: '10px 0', width: '100%', border: 'none', background: 'transparent' } },
                  H('input', {
                    type: 'checkbox',
                    className: 'toggle-input',
                    checked: !!quietHoursEnabled,
                    onChange: (e) => setQuietHoursEnabled?.(e.target.checked)
                  }),
                  H('span', { className: 'toggle-slider', 'aria-hidden': true }),
                  H('div', { className: 'toggle-copy' },
                    H('div', { style: { fontWeight: 700 } }, 'Quiet hours'),
                    H('div', { className: 'muted', style: { fontSize: 12 } }, 'Silence notifications during set times')
                  )
                ),
                quietHoursEnabled && H('div', {
                  style: {
                    marginTop: 16,
                    display: 'grid',
                    gap: 12
                  }
                },
                  H('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
                    H('label', { style: { display: 'grid', gap: 4 } },
                      H('span', { style: { fontSize: 13, fontWeight: 600 } }, 'Start time'),
                      H('input', {
                        type: 'time',
                        value: quietHoursStart || '20:30',
                        onChange: (e) => setQuietHoursStart?.(e.target.value),
                        style: {
                          padding: '8px 4px',
                          border: '1px solid #d1d5db',
                          borderRadius: 8,
                          fontSize: 14,
                          boxSizing: 'border-box'
                        }
                      })
                    ),
                    H('label', { style: { display: 'grid', gap: 4 } },
                      H('span', { style: { fontSize: 13, fontWeight: 600 } }, 'End time'),
                      H('input', {
                        type: 'time',
                        value: quietHoursEnd || '09:30',
                        onChange: (e) => setQuietHoursEnd?.(e.target.value),
                        style: {
                          padding: '8px 4px',
                          border: '1px solid #d1d5db',
                          borderRadius: 8,
                          fontSize: 14,
                          boxSizing: 'border-box'
                        }
                      })
                    )
                  ),
                  H('p', {
                    className: 'muted',
                    style: { fontSize: 12, margin: 0 }
                  }, 'Notifications will be silenced between these times daily.')
                )
              ),
              H('div', {
                style: {
                  marginTop: 8,
                  display: 'flex',
                  justifyContent: 'flex-end'
                }
              },
                H('button', {
                  className: 'btn primary',
                  type: 'button',
                  onClick: onSave,
                  disabled: saving
                }, saving ? 'Saving...' : 'Save')
              )
            )
          )
        ),
        document.body
      );
    });

    const ProfilePanel = React.memo(function ProfilePanel({
      isMobile,
      user,
      items,
      onEnsureCover,
      onEdit,
      onDelete,
      onLogout,
      onAdminDelete,
      autoPostNearbyEnabled,
      setAutoPostNearbyEnabled,
      autoInquiryEnabled,
      setAutoInquiryEnabled,
      onViewSeller,
      onToggleSold,
      onSupporterClick,
      onJoinSupporterProgram,
      onListingsChanged,
      onMessage,
      onToggleSave,
      savedListingIds: parentSavedIds = {}
    }) {
      const [helpModal, setHelpModal] = useState(null);
      const [profileSelected, setProfileSelected] = useState(null);
      const premiumFreeForAll = Boolean(user?.payments_disabled);
      const [settingsOpen, setSettingsOpen] = useState(false);
      const [paypalModalOpen, setPaypalModalOpen] = useState(false);
      const [paypalStatusMessage, setPaypalStatusMessage] = useState('');
      const [locationStatusMessage, setLocationStatusMessage] = useState('');
      const [profilePictureModalOpen, setProfilePictureModalOpen] = useState(false);
      const [profilePictureUrl, setProfilePictureUrl] = useState(user?.profile_picture_url || '');
      const [deleteAccountModalOpen, setDeleteAccountModalOpen] = useState(false);
      const [deleteConfirmText, setDeleteConfirmText] = useState('');
      const [deleteAccountError, setDeleteAccountError] = useState('');
      const [cancelSubscriptionModalOpen, setCancelSubscriptionModalOpen] = useState(false);
      const [cancelSubscriptionBusy, setCancelSubscriptionBusy] = useState(false);
      const [subscriptionStatus, setSubscriptionStatus] = useState(user?.subscription_status || null);
      const [profileAvatarBorderColor, setProfileAvatarBorderColor] = useState(user?.profile_avatar_border_color || '#ffffff');
      const [profileAvatarBorderStyle, setProfileAvatarBorderStyle] = useState(user?.profile_avatar_border_style || 'solid');
      const [profileBgImageUrl, setProfileBgImageUrl] = useState(user?.profile_bg_image_url || user?.profile_bg_video_url || '');
      const [profileBgImageUploading, setProfileBgImageUploading] = useState(false);
      const [profileBgImageUploadError, setProfileBgImageUploadError] = useState('');
      const [profileCustomizationModalOpen, setProfileCustomizationModalOpen] = useState(false);
      const [profileCustomizationStatusMessage, setProfileCustomizationStatusMessage] = useState('');
      const [notificationSettingsModalOpen, setNotificationSettingsModalOpen] = useState(false);
      const [notificationsDisabled, setNotificationsDisabled] = useState(user?.notifications_disabled || false);
      const [quietHoursEnabled, setQuietHoursEnabled] = useState(user?.quiet_hours_enabled || false);
      const [quietHoursStart, setQuietHoursStart] = useState(user?.quiet_hours_start || '20:30');
      const [quietHoursEnd, setQuietHoursEnd] = useState(user?.quiet_hours_end || '09:30');
      const [notificationSettingsSaving, setNotificationSettingsSaving] = useState(false);
      const [blockedUsersModalOpen, setBlockedUsersModalOpen] = useState(false);
      const [blockedUsersList, setBlockedUsersList] = useState([]);
      const [blockedUsersLoading, setBlockedUsersLoading] = useState(false);
      const isPremiumUser = useMemo(() => {
        return premiumFreeForAll || !!user?.supporter_tier || user?.supporter_badge || user?.subscription_status === 'active';
      }, [premiumFreeForAll, user?.supporter_tier, user?.supporter_badge, user?.subscription_status]);

      const isDarkMode = typeof document !== 'undefined' &&
        (document.documentElement.getAttribute('data-theme') === 'dark' ||
         localStorage.getItem('theme') === 'dark');

      useEffect(() => {
        if (!user) return;
        const url = user.profile_picture_url || '';

        // Only update state if user object has the profile_picture_url property
        // This prevents overwriting with empty string when user object is being updated
        if ('profile_picture_url' in user) {
          setProfilePictureUrl(url);
        }
      }, [user]);

      useEffect(() => {
        if (user && 'subscription_status' in user) {
          setSubscriptionStatus(user.subscription_status || null);
        }
      }, [user]);

      useEffect(() => {
        if (!user) return;
        if ('profile_bg_image_url' in user || 'profile_bg_video_url' in user) {
          setProfileBgImageUrl(user.profile_bg_image_url || user.profile_bg_video_url || '');
        }
      }, [user]);

      const handleEdit = useCallback((it) => {
        setProfileSelected(null);
        onEdit?.(it);
      }, [onEdit]);

      const handleDelete = useCallback(async (it) => {
        if (onDelete) await onDelete(it);
        setProfileSelected(null);
      }, [onDelete]);

      const handleAdminDelete = useCallback(async (id) => {
        if (onAdminDelete) await onAdminDelete(id);
        setProfileSelected(null);
      }, [onAdminDelete]);

      const handleOpenSettings = useCallback(() => {
        setSettingsOpen(true);
      }, []);

      const handleCloseSettings = useCallback(() => {
        setSettingsOpen(false);
        setHelpModal(null);
      }, [setHelpModal]);

      const handleOpenPaypalModal = useCallback(() => {
        setPaypalStatusMessage('');
        setLocationStatusMessage('');
        setPaypalModalOpen(true);
      }, []);

      const handleClosePaypalModal = useCallback(() => {
        setPaypalModalOpen(false);
        setPaypalStatusMessage('');
        setLocationStatusMessage('');
      }, []);

      const handleOpenBlockedUsers = useCallback(async () => {
        setBlockedUsersModalOpen(true);
        setBlockedUsersLoading(true);
        try {
          const result = await api.getBlockedUsers({ silent: true });
          setBlockedUsersList(result?.blocked_users || []);
        } catch (err) {
          console.error('Failed to load blocked users:', err);
          setBlockedUsersList([]);
        } finally {
          setBlockedUsersLoading(false);
        }
      }, []);

      const handleCloseBlockedUsers = useCallback(() => {
        setBlockedUsersModalOpen(false);
      }, []);

      const handleUnblockUser = useCallback(async (userId) => {
        if (!window.confirm('Unblock this user? You will be able to see their listings and message them again.')) {
          return;
        }
        try {
          await api.unblockUser(userId);
          setBlockedUsersList(prev => prev.filter(u => u.id !== userId));
        } catch (err) {
          console.error('Failed to unblock user:', err);
          alert('Failed to unblock user. Please try again.');
        }
      }, []);

      const [profileTab, setProfileTab] = useState('active');
      const [savedListings, setSavedListings] = useState([]);
      const [savedListingsLoading, setSavedListingsLoading] = useState(false);

      // Fetch saved listings when switching to saved tab
      useEffect(() => {
        if (profileTab !== 'saved' || !user) return;
        let cancelled = false;
        setSavedListingsLoading(true);
        api.getSavedListings({ silent: true })
          .then(result => {
            if (cancelled) return;
            const listings = (result?.listings || []).map(item => ({
              ...item,
              // Add __cover for grid display (use thumb_url or image_data)
              __cover: item.thumb_url || item.image_data || '',
              __fullCover: item.image_data || ''
            }));
            setSavedListings(listings);
          })
          .catch(() => {
            if (cancelled) return;
            setSavedListings([]);
          })
          .finally(() => {
            if (!cancelled) setSavedListingsLoading(false);
          });
        return () => { cancelled = true; };
      }, [profileTab, user]);

      // Handle unsave from saved tab - calls parent toggle and closes modal
      const handleToggleSave = useCallback(async (listing, save) => {
        if (!user || !listing?.id) return;
        if (!save) {
          // Remove from local saved listings display immediately
          setSavedListings(prev => prev.filter(l => l.id !== listing.id));
          // Close the modal immediately when unsaving from saved tab
          setProfileSelected(null);
        }
        // Call parent's toggle to update main app state
        if (onToggleSave) {
          await onToggleSave(listing, save);
        }
      }, [user, onToggleSave]);

      const [paypalEmailState, setPaypalEmailState] = useState(user?.paypal_email || '');
      const paypalEmailRef = useRef(paypalEmailState);
      const setPaypalEmail = useCallback((value) => {
        const resolved = typeof value === 'function' ? value(paypalEmailRef.current) : value;
        paypalEmailRef.current = resolved;
        setPaypalEmailState(resolved);
      }, [paypalEmailRef, setPaypalEmailState]);
      const paypalEmail = paypalEmailState;
      const [locationPresetState, setLocationPresetState] = useState(user?.location_preset || '');
      const locationPresetRef = useRef(locationPresetState);
      const setLocationPreset = useCallback((value) => {
        const resolved = typeof value === 'function' ? value(locationPresetRef.current) : value;
        locationPresetRef.current = resolved;
        setLocationPresetState(resolved);
      }, [locationPresetRef, setLocationPresetState]);
      const locationPreset = locationPresetState;
      const [profileAboutState, setProfileAboutState] = useState(user?.profile_about || '');
      const profileAboutRef = useRef(profileAboutState);
      const setProfileAbout = useCallback((value) => {
        const resolved = typeof value === 'function' ? value(profileAboutRef.current) : value;
        profileAboutRef.current = resolved;
        setProfileAboutState(resolved);
      }, [profileAboutRef, setProfileAboutState]);
      const profileAbout = profileAboutState;

      useEffect(() => {
        if (!user) return;
        // Sync from server when user.profile_about changes
        if ('profile_about' in user) {
          const serverValue = user.profile_about || '';
          // Only update if different to avoid unnecessary re-renders
          if (profileAboutRef.current !== serverValue) {
            setProfileAbout(serverValue);
          }
        }
      }, [user?.profile_about, setProfileAbout]);
      const [profileAboutStatusMessage, setProfileAboutStatusMessage] = useState('');

      const profileSupporter = useMemo(() => {
        if (!user || !user.supporter_badge) {
          return null;
        }
        const usernameLabel = user.username
          ? user.username
          : (user.email || 'This user');
        return {
          username: usernameLabel,
          since: user.supporter_since || null,
          tier: user.supporter_tier || null,
          monthsCredited: user.supporter_months_credited || 0
        };
      }, [user]);
      const userCreatedAt = user?.created_at || null;
      const userJoinedText = useMemo(() => {
        if (!userCreatedAt) return null;
        return formatElapsedSince(userCreatedAt);
      }, [userCreatedAt]);
      const handleSelfSupporterClick = useCallback(() => {
        if (!profileSupporter) return;
        onSupporterClick?.({
          username: profileSupporter.username,
          since: profileSupporter.since || null,
          tier: profileSupporter.tier || null,
          isSelf: true
        });
      }, [onSupporterClick, profileSupporter]);
      const handleJoinSupporterClick = useCallback(() => {
        if (typeof onJoinSupporterProgram === 'function') {
          onJoinSupporterProgram();
        }
      }, [onJoinSupporterProgram]);
      // DISABLED: Payment removed from app - app is free
      // const showSupporterCta = !profileSupporter && typeof onJoinSupporterProgram === 'function' && !premiumFreeForAll;
      const showSupporterCta = false;
      const visuallyHidden = {
        position: 'absolute',
        width: 1,
        height: 1,
        padding: 0,
        margin: -1,
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
        border: 0
      };
      const handleChangePaypalEmail = useCallback((value) => {
        setPaypalEmail(value);
        if (paypalStatusMessage) {
          setPaypalStatusMessage('');
        }
      }, [paypalStatusMessage]);

      const handleChangeLocationPreset = useCallback((value) => {
        setLocationPreset(value);
        if (locationStatusMessage) {
          setLocationStatusMessage('');
        }
      }, [locationStatusMessage]);

      const handleChangeProfileAbout = useCallback((value) => {
        setProfileAbout(value);
        if (profileAboutStatusMessage) {
          setProfileAboutStatusMessage('');
        }
      }, [profileAboutStatusMessage, setProfileAbout]);
      async function savePaypal() {
        const trimmed = (paypalEmailRef.current || '').trim();
        let response;
        try {
          response = await api.updatePaypalEmail(trimmed);
        } catch (err) {
          alert(err?.message || 'Failed to save PayPal preset.');
          return;
        }
        if (response?.error) { alert(response.error); return; }
        const nextPaypalEmail = typeof response?.paypal_email === 'string' ? response.paypal_email : trimmed;
        setPaypalEmail(nextPaypalEmail);
        if (user) {
          navBridge.setUser?.({ ...user, paypal_email: nextPaypalEmail });
        }
        try {
          const me = await api.me({ silent: true });
          if (me) {
            navBridge.setUser?.(me);
          }
        } catch (err) {
          console.error('Refresh user failed:', err);
        }
        setPaypalStatusMessage('Saved');
      }

      async function saveLocationPreset() {
        const trimmed = (locationPresetRef.current || '').trim();
        let response;
        try {
          if (typeof api.updateLocationPreset !== 'function') {
            throw new Error('updateLocationPreset unavailable');
          }
          response = await api.updateLocationPreset(trimmed);
        } catch (err) {
          alert(err?.message || 'Failed to save address preset.');
          return;
        }
        if (response?.error) { alert(response.error); return; }
        const nextLocation = typeof response?.location_preset === 'string' ? response.location_preset : trimmed;
        setLocationPreset(nextLocation);
        if (user) {
          navBridge.setUser?.({ ...user, location_preset: nextLocation });
        }
        try {
          const me = await api.me({ silent: true });
          if (me) {
            navBridge.setUser?.(me);
          }
        } catch (err) {
          console.error('Refresh user failed:', err);
        }
        setLocationStatusMessage('Saved');
      }

      async function saveProfileAbout() {
        const currentValue = profileAboutRef.current || '';
        let response;
        try {
          if (typeof api.updateProfileAbout !== 'function') {
            throw new Error('updateProfileAbout unavailable');
          }
          response = await api.updateProfileAbout(currentValue);
        } catch (err) {
          alert(err?.message || 'Failed to save about text.');
          return;
        }
        if (response?.error) { alert(response.error); return; }
        const nextAbout = typeof response?.profile_about === 'string' ? response.profile_about : (currentValue || '');
        setProfileAbout(nextAbout);
        if (user) {
          navBridge.setUser?.({ ...user, profile_about: nextAbout });
        }
        try {
          const me = await api.me({ silent: true });
          if (me) {
            navBridge.setUser?.(me);
          }
        } catch (err) {
          console.error('Refresh user failed:', err);
        }
        setProfileAboutStatusMessage('Saved');
        setTimeout(() => {
          setProfileAboutStatusMessage('');
        }, 2000);
      }

      const handleOpenNotificationSettingsModal = useCallback(() => {
        setNotificationSettingsModalOpen(true);
      }, []);

      const handleCloseNotificationSettingsModal = useCallback(() => {
        setNotificationSettingsModalOpen(false);
      }, []);

      const saveNotificationSettings = useCallback(async () => {
        setNotificationSettingsSaving(true);
        try {
          // Get user's timezone offset in minutes (e.g., 300 for EST which is UTC-5)
          const timezoneOffset = new Date().getTimezoneOffset();
          const response = await api.updateNotificationSettings({
            notifications_disabled: notificationsDisabled,
            quiet_hours_enabled: quietHoursEnabled,
            quiet_hours_start: quietHoursStart,
            quiet_hours_end: quietHoursEnd,
            timezone_offset: timezoneOffset
          });
          if (response?.error) {
            alert(response.error);
          } else {
            if (user) {
              navBridge.setUser?.({
                ...user,
                notifications_disabled: notificationsDisabled,
                quiet_hours_enabled: quietHoursEnabled,
                quiet_hours_start: quietHoursStart,
                quiet_hours_end: quietHoursEnd,
                timezone_offset: timezoneOffset
              });
            }
            setNotificationSettingsModalOpen(false);
          }
        } catch (err) {
          alert(err?.message || 'Failed to save notification settings');
        } finally {
          setNotificationSettingsSaving(false);
        }
      }, [notificationsDisabled, quietHoursEnabled, quietHoursStart, quietHoursEnd, user]);

      const handleOpenProfilePictureModal = useCallback(() => {
        setProfilePictureModalOpen(true);
      }, []);

      const handleCloseProfilePictureModal = useCallback(() => {
        setProfilePictureModalOpen(false);
      }, []);

      const handleProfilePictureUploadComplete = useCallback(async (url) => {
        setProfilePictureUrl(url);
        // Refresh user data
        try {
          const me = await api.me({ silent: true });
          if (me) {
            navBridge.setUser?.(me);
          }
        } catch (err) {
          console.error('Refresh user failed:', err);
        }
      }, []);

      const handleRequestDeleteAccount = useCallback(() => {
        setSettingsOpen(false);
        setDeleteAccountModalOpen(true);
        setDeleteConfirmText('');
        setDeleteAccountError('');
      }, []);

      const handleCloseDeleteAccountModal = useCallback(() => {
        setDeleteAccountModalOpen(false);
        setDeleteConfirmText('');
        setDeleteAccountError('');
      }, []);

      const handleDeleteAccount = useCallback(async () => {
        if (deleteConfirmText !== 'confirm') {
          setDeleteAccountError('Please type "confirm" to delete your account');
          return;
        }

        try {
          await api.deleteAccount('confirm');
          // Account deleted, user is logged out
          onLogout?.();
        } catch (err) {
          console.error('Delete account failed:', err);
          setDeleteAccountError(err.message || 'Failed to delete account');
        }
      }, [deleteConfirmText, onLogout]);

      const saveProfileCustomization = useCallback(async () => {
        if (!api || typeof api.updateProfileCustomization !== 'function') {
          alert('Profile customization API not available');
          return;
        }
        try {
          setProfileCustomizationStatusMessage('Saving...');
          const response = await api.updateProfileCustomization({
            profile_avatar_border_color: profileAvatarBorderColor,
            profile_avatar_border_style: profileAvatarBorderStyle,
            profile_bg_image_url: profileBgImageUrl
          });
          if (response?.error) {
            alert(response.error);
            setProfileCustomizationStatusMessage('');
            return;
          }
          if (user) {
            navBridge.setUser?.({
              ...user,
              profile_avatar_border_color: profileAvatarBorderColor,
              profile_avatar_border_style: profileAvatarBorderStyle,
              profile_bg_video_url: null,
              profile_bg_image_url: profileBgImageUrl
            });
          }
          setProfileCustomizationStatusMessage('Saved!');
          setTimeout(() => {
            setProfileCustomizationStatusMessage('');
          }, 2000);
        } catch (err) {
          alert(err?.message || 'Failed to save profile customization');
          setProfileCustomizationStatusMessage('');
        }
      }, [profileAvatarBorderColor, profileAvatarBorderStyle, profileBgImageUrl, user]);

      const handleUploadProfileBgImage = useCallback(async (file) => {
        if (!file || !isPremiumUser) {
          return;
        }
        if (!api?.signUpload || !api?.finalizeUpload) {
          setProfileBgImageUploadError('Uploads are unavailable right now.');
          return;
        }
        if (!file.type || !file.type.startsWith('image/')) {
          setProfileBgImageUploadError('Please upload an image file.');
          return;
        }
        const maxBytes = 8 * 1024 * 1024;
        if (file.size > maxBytes) {
          setProfileBgImageUploadError('Image must be under 8MB.');
          return;
        }
        setProfileBgImageUploading(true);
        setProfileBgImageUploadError('');
        try {
          const sig = await api.signUpload({ filename: file.name, contentType: file.type, bytes: file.size });
          if (!sig || sig.error || !sig.uploadUrl || !sig.publicUrl || !sig.Key) {
            throw new Error(sig?.error || 'Upload failed');
          }
          const uploadRes = await fetch(sig.uploadUrl, {
            method: 'PUT',
            body: file,
            headers: { 'Content-Type': file.type }
          });
          if (!uploadRes.ok) {
            throw new Error('Upload failed');
          }
          const finalizeRes = await api.finalizeUpload({ key: sig.Key, url: sig.publicUrl, bytes: file.size }, { silent: true });
          if (finalizeRes?.error) {
            throw new Error(finalizeRes.error);
          }
          const nextUrl = finalizeRes?.url || sig.publicUrl;
          setProfileBgImageUrl(nextUrl);
          setProfileCustomizationStatusMessage('Image uploaded. Click Save to keep it.');
        } catch (err) {
          console.error('Profile banner image upload failed:', err);
          setProfileBgImageUploadError(err?.message || 'Failed to upload image');
        } finally {
          setProfileBgImageUploading(false);
        }
      }, [api, isPremiumUser]);

      const handleClearProfileBgImage = useCallback(() => {
        if (!isPremiumUser) {
          return;
        }
        setProfileBgImageUrl('');
        setProfileBgImageUploadError('');
        setProfileCustomizationStatusMessage('Background image removed. Click Save to apply.');
      }, [isPremiumUser]);

      const handleRequestCancelSubscription = useCallback(() => {
        setCancelSubscriptionModalOpen(true);
      }, []);

      const handleCloseCancelSubscriptionModal = useCallback(() => {
        setCancelSubscriptionModalOpen(false);
      }, []);

      const handleConfirmCancelSubscription = useCallback(async () => {
        setCancelSubscriptionBusy(true);
        try {
          await api.cancelSubscription();
          setSubscriptionStatus('canceling');
          if (user) {
            navBridge.setUser?.({ ...user, subscription_status: 'canceling' });
          }
          setCancelSubscriptionModalOpen(false);
          setSettingsOpen(false);
          // Refresh user data to update UI
          window.location.reload();
        } catch (err) {
          console.error('Cancel subscription failed:', err);
          alert(err.message || 'Failed to cancel subscription');
        } finally {
          setCancelSubscriptionBusy(false);
        }
      }, [user]);


      if (!user) {
        return H('section', { className: 'card', style: { padding: 16, margin: '12px 0 16px' } },
          H('div', { style: { fontWeight: 800, fontSize: 18, marginBottom: 6 } }, 'Profile'),
          H('div', { className: 'muted' }, 'Please log in to view your profile.')
        );
      }

      const activeItems = asArray(items).filter(it => !it?.sold);
      const soldItems = asArray(items).filter(it => !!it?.sold);
      const shownItems = profileTab === 'sold' ? soldItems : (profileTab === 'saved' ? savedListings : activeItems);
      const trimmedBgImageUrl = (profileBgImageUrl || '').trim();
      const hasCustomBanner = !!trimmedBgImageUrl;
      // Always show banner (custom or default)
      const hasBgImage = true;
      const avatarBorderStyleValue = profileAvatarBorderStyle === 'dashed' ? 'dashed' : 'solid';
      const avatarBorderColorValue = typeof profileAvatarBorderColor === 'string' && profileAvatarBorderColor.trim()
        ? profileAvatarBorderColor.trim()
        : '#ffffff';
      const profileHeaderContent = H('div', { style: { position: 'relative', minHeight: hasBgImage ? 180 : 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' } },
        H('div', { className: 'row', style: { gap: 12, alignItems: 'center', position: 'absolute', bottom: -6, left: -8 } },
          H('div', {
            className: 'profile-avatar',
            onClick: (e) => {
              e.stopPropagation();
              handleOpenProfilePictureModal();
            },
            style: {
              cursor: 'pointer',
              borderColor: avatarBorderColorValue,
              borderStyle: avatarBorderStyleValue,
              borderWidth: 4,
              boxShadow: hasBgImage
                ? '0 16px 35px rgba(2, 6, 23, 0.5)'
                : '0 8px 18px rgba(15, 23, 42, 0.25)'
            },
            title: 'Click to change profile picture'
          },
            (profilePictureUrl && profilePictureUrl.trim())
              ? H('img', {
                src: profilePictureUrl,
                alt: 'Profile picture',
                onError: (e) => {
                  console.error('Failed to load profile picture:', profilePictureUrl);
                  e.target.style.display = 'none';
                }
              })
              : (user.username ? user.username.charAt(0).toUpperCase() : user.email.charAt(0).toUpperCase())
          ),
          H('div', { style: { display: 'grid', gap: 6, alignItems: 'flex-start' } },
            H('div', { style: { fontWeight: 800, fontSize: 18 } },
              user.username ? user.username : user.email
            ),
            // Stats pills (active, sold, karma)
            H('div', {
              style: {
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
                marginTop: 8
              }
            },
              // Active listings pill
              H('span', {
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 999,
                  border: '1px solid rgba(148, 163, 184, 0.3)',
                  background: 'rgba(248, 250, 252, 0.05)',
                  fontSize: 13,
                  color: '#f8fafc',
                  fontWeight: 600
                }
              }, '🛍️ ', activeItems.length, ' active'),
              // Sold pill
              H('span', {
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 999,
                  border: '1px solid rgba(148, 163, 184, 0.3)',
                  background: 'rgba(248, 250, 252, 0.05)',
                  fontSize: 13,
                  color: '#f8fafc',
                  fontWeight: 600
                }
              }, '✅ ', soldItems.length, ' sold')
              // KARMA DISABLED
              // // Karma pill (only for supporters with karma > 0)
              // profileSupporter && user.karma > 0 && H('span', {
              //   style: {
              //     display: 'inline-flex',
              //     alignItems: 'center',
              //     gap: 6,
              //     padding: '6px 12px',
              //     borderRadius: 999,
              //     border: '1px solid rgba(251, 191, 36, 0.4)',
              //     background: 'linear-gradient(135deg, rgba(251, 191, 36, 0.15), rgba(245, 158, 11, 0.15))',
              //     fontSize: 13,
              //     color: '#fbbf24',
              //     fontWeight: 600
              //   }
              // },
              //   H('svg', {
              //     viewBox: '0 0 24 24',
              //     width: 14,
              //     height: 14,
              //     fill: 'currentColor',
              //     style: { flexShrink: 0 }
              //   },
              //     H('path', { d: 'M13 2L3 14h8l-1 8 10-12h-8l1-8z', fill: '#fbbf24' })
              //   ),
              //   ' ',
              //   user.karma,
              //   ' karma'
              // )
            )
          )
        ),
      );
      const profileHeader = H('div', {
        style: {
          position: 'relative',
          height: 220,
          overflow: 'hidden'
        }
      },
        // Show custom banner if uploaded, otherwise show default trovelr banner
        hasCustomBanner
          ? H('img', {
            key: trimmedBgImageUrl,
            src: trimmedBgImageUrl,
            alt: 'Profile banner',
            loading: 'lazy',
            decoding: 'async',
            style: {
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover'
            }
          })
          : H(DefaultProfileBanner),
        // Gradient overlay (stronger for custom images, subtle for default)
        H('div', {
          style: {
            position: 'absolute',
            inset: 0,
            background: hasCustomBanner
              ? 'linear-gradient(180deg, rgba(15, 23, 42, 0.15) 0%, rgba(15, 23, 42, 0.92) 100%)'
              : 'linear-gradient(180deg, rgba(15, 23, 42, 0) 0%, rgba(15, 23, 42, 0.7) 100%)'
          }
        }),
        H('div', {
          style: {
            position: 'relative',
            padding: '16px 16px 60px',
            color: '#f8fafc'
          }
        }, profileHeaderContent)
      );
      const profileSections = [
        H('section', {
          className: 'card',
          onClick: () => setProfileCustomizationModalOpen(true),
          style: {
            padding: hasBgImage ? 0 : 16,
            margin: '12px 0 16px',
            overflow: hasBgImage ? 'hidden' : undefined,
            background: hasBgImage ? '#020617' : undefined,
            color: hasBgImage ? '#f8fafc' : undefined,
            cursor: 'pointer'
          }
        }, profileHeader),

        H('div', { className: 'row', style: { gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 16px', justifyContent: 'space-between' } },
          // Left side: Supporter badge and join date
          H('div', { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } },
            profileSupporter && H(SupporterBadge, {
              size: 'sm',
              since: profileSupporter.since,
              tier: profileSupporter.tier,
              onClick: handleSelfSupporterClick
            }),
            userJoinedText && H('div', { className: 'muted', style: { fontSize: 13 } }, `Trovelr since ${userJoinedText}`)
          ),
          // Right side: Action buttons
          H('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            // Premium/Supporter button for non-supporters
            showSupporterCta && H('button', {
            className: 'premium-badge-btn',
            type: 'button',
            onClick: handleJoinSupporterClick,
            title: 'Get Premium',
            style: {
              ...iconButtonStyle,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer'
            }
          },
            H(SupporterBadge, { size: 'sm', tier: 'basic' }),
            H('span', { style: visuallyHidden }, 'Get Premium')
          ),
          H('button', {
            className: 'btn',
            type: 'button',
            onClick: handleOpenPaypalModal,
            title: 'Manage payment preset',
            style: iconButtonStyle
          },
            H(SettingsIcon, null),
            H('span', { style: visuallyHidden }, 'Manage payment preset')
          ),

          H('button', {
            className: 'btn',
            type: 'button',
            onClick: handleOpenNotificationSettingsModal,
            title: 'Notification settings',
            style: iconButtonStyle
          },
            H(NotificationIcon, null),
            H('span', { style: visuallyHidden }, 'Notification settings')
          ),

          H('button', {
            className: 'btn',
            type: 'button',
            onClick: handleOpenSettings,
            title: 'Profile settings',
            style: iconButtonStyle
          },
            H(PresetIcon, null),
            H('span', { style: visuallyHidden }, 'Open profile settings')
          ),
          H('button', {
            className: 'btn',
            type: 'button',
            onClick: onLogout,
            title: 'Log out',
            style: iconButtonStyle
          },
            H(LogoutIcon, null),
            H('span', { style: visuallyHidden, onClick: onLogout }, 'Log out')
          )
          )
        ),

        H('section', null,
          H('div', {
            className: 'profile-tab-bar',
            style: {
              display: 'flex',
              position: 'relative',
              margin: '0 0 16px',
              background: 'transparent',
              borderRadius: 10,
              padding: 4
            }
          },
            // Sliding indicator
            H('div', {
              style: {
                position: 'absolute',
                top: 4,
                bottom: 4,
                left: `calc(${profileTab === 'active' ? 0 : profileTab === 'sold' ? 33.333 : 66.666}% + 4px)`,
                width: 'calc(33.333% - 8px)',
                background: '#3b82f6',
                borderRadius: 8,
                transition: 'left 0.2s ease',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
              }
            }),
            H('button', {
              type: 'button',
              style: {
                flex: 1,
                padding: '10px 0',
                border: 'none',
                background: 'transparent',
                color: profileTab === 'active' ? '#fff' : (isDarkMode ? '#9ca3af' : '#4b5563'),
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer',
                position: 'relative',
                zIndex: 1,
                transition: 'color 0.2s ease'
              },
              onClick: () => setProfileTab('active')
            }, 'Active'),
            H('button', {
              type: 'button',
              style: {
                flex: 1,
                padding: '10px 0',
                border: 'none',
                background: 'transparent',
                color: profileTab === 'sold' ? '#fff' : (isDarkMode ? '#9ca3af' : '#4b5563'),
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer',
                position: 'relative',
                zIndex: 1,
                transition: 'color 0.2s ease'
              },
              onClick: () => setProfileTab('sold')
            }, 'Sold'),
            H('button', {
              type: 'button',
              style: {
                flex: 1,
                padding: '10px 0',
                border: 'none',
                background: 'transparent',
                color: profileTab === 'saved' ? '#fff' : (isDarkMode ? '#9ca3af' : '#4b5563'),
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer',
                position: 'relative',
                zIndex: 1,
                transition: 'color 0.2s ease'
              },
              onClick: () => setProfileTab('saved')
            }, 'Saved')
          ),
          // Loading state for saved tab
          profileTab === 'saved' && savedListingsLoading && H('p', {
            className: 'muted',
            style: { textAlign: 'center', margin: '28px 0' }
          }, 'Loading saved listings...'),
          // Content for all tabs
          !savedListingsLoading && (shownItems.length
            ? (ListingsGrid
              ? H(ListingsGrid, {
                items: shownItems,
                onEnsureCover: onEnsureCover,
                onSelect: (evt, item) => setProfileSelected(item),
                columns: isMobile ? 3 : 4,
                onSupporterClick
              })
              : H('div', { style: { padding: 16 } }, 'ListingsGrid component not available')
            )
            : H('p', {
              className: 'muted',
              style: { textAlign: 'center', margin: '28px 0' }
            }, profileTab === 'sold' ? 'No sold listings yet.' : (profileTab === 'saved' ? 'No saved listings yet.' : 'No listings yet. Create your first one!'))
          )
        ),

        helpModal === 'auto' && H(AutoListHelpModal, { onClose: () => setHelpModal(null) }),
        helpModal === 'nearby' && H(AutoPostNearbyHelpModal, { onClose: () => setHelpModal(null) }),
        helpModal === 'inquiry' && H(InquiryHelpModal, { onClose: () => setHelpModal(null) }),

        H(PresetModal, {
          open: paypalModalOpen,
          onClose: handleClosePaypalModal,
          locationPreset,
          onChangeLocationPreset: handleChangeLocationPreset,
          onSaveLocation: saveLocationPreset,
          locationStatusMessage: locationStatusMessage,
          profileAbout,
          onChangeProfileAbout: handleChangeProfileAbout,
          onSaveProfileAbout: saveProfileAbout,
          profileAboutStatusMessage,
          onOpenBlockedUsers: handleOpenBlockedUsers
        }),

        H(BlockedUsersListModal, {
          open: blockedUsersModalOpen,
          onClose: handleCloseBlockedUsers,
          blockedUsers: blockedUsersList,
          loading: blockedUsersLoading,
          onUnblock: handleUnblockUser
        }),

        H(ProfileCustomizationModal, {
          open: profileCustomizationModalOpen,
          onClose: () => setProfileCustomizationModalOpen(false),
          borderColor: profileAvatarBorderColor,
          onChangeBorderColor: setProfileAvatarBorderColor,
          borderStyle: profileAvatarBorderStyle,
          onChangeBorderStyle: setProfileAvatarBorderStyle,
          bgImageUrl: profileBgImageUrl,
          onUploadBgImage: handleUploadProfileBgImage,
          onClearBgImage: handleClearProfileBgImage,
          bgImageUploading: profileBgImageUploading,
          bgImageUploadError: profileBgImageUploadError,
          onSave: saveProfileCustomization,
          statusMessage: profileCustomizationStatusMessage,
          isPremium: isPremiumUser,
          username: user?.username || user?.email,
          profilePictureUrl: profilePictureUrl
        }),

        H(ProfileSettingsModal, {
          open: settingsOpen,
          onClose: handleCloseSettings,
          onRequestHelp: setHelpModal,
          autoInquiryEnabled,
          setAutoInquiryEnabled,
          autoPostNearbyEnabled,
          setAutoPostNearbyEnabled,
          onRequestDeleteAccount: handleRequestDeleteAccount,
          onRequestCancelSubscription: handleRequestCancelSubscription,
          onClearListingLocations: async () => {
            const result = await api.clearListingLocations();
            if (onListingsChanged) await onListingsChanged();
            return result;
          },
          isMobile,
          user,
          subscriptionStatus
        }),

        H(NotificationSettingsModal, {
          open: notificationSettingsModalOpen,
          onClose: handleCloseNotificationSettingsModal,
          notificationsDisabled,
          setNotificationsDisabled,
          quietHoursEnabled,
          setQuietHoursEnabled,
          quietHoursStart,
          setQuietHoursStart,
          quietHoursEnd,
          setQuietHoursEnd,
          onSave: saveNotificationSettings,
          saving: notificationSettingsSaving
        }),

        H(ProfilePictureUploadModal, {
          open: profilePictureModalOpen,
          onClose: handleCloseProfilePictureModal,
          onUploadComplete: handleProfilePictureUploadComplete,
          currentPictureUrl: profilePictureUrl,
          avatarBorderColor: profileAvatarBorderColor,
          avatarBorderStyle: profileAvatarBorderStyle,
          onChangeBorderColor: setProfileAvatarBorderColor,
          onChangeBorderStyle: setProfileAvatarBorderStyle,
          onSave: saveProfileCustomization,
          isPremium: isPremiumUser
        }),

        deleteAccountModalOpen && createPortal(
          H('div', {
            className: 'modal-overlay',
            onClick: (e) => {
              if (e.target.classList.contains('modal-overlay')) {
                handleCloseDeleteAccountModal();
              }
            }
          },
            H('div', { className: 'modal-content', style: { maxWidth: 400 } },
              H('div', { className: 'modal-header' },
                H('h2', { style: { margin: 0, fontSize: 20, fontWeight: 700 } }, 'Delete Account'),
                H('button', {
                  className: 'modal-close',
                  onClick: handleCloseDeleteAccountModal,
                  'aria-label': 'Close'
                }, '×')
              ),
              H('div', { className: 'modal-body' },
                H('p', { style: { marginBottom: 16 } },
                  'This action cannot be undone. All your listings, messages, and account data will be permanently deleted.'
                ),
                H('p', { style: { marginBottom: 16, fontWeight: 600 } },
                  'Type "confirm" to delete your account:'
                ),
                H('input', {
                  type: 'text',
                  value: deleteConfirmText,
                  onChange: (e) => setDeleteConfirmText(e.target.value),
                  placeholder: 'Type confirm',
                  style: {
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: 8,
                    fontSize: 14,
                    marginBottom: 12
                  }
                }),
                deleteAccountError && H('div', {
                  style: {
                    padding: 12,
                    background: '#fee2e2',
                    color: '#991b1b',
                    borderRadius: 8,
                    marginBottom: 12
                  }
                }, deleteAccountError),
                H('div', { style: { display: 'flex', gap: 8 } },
                  H('button', {
                    className: 'btn',
                    onClick: handleCloseDeleteAccountModal,
                    style: { flex: 1 }
                  }, 'Cancel'),
                  H('button', {
                    className: 'btn',
                    onClick: handleDeleteAccount,
                    disabled: deleteConfirmText !== 'confirm',
                    style: {
                      flex: 1,
                      background: '#dc2626',
                      color: 'white',
                      border: 'none',
                      opacity: deleteConfirmText !== 'confirm' ? 0.5 : 1
                    }
                  }, 'Delete Account')
                )
              )
            )
          ),
          document.body
        ),

        cancelSubscriptionModalOpen && createPortal(
          H('div', {
            className: 'modal-overlay',
            onClick: (e) => {
              if (e.target.classList.contains('modal-overlay') && !cancelSubscriptionBusy) {
                handleCloseCancelSubscriptionModal();
              }
            }
          },
            H('div', { className: 'modal-content', style: { maxWidth: 400 } },
              H('div', { className: 'modal-header' },
                H('h2', { style: { margin: 0, fontSize: 20, fontWeight: 700 } }, 'Cancel Subscription'),
                H('button', {
                  className: 'modal-close',
                  onClick: handleCloseCancelSubscriptionModal,
                  disabled: cancelSubscriptionBusy,
                  'aria-label': 'Close'
                }, '×')
              ),
              H('div', { className: 'modal-body' },
                H('p', { style: { marginBottom: 16 } },
                  'Are you sure you want to cancel your monthly subscription?'
                ),
                H('p', { style: { marginBottom: 16, color: '#6b7280' } },
                  'You will keep your supporter badge and premium features until the end of your current billing period.'
                ),
                H('div', { style: { display: 'flex', gap: 8 } },
                  H('button', {
                    className: 'btn',
                    onClick: handleCloseCancelSubscriptionModal,
                    disabled: cancelSubscriptionBusy,
                    style: { flex: 1 }
                  }, 'Keep Subscription'),
                  H('button', {
                    className: 'btn',
                    onClick: handleConfirmCancelSubscription,
                    disabled: cancelSubscriptionBusy,
                    style: {
                      flex: 1,
                      background: '#dc2626',
                      color: 'white',
                      border: 'none',
                      opacity: cancelSubscriptionBusy ? 0.5 : 1
                    }
                  }, cancelSubscriptionBusy ? 'Canceling...' : 'Cancel Subscription')
                )
              )
            )
          ),
          document.body
        ),

        H(ListingModal, {
          open: !!profileSelected,
          item: profileSelected,
          onClose: () => setProfileSelected(null),
          cardProps: {
            user,
            // Only allow edit for user's own listings (not saved listings from others)
            canEdit: profileSelected?.user_id === user?.id,
            onEdit: handleEdit,
            onDelete: handleDelete,
            onAdminDelete: handleAdminDelete,
            onViewSeller,
            onToggleSold: profileSelected?.user_id === user?.id ? onToggleSold : undefined,
            showDistance: false,
            onSupporterClick,
            // Show save button and message for saved listings (from other users)
            onMessage: profileSelected?.user_id !== user?.id ? onMessage : undefined,
            isSaved: !!parentSavedIds[profileSelected?.id],
            onToggleSave: profileSelected?.user_id !== user?.id ? handleToggleSave : undefined
          }
        })
      ];

      return H(React.Fragment, null, ...profileSections);
    });

    return {
      ProfilePanel
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.profile = {
    createProfileFeature
  };
})();
