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
        H('a', {
          href: 'https://trovelr.com',
          target: '_blank',
          rel: 'noopener noreferrer',
          style: {
            color: '#2563eb',
            fontWeight: 600,
            textDecoration: 'none'
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

    // Tier color schemes - shared across all badge rendering
    const TIER_COLORS = {
      Copper: { primary: '#b87333', secondary: '#da8a67', accent: '#e8a878', dark: '#8b4513' },
      Silver: { primary: '#c0c0c0', secondary: '#cd7f32', accent: '#d8d8d8', dark: '#808080' },
      Gold: { primary: '#ffd700', secondary: '#ffb800', accent: '#ffed4e', dark: '#b8860b' },
      Platinum: { primary: '#00bcd4', secondary: '#ffd700', accent: '#4dd0e1', dark: '#0097a7' },
      Diamond: { primary: '#9c27b0', secondary: '#7b1fa2', accent: '#ce93d8', dark: '#6a1b9a' },
      Sapphire: { primary: '#1565c0', secondary: '#9c27b0', accent: '#42a5f5', dark: '#0d47a1' },
      Amethyst: { primary: '#7b1fa2', secondary: '#4a148c', accent: '#ba68c8', dark: '#4a148c' },
      Unobtainium: { primary: '#00fff7', secondary: '#ff00ff', accent: '#ffff00', dark: '#0a0a1a' }
    };

    const VALID_TIERS = ['Copper', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Sapphire', 'Amethyst', 'Unobtainium'];

    // Render tiered badge SVG - single source of truth for all badge rendering
    function renderTieredBadgeSVG(tier, size, colors) {
      // Helper to create the core location pin
      const createPin = () => [
        H('path', {
          key: 'pin-body',
          d: 'M50 20 C35 20 25 32 25 45 C25 58 50 80 50 80 C50 80 75 58 75 45 C75 32 65 20 50 20 Z',
          fill: `url(#pinGrad-${tier})`,
          stroke: colors.dark,
          strokeWidth: '2'
        }),
        H('circle', { key: 'pin-circle', cx: '50', cy: '42', r: '14', fill: colors.accent, stroke: colors.dark, strokeWidth: '1.5' }),
        H('text', {
          key: 'pin-t',
          x: '50',
          y: '47',
          textAnchor: 'middle',
          fontSize: '12',
          fontWeight: 'bold',
          fill: colors.dark,
          opacity: '0.25'
        }, 'T')
      ];

      // Copper: Shield frame with scrollwork (same design as Silver/Gold but copper colors with shine)
      if (tier === 'Copper') {
        return H('svg', { viewBox: '0 0 100 100', width: size, height: size },
          H('defs', null,
            H('linearGradient', { id: 'pinGrad-Copper', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
              H('stop', { offset: '0%', stopColor: colors.accent }),
              H('stop', { offset: '50%', stopColor: colors.primary }),
              H('stop', { offset: '100%', stopColor: colors.secondary })
            ),
            H('linearGradient', { id: 'copperShield', x1: '0%', y1: '0%', x2: '0%', y2: '100%' },
              H('stop', { offset: '0%', stopColor: '#e8a878' }),
              H('stop', { offset: '30%', stopColor: '#da8a67' }),
              H('stop', { offset: '70%', stopColor: '#b87333' }),
              H('stop', { offset: '100%', stopColor: '#8b4513' })
            ),
            H('linearGradient', { id: 'copperShine', x1: '0%', y1: '0%', x2: '100%', y2: '20%' },
              H('stop', { offset: '0%', stopColor: '#ffffff', stopOpacity: '0' }),
              H('stop', { offset: '40%', stopColor: '#ffffff', stopOpacity: '0' }),
              H('stop', { offset: '50%', stopColor: '#ffffff', stopOpacity: '0.95' }),
              H('stop', { offset: '60%', stopColor: '#ffffff', stopOpacity: '0' }),
              H('stop', { offset: '100%', stopColor: '#ffffff', stopOpacity: '0' })
            ),
            H('clipPath', { id: 'copperShieldClip' },
              H('path', { d: 'M50 4 L85 15 L90 45 L75 75 L50 95 L25 75 L10 45 L15 15 Z' })
            )
          ),
          H('path', { d: 'M50 4 L85 15 L90 45 L75 75 L50 95 L25 75 L10 45 L15 15 Z', fill: 'none', stroke: 'url(#copperShield)', strokeWidth: '3' }),
          H('path', { d: 'M50 10 L78 19 L82 44 L70 70 L50 86 L30 70 L18 44 L22 19 Z', fill: 'none', stroke: colors.secondary, strokeWidth: '1', opacity: '0.5' }),
          H('g', { clipPath: 'url(#copperShieldClip)' },
            H('rect', { x: '-30', y: '-10', width: '35', height: '120', fill: 'url(#copperShine)', transform: 'rotate(20)' },
              H('animate', { attributeName: 'x', values: '-30;110;110', dur: '3s', repeatCount: 'indefinite', keyTimes: '0;0.4;1' })
            )
          ),
          H('path', { d: 'M8 35 Q4 45 8 55 Q12 50 10 45 Q14 50 12 55 Q8 50 8 35', fill: colors.accent, stroke: colors.secondary, strokeWidth: '0.5' }),
          H('path', { d: 'M12 30 Q6 40 10 50', fill: 'none', stroke: colors.primary, strokeWidth: '1' }),
          H('path', { d: 'M92 35 Q96 45 92 55 Q88 50 90 45 Q86 50 88 55 Q92 50 92 35', fill: colors.accent, stroke: colors.secondary, strokeWidth: '0.5' }),
          H('path', { d: 'M88 30 Q94 40 90 50', fill: 'none', stroke: colors.primary, strokeWidth: '1' }),
          H('path', { d: 'M40 6 Q50 0 60 6', fill: 'none', stroke: colors.primary, strokeWidth: '2', strokeLinecap: 'round' }),
          H('circle', { cx: '40', cy: '6', r: '2', fill: colors.accent }),
          H('circle', { cx: '60', cy: '6', r: '2', fill: colors.accent }),
          H('circle', { cx: '50', cy: '3', r: '2.5', fill: colors.primary, stroke: colors.dark, strokeWidth: '0.5' }),
          H('path', { d: 'M50 90 L54 96 L50 99 L46 96 Z', fill: colors.accent, stroke: colors.secondary, strokeWidth: '0.5' }),
          H('circle', { cx: '15', cy: '15', r: '1.5', fill: colors.accent }),
          H('circle', { cx: '85', cy: '15', r: '1.5', fill: colors.accent }),
          ...createPin()
        );
      }

      // Silver: Shield frame with scrollwork
      if (tier === 'Silver') {
        return H('svg', { viewBox: '0 0 100 100', width: size, height: size },
          H('defs', null,
            H('linearGradient', { id: 'pinGrad-Silver', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
              H('stop', { offset: '0%', stopColor: colors.accent }),
              H('stop', { offset: '50%', stopColor: colors.primary }),
              H('stop', { offset: '100%', stopColor: colors.secondary })
            ),
            H('linearGradient', { id: 'silverShield', x1: '0%', y1: '0%', x2: '0%', y2: '100%' },
              H('stop', { offset: '0%', stopColor: '#ffffff' }),
              H('stop', { offset: '30%', stopColor: '#e8e8e8' }),
              H('stop', { offset: '70%', stopColor: '#c0c0c0' }),
              H('stop', { offset: '100%', stopColor: '#a0a0a0' })
            ),
            H('linearGradient', { id: 'silverShine', x1: '0%', y1: '0%', x2: '100%', y2: '20%' },
              H('stop', { offset: '0%', stopColor: '#ffffff', stopOpacity: '0' }),
              H('stop', { offset: '40%', stopColor: '#ffffff', stopOpacity: '0' }),
              H('stop', { offset: '50%', stopColor: '#ffffff', stopOpacity: '0.95' }),
              H('stop', { offset: '60%', stopColor: '#ffffff', stopOpacity: '0' }),
              H('stop', { offset: '100%', stopColor: '#ffffff', stopOpacity: '0' })
            ),
            H('clipPath', { id: 'silverShieldClip' },
              H('path', { d: 'M50 4 L85 15 L90 45 L75 75 L50 95 L25 75 L10 45 L15 15 Z' })
            )
          ),
          H('path', { d: 'M50 4 L85 15 L90 45 L75 75 L50 95 L25 75 L10 45 L15 15 Z', fill: 'none', stroke: 'url(#silverShield)', strokeWidth: '3' }),
          H('path', { d: 'M50 10 L78 19 L82 44 L70 70 L50 86 L30 70 L18 44 L22 19 Z', fill: 'none', stroke: colors.secondary, strokeWidth: '1', opacity: '0.5' }),
          H('g', { clipPath: 'url(#silverShieldClip)' },
            H('rect', { x: '-30', y: '-10', width: '35', height: '120', fill: 'url(#silverShine)', transform: 'rotate(20)' },
              H('animate', { attributeName: 'x', values: '-30;110;110', dur: '3s', repeatCount: 'indefinite', keyTimes: '0;0.4;1' })
            )
          ),
          H('path', { d: 'M8 35 Q4 45 8 55 Q12 50 10 45 Q14 50 12 55 Q8 50 8 35', fill: colors.accent, stroke: colors.secondary, strokeWidth: '0.5' }),
          H('path', { d: 'M12 30 Q6 40 10 50', fill: 'none', stroke: colors.primary, strokeWidth: '1' }),
          H('path', { d: 'M92 35 Q96 45 92 55 Q88 50 90 45 Q86 50 88 55 Q92 50 92 35', fill: colors.accent, stroke: colors.secondary, strokeWidth: '0.5' }),
          H('path', { d: 'M88 30 Q94 40 90 50', fill: 'none', stroke: colors.primary, strokeWidth: '1' }),
          H('path', { d: 'M40 6 Q50 0 60 6', fill: 'none', stroke: colors.primary, strokeWidth: '2', strokeLinecap: 'round' }),
          H('circle', { cx: '40', cy: '6', r: '2', fill: colors.accent }),
          H('circle', { cx: '60', cy: '6', r: '2', fill: colors.accent }),
          H('circle', { cx: '50', cy: '3', r: '2.5', fill: colors.primary, stroke: colors.dark, strokeWidth: '0.5' }),
          H('path', { d: 'M50 90 L54 96 L50 99 L46 96 Z', fill: colors.accent, stroke: colors.secondary, strokeWidth: '0.5' }),
          H('circle', { cx: '15', cy: '15', r: '1.5', fill: colors.accent }),
          H('circle', { cx: '85', cy: '15', r: '1.5', fill: colors.accent }),
          ...createPin()
        );
      }

      // Gold: Shield frame with scrollwork (same as Silver but gold colors with shine)
      if (tier === 'Gold') {
        return H('svg', { viewBox: '0 0 100 100', width: size, height: size },
          H('defs', null,
            H('linearGradient', { id: 'pinGrad-Gold', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
              H('stop', { offset: '0%', stopColor: colors.accent }),
              H('stop', { offset: '50%', stopColor: colors.primary }),
              H('stop', { offset: '100%', stopColor: colors.secondary })
            ),
            H('linearGradient', { id: 'goldShield', x1: '0%', y1: '0%', x2: '0%', y2: '100%' },
              H('stop', { offset: '0%', stopColor: '#fff9e6' }),
              H('stop', { offset: '30%', stopColor: '#ffed4e' }),
              H('stop', { offset: '70%', stopColor: '#ffd700' }),
              H('stop', { offset: '100%', stopColor: '#b8860b' })
            ),
            H('linearGradient', { id: 'goldShine', x1: '0%', y1: '0%', x2: '100%', y2: '20%' },
              H('stop', { offset: '0%', stopColor: '#ffffff', stopOpacity: '0' }),
              H('stop', { offset: '40%', stopColor: '#ffffff', stopOpacity: '0' }),
              H('stop', { offset: '50%', stopColor: '#ffffff', stopOpacity: '0.95' }),
              H('stop', { offset: '60%', stopColor: '#ffffff', stopOpacity: '0' }),
              H('stop', { offset: '100%', stopColor: '#ffffff', stopOpacity: '0' })
            ),
            H('clipPath', { id: 'goldShieldClip' },
              H('path', { d: 'M50 4 L85 15 L90 45 L75 75 L50 95 L25 75 L10 45 L15 15 Z' })
            )
          ),
          H('path', { d: 'M50 4 L85 15 L90 45 L75 75 L50 95 L25 75 L10 45 L15 15 Z', fill: 'none', stroke: 'url(#goldShield)', strokeWidth: '3' }),
          H('path', { d: 'M50 10 L78 19 L82 44 L70 70 L50 86 L30 70 L18 44 L22 19 Z', fill: 'none', stroke: colors.secondary, strokeWidth: '1', opacity: '0.5' }),
          H('g', { clipPath: 'url(#goldShieldClip)' },
            H('rect', { x: '-30', y: '-10', width: '35', height: '120', fill: 'url(#goldShine)', transform: 'rotate(20)' },
              H('animate', { attributeName: 'x', values: '-30;110;110', dur: '3s', repeatCount: 'indefinite', keyTimes: '0;0.4;1' })
            )
          ),
          H('path', { d: 'M8 35 Q4 45 8 55 Q12 50 10 45 Q14 50 12 55 Q8 50 8 35', fill: colors.accent, stroke: colors.secondary, strokeWidth: '0.5' }),
          H('path', { d: 'M12 30 Q6 40 10 50', fill: 'none', stroke: colors.primary, strokeWidth: '1' }),
          H('path', { d: 'M92 35 Q96 45 92 55 Q88 50 90 45 Q86 50 88 55 Q92 50 92 35', fill: colors.accent, stroke: colors.secondary, strokeWidth: '0.5' }),
          H('path', { d: 'M88 30 Q94 40 90 50', fill: 'none', stroke: colors.primary, strokeWidth: '1' }),
          H('path', { d: 'M40 6 Q50 0 60 6', fill: 'none', stroke: colors.primary, strokeWidth: '2', strokeLinecap: 'round' }),
          H('circle', { cx: '40', cy: '6', r: '2', fill: colors.accent }),
          H('circle', { cx: '60', cy: '6', r: '2', fill: colors.accent }),
          H('circle', { cx: '50', cy: '3', r: '2.5', fill: colors.primary, stroke: colors.dark, strokeWidth: '0.5' }),
          H('path', { d: 'M50 90 L54 96 L50 99 L46 96 Z', fill: colors.accent, stroke: colors.secondary, strokeWidth: '0.5' }),
          H('circle', { cx: '15', cy: '15', r: '1.5', fill: colors.accent }),
          H('circle', { cx: '85', cy: '15', r: '1.5', fill: colors.accent }),
          ...createPin()
        );
      }

      // Platinum: Crown with orbital rings
      if (tier === 'Platinum') {
        return H('svg', { viewBox: '0 0 100 100', width: size, height: size },
          H('defs', null,
            H('linearGradient', { id: 'pinGrad-Platinum', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
              H('stop', { offset: '0%', stopColor: colors.accent }),
              H('stop', { offset: '50%', stopColor: colors.primary }),
              H('stop', { offset: '100%', stopColor: colors.secondary })
            )
          ),
          H('ellipse', { cx: '50', cy: '50', rx: '46', ry: '20', fill: 'none', stroke: colors.primary, strokeWidth: '1.5', opacity: '0.4', transform: 'rotate(-20 50 50)' }),
          H('ellipse', { cx: '50', cy: '50', rx: '46', ry: '20', fill: 'none', stroke: colors.accent, strokeWidth: '1', opacity: '0.3', transform: 'rotate(20 50 50)' }),
          H('path', { d: 'M35 12 L38 4 L44 10 L50 2 L56 10 L62 4 L65 12 L62 14 L38 14 Z', fill: colors.primary, stroke: colors.dark, strokeWidth: '0.8' }),
          H('circle', { cx: '50', cy: '5', r: '2', fill: colors.accent }),
          H('circle', { cx: '38', cy: '7', r: '1.5', fill: colors.accent }),
          H('circle', { cx: '62', cy: '7', r: '1.5', fill: colors.accent }),
          H('g', { className: 'badge-rotate-slow', style: { transformOrigin: '50px 50px' } },
            H('circle', { cx: '50', cy: '4', r: '2', fill: colors.primary }),
            H('circle', { cx: '96', cy: '50', r: '2', fill: colors.accent }),
            H('circle', { cx: '50', cy: '96', r: '2', fill: colors.primary }),
            H('circle', { cx: '4', cy: '50', r: '2', fill: colors.accent })
          ),
          H('circle', { cx: '50', cy: '52', r: '35', fill: 'none', stroke: colors.secondary, strokeWidth: '2', opacity: '0.5' }),
          ...createPin()
        );
      }

      // Diamond: Brilliant cut gem
      if (tier === 'Diamond') {
        return H('svg', { viewBox: '0 0 100 100', width: size, height: size },
          H('defs', null,
            H('linearGradient', { id: 'pinGrad-Diamond', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
              H('stop', { offset: '0%', stopColor: colors.accent }),
              H('stop', { offset: '50%', stopColor: colors.primary }),
              H('stop', { offset: '100%', stopColor: colors.secondary })
            ),
            H('linearGradient', { id: 'diamondGem', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
              H('stop', { offset: '0%', stopColor: '#ffffff' }),
              H('stop', { offset: '40%', stopColor: '#f3e5f5' }),
              H('stop', { offset: '100%', stopColor: '#ce93d8' })
            ),
            H('linearGradient', { id: 'diamondFacetL', x1: '100%', y1: '0%', x2: '0%', y2: '100%' },
              H('stop', { offset: '0%', stopColor: '#ea80fc' }),
              H('stop', { offset: '100%', stopColor: '#e040fb' })
            ),
            H('linearGradient', { id: 'diamondFacetR', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
              H('stop', { offset: '0%', stopColor: '#f3e5f5' }),
              H('stop', { offset: '100%', stopColor: '#aa00ff' })
            ),
            H('radialGradient', { id: 'diamondGlow', cx: '50%', cy: '30%', r: '60%' },
              H('stop', { offset: '0%', stopColor: '#ffffff', stopOpacity: '0.4' }),
              H('stop', { offset: '100%', stopColor: colors.primary, stopOpacity: '0' })
            )
          ),
          H('circle', { cx: '50', cy: '50', r: '46', fill: 'url(#diamondGlow)' }),
          H('circle', { cx: '50', cy: '50', r: '46', fill: 'none', stroke: colors.primary, strokeWidth: '2.5' }),
          H('polygon', { points: '50,8 30,28 50,35 70,28', fill: 'url(#diamondGem)', stroke: colors.dark, strokeWidth: '0.8' }),
          H('polygon', { points: '30,28 20,45 50,35', fill: 'url(#diamondFacetL)', stroke: colors.dark, strokeWidth: '0.5' }),
          H('polygon', { points: '70,28 80,45 50,35', fill: 'url(#diamondFacetR)', stroke: colors.dark, strokeWidth: '0.5' }),
          H('polygon', { points: '20,45 50,85 50,35', fill: 'url(#diamondFacetL)', stroke: colors.dark, strokeWidth: '0.5' }),
          H('polygon', { points: '80,45 50,85 50,35', fill: 'url(#diamondFacetR)', stroke: colors.dark, strokeWidth: '0.5' }),
          H('path', { d: 'M20 45 L80 45', fill: 'none', stroke: colors.accent, strokeWidth: '1' }),
          H('circle', { cx: '50', cy: '8', r: '2.5', fill: '#ffffff' }),
          H('circle', { cx: '35', cy: '22', r: '1.5', fill: '#ffffff', opacity: '0.8' }),
          H('circle', { cx: '65', cy: '22', r: '1.5', fill: '#ffffff', opacity: '0.8' }),
          H('circle', { cx: '50', cy: '28', r: '2', fill: '#ffffff', opacity: '0.6' }),
          H('path', { d: 'M50 4 L50 0', fill: 'none', stroke: '#ffffff', strokeWidth: '1.5', strokeLinecap: 'round' }),
          H('path', { d: 'M42 6 L38 2', fill: 'none', stroke: colors.accent, strokeWidth: '1', strokeLinecap: 'round' }),
          H('path', { d: 'M58 6 L62 2', fill: 'none', stroke: colors.accent, strokeWidth: '1', strokeLinecap: 'round' }),
          H('circle', { cx: '15', cy: '50', r: '1.5', fill: colors.accent }),
          H('circle', { cx: '85', cy: '50', r: '1.5', fill: colors.accent }),
          H('circle', { cx: '50', cy: '95', r: '1.5', fill: colors.accent }),
          ...createPin()
        );
      }

      // Sapphire: Night sky constellation
      if (tier === 'Sapphire') {
        return H('svg', { viewBox: '0 0 100 100', width: size, height: size },
          H('defs', null,
            H('linearGradient', { id: 'pinGrad-Sapphire', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
              H('stop', { offset: '0%', stopColor: colors.accent }),
              H('stop', { offset: '50%', stopColor: colors.primary }),
              H('stop', { offset: '100%', stopColor: colors.secondary })
            ),
            H('radialGradient', { id: 'sapphireNight', cx: '50%', cy: '50%', r: '50%' },
              H('stop', { offset: '0%', stopColor: '#1565c0', stopOpacity: '0.3' }),
              H('stop', { offset: '100%', stopColor: '#0d47a1', stopOpacity: '0.1' })
            )
          ),
          H('circle', { cx: '50', cy: '50', r: '46', fill: 'url(#sapphireNight)' }),
          H('circle', { cx: '50', cy: '50', r: '46', fill: 'none', stroke: colors.primary, strokeWidth: '2.5' }),
          H('circle', { cx: '50', cy: '50', r: '43', fill: 'none', stroke: colors.accent, strokeWidth: '1', opacity: '0.3' }),
          H('path', { d: 'M20 25 L35 40 L50 20 L70 35 L85 22', fill: 'none', stroke: colors.accent, strokeWidth: '1.5', strokeLinecap: 'round', opacity: '0.6' }),
          H('path', { d: 'M35 40 L25 60 L45 75', fill: 'none', stroke: colors.accent, strokeWidth: '1.5', strokeLinecap: 'round', opacity: '0.6' }),
          H('path', { d: 'M70 35 L80 55 L65 70 L45 75', fill: 'none', stroke: colors.accent, strokeWidth: '1.5', strokeLinecap: 'round', opacity: '0.6' }),
          H('path', { d: 'M50 20 L55 45 L70 35', fill: 'none', stroke: colors.accent, strokeWidth: '1', strokeLinecap: 'round', opacity: '0.4' }),
          H('circle', { cx: '20', cy: '25', r: '3', fill: colors.accent }),
          H('circle', { cx: '35', cy: '40', r: '3.5', fill: '#ffffff' }),
          H('circle', { cx: '50', cy: '20', r: '4', fill: colors.accent }),
          H('circle', { cx: '70', cy: '35', r: '3', fill: '#ffffff' }),
          H('circle', { cx: '85', cy: '22', r: '2.5', fill: colors.accent }),
          H('circle', { cx: '25', cy: '60', r: '2.5', fill: colors.primary }),
          H('circle', { cx: '45', cy: '75', r: '3.5', fill: colors.accent }),
          H('circle', { cx: '80', cy: '55', r: '2.5', fill: '#ffffff' }),
          H('circle', { cx: '65', cy: '70', r: '3', fill: colors.primary }),
          H('circle', { cx: '55', cy: '45', r: '2', fill: colors.accent }),
          H('circle', { cx: '12', cy: '45', r: '1', fill: colors.accent, opacity: '0.5' }),
          H('circle', { cx: '88', cy: '42', r: '1', fill: colors.accent, opacity: '0.5' }),
          H('circle', { cx: '15', cy: '80', r: '1', fill: '#ffffff', opacity: '0.4' }),
          H('circle', { cx: '90', cy: '75', r: '1', fill: '#ffffff', opacity: '0.4' }),
          H('circle', { cx: '40', cy: '12', r: '1', fill: colors.accent, opacity: '0.5' }),
          H('circle', { cx: '75', cy: '85', r: '1', fill: colors.primary, opacity: '0.4' }),
          H('circle', { cx: '30', cy: '88', r: '1', fill: colors.accent, opacity: '0.5' }),
          H('circle', { cx: '60', cy: '8', r: '1', fill: '#ffffff', opacity: '0.4' }),
          ...createPin()
        );
      }

      // Amethyst: Gothic cathedral arch
      if (tier === 'Amethyst') {
        return H('svg', { viewBox: '0 0 100 100', width: size, height: size },
          H('defs', null,
            H('linearGradient', { id: 'pinGrad-Amethyst', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
              H('stop', { offset: '0%', stopColor: colors.accent }),
              H('stop', { offset: '50%', stopColor: colors.primary }),
              H('stop', { offset: '100%', stopColor: colors.secondary })
            ),
            H('linearGradient', { id: 'amethystArch', x1: '0%', y1: '0%', x2: '0%', y2: '100%' },
              H('stop', { offset: '0%', stopColor: '#e1bee7' }),
              H('stop', { offset: '50%', stopColor: '#9c27b0' }),
              H('stop', { offset: '100%', stopColor: '#4a148c' })
            ),
            H('radialGradient', { id: 'amethystGlow', cx: '50%', cy: '40%', r: '50%' },
              H('stop', { offset: '0%', stopColor: colors.accent, stopOpacity: '0.35' }),
              H('stop', { offset: '100%', stopColor: colors.primary, stopOpacity: '0' })
            )
          ),
          H('circle', { cx: '50', cy: '50', r: '42', fill: 'url(#amethystGlow)' }),
          H('path', { d: 'M15 85 L15 40 Q15 10 50 4 Q85 10 85 40 L85 85', fill: 'none', stroke: 'url(#amethystArch)', strokeWidth: '3', strokeLinecap: 'round' }),
          H('path', { d: 'M20 82 L20 42 Q20 16 50 10 Q80 16 80 42 L80 82', fill: 'none', stroke: colors.accent, strokeWidth: '1', opacity: '0.4' }),
          H('path', { d: 'M50 2 L56 10 L50 18 L44 10 Z', fill: colors.primary, stroke: colors.dark, strokeWidth: '0.5' }),
          H('path', { d: 'M50 2 L50 18 L44 10 Z', fill: colors.accent, opacity: '0.4' }),
          H('path', { d: 'M25 20 L25 30', fill: 'none', stroke: colors.accent, strokeWidth: '1' }),
          H('path', { d: 'M25 30 L28 38 L25 46 L22 38 Z', fill: colors.primary, stroke: colors.dark, strokeWidth: '0.3' }),
          H('circle', { cx: '25', cy: '20', r: '2', fill: colors.accent }),
          H('path', { d: 'M75 20 L75 30', fill: 'none', stroke: colors.accent, strokeWidth: '1' }),
          H('path', { d: 'M75 30 L78 38 L75 46 L72 38 Z', fill: colors.primary, stroke: colors.dark, strokeWidth: '0.3' }),
          H('circle', { cx: '75', cy: '20', r: '2', fill: colors.accent }),
          H('circle', { cx: '10', cy: '55', r: '3', fill: 'none', stroke: colors.primary, strokeWidth: '1.5' }),
          H('circle', { cx: '10', cy: '55', r: '1', fill: colors.accent }),
          H('circle', { cx: '90', cy: '55', r: '3', fill: 'none', stroke: colors.primary, strokeWidth: '1.5' }),
          H('circle', { cx: '90', cy: '55', r: '1', fill: colors.accent }),
          H('path', { d: 'M30 88 Q40 82 50 88 Q60 94 70 88', fill: 'none', stroke: colors.primary, strokeWidth: '2', strokeLinecap: 'round' }),
          H('path', { d: 'M25 92 L30 88 M75 92 L70 88', fill: 'none', stroke: colors.accent, strokeWidth: '1.5', strokeLinecap: 'round' }),
          H('circle', { cx: '50', cy: '95', r: '2.5', fill: colors.primary, stroke: colors.dark, strokeWidth: '0.5' }),
          H('circle', { cx: '35', cy: '12', r: '1.5', fill: colors.accent, className: 'badge-sparkle-particle' }),
          H('circle', { cx: '65', cy: '12', r: '1.5', fill: colors.accent, className: 'badge-sparkle-particle' }),
          ...createPin()
        );
      }

      // Unobtainium: Cosmic starburst
      return H('svg', { viewBox: '0 0 100 100', width: size, height: size },
        H('defs', null,
          H('linearGradient', { id: 'pinGrad-Unobtainium', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
            H('stop', { offset: '0%', stopColor: '#eceff1' }),
            H('stop', { offset: '30%', stopColor: '#b0bec5' }),
            H('stop', { offset: '60%', stopColor: '#cfd8dc' }),
            H('stop', { offset: '100%', stopColor: '#90a4ae' })
          ),
          H('linearGradient', { id: 'unobtainiumNebula1', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
            H('stop', { offset: '0%', stopColor: '#ff6b9d' }),
            H('stop', { offset: '100%', stopColor: '#c44569' })
          ),
          H('linearGradient', { id: 'unobtainiumNebula2', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
            H('stop', { offset: '0%', stopColor: '#4fc3f7' }),
            H('stop', { offset: '100%', stopColor: '#0288d1' })
          ),
          H('linearGradient', { id: 'unobtainiumNebula3', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
            H('stop', { offset: '0%', stopColor: '#aed581' }),
            H('stop', { offset: '100%', stopColor: '#7cb342' })
          ),
          H('linearGradient', { id: 'unobtainiumGold', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
            H('stop', { offset: '0%', stopColor: '#ffd54f' }),
            H('stop', { offset: '50%', stopColor: '#ffb300' }),
            H('stop', { offset: '100%', stopColor: '#ff8f00' })
          ),
          H('linearGradient', { id: 'unobtainiumDragon', x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
            H('stop', { offset: '0%', stopColor: '#e0e0e0' }),
            H('stop', { offset: '50%', stopColor: '#9e9e9e' }),
            H('stop', { offset: '100%', stopColor: '#616161' })
          ),
          H('radialGradient', { id: 'unobtainiumCore', cx: '50%', cy: '50%', r: '50%' },
            H('stop', { offset: '0%', stopColor: '#ffffff', stopOpacity: '0.7' }),
            H('stop', { offset: '40%', stopColor: '#e1bee7', stopOpacity: '0.3' }),
            H('stop', { offset: '100%', stopColor: colors.primary, stopOpacity: '0' })
          )
        ),
        H('circle', { cx: '50', cy: '50', r: '48', fill: 'url(#unobtainiumCore)' }),
        H('path', { d: 'M50 2 L52 20 L50 18 L48 20 Z', fill: 'url(#unobtainiumGold)', opacity: '0.8' }),
        H('path', { d: 'M50 98 L48 80 L50 82 L52 80 Z', fill: 'url(#unobtainiumGold)', opacity: '0.8' }),
        H('path', { d: 'M2 50 L20 48 L18 50 L20 52 Z', fill: 'url(#unobtainiumGold)', opacity: '0.8' }),
        H('path', { d: 'M98 50 L80 52 L82 50 L80 48 Z', fill: 'url(#unobtainiumGold)', opacity: '0.8' }),
        H('path', { d: 'M15 15 L28 25 L26 26 L25 28 Z', fill: colors.accent, opacity: '0.6' }),
        H('path', { d: 'M85 15 L72 25 L74 26 L75 28 Z', fill: colors.accent, opacity: '0.6' }),
        H('path', { d: 'M15 85 L28 75 L26 74 L25 72 Z', fill: colors.accent, opacity: '0.6' }),
        H('path', { d: 'M85 85 L72 75 L74 74 L75 72 Z', fill: colors.accent, opacity: '0.6' }),
        H('path', { d: 'M8 35 Q2 42 6 50 Q2 58 8 65 Q14 58 10 50 Q14 42 8 35', fill: 'url(#unobtainiumNebula1)', stroke: '#c44569', strokeWidth: '0.5' }),
        H('path', { d: 'M12 30 Q4 40 8 50 Q4 60 12 70', fill: 'none', stroke: '#ff6b9d', strokeWidth: '1.5', strokeLinecap: 'round' }),
        H('circle', { cx: '6', cy: '32', r: '2', fill: '#ff6b9d' }),
        H('path', { d: 'M92 35 Q98 42 94 50 Q98 58 92 65 Q86 58 90 50 Q86 42 92 35', fill: 'url(#unobtainiumNebula2)', stroke: '#0288d1', strokeWidth: '0.5' }),
        H('path', { d: 'M88 30 Q96 40 92 50 Q96 60 88 70', fill: 'none', stroke: '#4fc3f7', strokeWidth: '1.5', strokeLinecap: 'round' }),
        H('circle', { cx: '94', cy: '32', r: '2', fill: '#4fc3f7' }),
        H('circle', { cx: '50', cy: '50', r: '36', fill: 'none', stroke: colors.primary, strokeWidth: '2.5' }),
        H('circle', { cx: '50', cy: '50', r: '33', fill: 'none', stroke: 'url(#unobtainiumGold)', strokeWidth: '1', strokeDasharray: '4 2' }),
        H('path', { d: 'M32 12 L35 4 L42 8 L50 0 L58 8 L65 4 L68 12 L65 15 L35 15 Z', fill: 'url(#unobtainiumDragon)', stroke: colors.dark, strokeWidth: '0.5' }),
        H('circle', { cx: '50', cy: '3', r: '3.5', fill: 'url(#unobtainiumGold)', stroke: '#ff8f00', strokeWidth: '0.5' }),
        H('circle', { cx: '42', cy: '7', r: '2', fill: 'url(#unobtainiumNebula1)' }),
        H('circle', { cx: '58', cy: '7', r: '2', fill: 'url(#unobtainiumNebula2)' }),
        H('circle', { cx: '35', cy: '9', r: '1.5', fill: 'url(#unobtainiumNebula3)' }),
        H('circle', { cx: '65', cy: '9', r: '1.5', fill: 'url(#unobtainiumGold)' }),
        H('path', { d: 'M35 88 Q42 84 50 88 Q58 92 65 88', fill: 'none', stroke: 'url(#unobtainiumNebula3)', strokeWidth: '2.5', strokeLinecap: 'round' }),
        H('path', { d: 'M40 92 Q50 96 60 92', fill: 'none', stroke: 'url(#unobtainiumGold)', strokeWidth: '1.5', strokeLinecap: 'round' }),
        H('circle', { cx: '50', cy: '96', r: '3', fill: 'url(#unobtainiumGold)', stroke: '#ff8f00', strokeWidth: '0.5' }),
        H('path', { d: 'M22 22 L26 18 L30 22 L26 26 Z', fill: 'url(#unobtainiumNebula1)', className: 'badge-sparkle-particle' }),
        H('path', { d: 'M78 22 L74 18 L70 22 L74 26 Z', fill: 'url(#unobtainiumNebula2)', className: 'badge-sparkle-particle' }),
        H('path', { d: 'M22 78 L26 74 L30 78 L26 82 Z', fill: 'url(#unobtainiumNebula3)', className: 'badge-sparkle-particle' }),
        H('path', { d: 'M78 78 L74 74 L70 78 L74 82 Z', fill: 'url(#unobtainiumGold)', className: 'badge-sparkle-particle' }),
        H('g', { className: 'badge-rotate-slow', style: { transformOrigin: '50px 50px' } },
          H('circle', { cx: '50', cy: '6', r: '2', fill: '#ffd54f' }),
          H('circle', { cx: '94', cy: '50', r: '2', fill: '#4fc3f7' }),
          H('circle', { cx: '50', cy: '94', r: '2', fill: '#aed581' }),
          H('circle', { cx: '6', cy: '50', r: '2', fill: '#ff6b9d' })
        ),
        ...createPin()
      );
    }

    function SupporterBadge({
      size = 'md',
      since,
      onClick,
      as = 'auto',
      title,
      className,
      style,
      badge
    }) {
      const Component = (onClick || as === 'button') ? 'button' : 'span';

      // Calculate tier from duration
      const sinceDate = since ? new Date(since) : null;
      const now = Date.now();
      const timeDiff = sinceDate ? now - sinceDate.getTime() : 0;
      const monthsSince = Math.floor(timeDiff / (1000 * 60 * 60 * 24 * 30));

      let calculatedTier = 'Copper';
      if (monthsSince >= 72) calculatedTier = 'Unobtainium';
      else if (monthsSince >= 60) calculatedTier = 'Amethyst';
      else if (monthsSince >= 36) calculatedTier = 'Sapphire';
      else if (monthsSince >= 24) calculatedTier = 'Diamond';
      else if (monthsSince >= 12) calculatedTier = 'Platinum';
      else if (monthsSince >= 6) calculatedTier = 'Gold';
      else if (monthsSince >= 3) calculatedTier = 'Silver';

      const colors = TIER_COLORS[calculatedTier];

      const badgeLabel = `${calculatedTier} Supporter`;
      const computedTitle = title || (since ? `${badgeLabel} since ${formatSinceLabel(since) || since}` : badgeLabel);

      const sizes = {
        sm: 16,
        md: 18,
        lg: 22
      };
      const iconSize = typeof size === 'number' ? size : (sizes[size] || sizes.md);

      const sharedProps = {
        className: `subscriber-badge subscriber-badge--${calculatedTier.toLowerCase()} ${className || ''}`.trim(),
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

      return H(Component, sharedProps, renderTieredBadgeSVG(calculatedTier, iconSize, colors));
    }

    function CyclingSupporterBadge({ size = 'md', interval = 3000, style }) {
      const [tierIndex, setTierIndex] = useState(0);

      useEffect(() => {
        const timer = setInterval(() => {
          setTierIndex((prev) => (prev + 1) % VALID_TIERS.length);
        }, interval);
        return () => clearInterval(timer);
      }, [interval]);

      const currentTier = VALID_TIERS[tierIndex];
      const colors = TIER_COLORS[currentTier];

      const sizes = {
        sm: 16,
        md: 18,
        lg: 22
      };
      const iconSize = typeof size === 'number' ? size : (sizes[size] || sizes.md);

      return H('span', {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'transform 0.3s ease',
          ...style
        },
        title: `${currentTier} Supporter Badge`
      }, renderTieredBadgeSVG(currentTier, iconSize, colors));
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

    function SupporterInfoModal({ open, onClose, username, since, tier, onJoin, isSelf = false, paymentsDisabled = false }) {
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
              H(SupporterBadge, { size: 'lg', since, tier })
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
                H('p', { className: 'supporter-modal__body', style: { marginBottom: 0, textAlign: 'center' } },
                  'Subscribe to unlock exclusive premium features:'
                ),
                // Benefits list
                H('div', { style: { display: 'grid', gap: 14, padding: '0 4px' } },
                  H('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 6 } },
                    H(CyclingSupporterBadge, { size: 28, interval: 3000 }),
                    H('div', null,
                      H('div', { style: { fontWeight: 700, fontSize: 14, marginBottom: 2 } }, 'Premium Subscriber Badge'),
                      H('div', { style: { fontSize: 13, color: '#666' } }, 'A shimmering badge displayed on your profile card and all your listings')
                    )
                  ),
                  H('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 6 } },
                    H('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none' },
                      H('path', { d: 'M12 3l1.5 3.5L17 8l-2.5 2.5L15 15l-3-2-3 2 .5-4.5L7 8l3.5-1.5L12 3z', fill: '#fbbf24', stroke: '#f59e0b', strokeWidth: 1 }),
                      H('path', { d: 'M5 5l1 2 2 .5-1.5 1.5.3 2.2L5 10l-1.8 1.2.3-2.2L2 7.5 4 7l1-2z', fill: '#fcd34d', stroke: '#f59e0b', strokeWidth: 0.5 }),
                      H('path', { d: 'M19 5l1 2 2 .5-1.5 1.5.3 2.2-1.8-1.2-1.8 1.2.3-2.2L16 7.5l2-.5 1-2z', fill: '#fcd34d', stroke: '#f59e0b', strokeWidth: 0.5 }),
                      H('path', { d: 'M6 16l.7 1.4 1.5.4-1 1 .2 1.6L6 19.6l-1.4.8.2-1.6-1-1 1.5-.4.7-1.4z', fill: '#fde68a', stroke: '#fbbf24', strokeWidth: 0.5 }),
                      H('path', { d: 'M18 16l.7 1.4 1.5.4-1 1 .2 1.6-1.4-.8-1.4.8.2-1.6-1-1 1.5-.4.7-1.4z', fill: '#fde68a', stroke: '#fbbf24', strokeWidth: 0.5 })
                    ),
                    H('div', null,
                      H('div', { style: { fontWeight: 700, fontSize: 14, marginBottom: 2 } }, 'Profile Customization'),
                      H('div', { style: { fontSize: 13, color: '#666' } }, 'Upload a custom banner image to personalize your profile')
                    )
                  ),
                  H('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 6 } },
                    H('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none' },
                      H('path', { d: 'M13 2L3 14h8l-1 8 10-12h-8l1-8z', fill: '#fbbf24', stroke: '#f59e0b', strokeWidth: 1 })
                    ),
                    H('div', null,
                      H('div', { style: { fontWeight: 700, fontSize: 14, marginBottom: 2 } }, 'Karma System'),
                      H('div', { style: { fontSize: 13, color: '#666' } }, 'Collect and award karma when selling and buying from other premium users')
                    )
                  )
                ),
                // Pricing
                H('div', {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '16px 20px',
                    border: '2px solid #e5e7eb',
                    borderRadius: 12,
                    background: '#fafafa',
                    marginTop: 4
                  }
                },
                  H('div', { style: { textAlign: 'center' } },
                    H('div', { style: { fontWeight: 800, fontSize: 22 } }, `${premiumText}/month`),
                    H('div', { style: { fontSize: 12, color: '#666' } }, 'Cancel anytime from your profile')
                  )
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
      const [closing, setClosing] = useState(false);

      useModalLifecycle(open, onClose);

      // Reset closing state when modal opens
      useEffect(() => {
        if (open) setClosing(false);
      }, [open]);

      const safeClose = useCallback(() => {
        if (closing || busy || selecting) return;
        setClosing(true);
        onClose?.();
      }, [closing, busy, selecting, onClose]);

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
        if (evt.target === evt.currentTarget) {
          safeClose();
        }
      };

      const handleSelectBuyer = async (buyerId) => {
        if (selecting || busy || closing) return;
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
        if (busy || selecting || closing) return;
        // Call onSkip if provided, otherwise fall back to safeClose
        if (onSkip) {
          setClosing(true);
          onSkip();
        } else {
          safeClose();
        }
      };

      if (!open) return null;

      return ReactDOM.createPortal(
        H('div', { className: 'supporter-modal__overlay', onClick: handleOverlay },
          H('div', {
            className: 'supporter-modal__card',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': 'Select buyer for karma',
            onClick: (e) => e.stopPropagation()
          },
            H('button', {
              type: 'button',
              className: 'supporter-modal__close',
              onClick: safeClose,
              disabled: busy || selecting || closing
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
                        badge: buyer.supporter_badge,
                        tier: buyer.supporter_tier
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
                disabled: busy || selecting || closing,
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
