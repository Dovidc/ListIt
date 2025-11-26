(() => {
  function createLayoutComponents({ React }) {
    if (!React || typeof React.createElement !== 'function') {
      throw new Error('Layout components require React.');
    }

    const H = (tag, props, ...children) => React.createElement(tag, props || null, ...children);

    function GlobalLoader({ active }) {
      const [visible, setVisible] = React.useState(active);
      const [fadeOut, setFadeOut] = React.useState(false);

      React.useEffect(() => {
        if (active) {
          setVisible(true);
          setFadeOut(false);
        } else if (visible) {
          setFadeOut(true);
          const timer = setTimeout(() => {
            setVisible(false);
            setFadeOut(false);
          }, 250);
          return () => clearTimeout(timer);
        }
      }, [active, visible]);

      if (!visible) return null;
      return H('div', { className: fadeOut ? 'global-loader fade-out' : 'global-loader' },
        H('div', { className: 'spinner' }),
        H('div', { className: 'loader-text' }, 'Loading...')
      );
    }

    function ResumeOverlay({ active }) {
      const [visible, setVisible] = React.useState(active);
      const [fadeOut, setFadeOut] = React.useState(false);

      React.useEffect(() => {
        if (active) {
          setVisible(true);
          setFadeOut(false);
        } else if (visible) {
          setFadeOut(true);
          const timer = setTimeout(() => {
            setVisible(false);
            setFadeOut(false);
          }, 350);
          return () => clearTimeout(timer);
        }
      }, [active, visible]);

      if (!visible) return null;
      return H('div', { className: fadeOut ? 'resume-overlay fade-out' : 'resume-overlay' },
        H('div', { className: 'resume-overlay__content' },
          H('div', { className: 'resume-overlay__icon' },
            H('div', { className: 'resume-overlay__geometric' },
              H('div', { className: 'resume-overlay__hexagon resume-overlay__hexagon--outer' }),
              H('div', { className: 'resume-overlay__hexagon resume-overlay__hexagon--middle' }),
              H('div', { className: 'resume-overlay__hexagon resume-overlay__hexagon--inner' })
            )
          ),
          H('div', { className: 'resume-overlay__quote' },
            'One man\'s trash is another man\'s ',
            H('span', { style: { color: '#ffa366' } }, 'treasure')
          )
        )
      );
    }

    const navIcons = {
      browse: () => H('svg', {
        viewBox: '0 0 24 24',
        className: 'nav-icon-svg',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1.7,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        focusable: 'false',
        'aria-hidden': 'true'
      },
        H('rect', { x: 4, y: 4, width: 6.5, height: 6.5, rx: 1.6 }),
        H('rect', { x: 13.5, y: 4, width: 6.5, height: 6.5, rx: 1.6 }),
        H('rect', { x: 4, y: 13.5, width: 6.5, height: 6.5, rx: 1.6 }),
        H('rect', { x: 13.5, y: 13.5, width: 6.5, height: 6.5, rx: 1.6 })
      ),
      nearby: () => H('svg', {
        viewBox: '0 0 24 24',
        className: 'nav-icon-svg',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1.7,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        focusable: 'false',
        'aria-hidden': 'true'
      },
        H('path', { d: 'M12 21s-6-5.1-6-10.2C6 6.9 8.7 4 12 4s6 2.9 6 6.8C18 15.9 12 21 12 21z' }),
        H('circle', { cx: 12, cy: 10.5, r: 2.4 })
      ),
      messages: () => H('svg', {
        viewBox: '0 0 24 24',
        className: 'nav-icon-svg',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1.7,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        focusable: 'false',
        'aria-hidden': 'true'
      },
        H('path', { d: 'M5.4 5h13.2A1.4 1.4 0 0 1 20 6.4v7.8a1.4 1.4 0 0 1-1.4 1.4H9.8L6 19.2V15.6H5.4A1.4 1.4 0 0 1 4 14.2V6.4A1.4 1.4 0 0 1 5.4 5z' })
      ),
      profile: () => H('svg', {
        viewBox: '0 0 24 24',
        className: 'nav-icon-svg',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1.7,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        focusable: 'false',
        'aria-hidden': 'true'
      },
        H('circle', { cx: 12, cy: 9, r: 3.2 }),
        H('path', { d: 'M6.5 18.5a6 6 0 0 1 11 0' })
      ),
      admin: () => H('svg', {
        viewBox: '0 0 24 24',
        className: 'nav-icon-svg',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1.7,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        focusable: 'false',
        'aria-hidden': 'true'
      },
        H('path', { d: 'M12 4.5 19 7v5c0 4.2-3 7.8-7 8.5-4-.7-7-4.3-7-8.5V7l7-2.5z' }),
        H('path', { d: 'M12 10.5v3' }),
        H('path', { d: 'M12 16.5h.01' })
      )
    };

    function Header({ user, setUser, onNav, active, unreadCount, onAdminDeleteAll, isMobile, onAuthClick, hasAdminUnread }) {
      if (!user) {
        return H('header', null,
          H('div', { className: 'container row', style: { justifyContent: 'space-between' } },
            H('div', { className: 'row', style: { gap: 18, alignItems: 'center' } },
              H('div', { className: 'brand-copy' },
                H('div', { className: 'brand-title' }, 'Trovelr')
              )
            ),
            H('div', { className: 'row', style: { gap: 8 } },
              H('button', { className: 'btn', onClick: () => onAuthClick('register') }, 'Register'),
              H('button', { className: 'btn primary', onClick: () => onAuthClick('login') }, 'Log In')
            )
          )
        );
      }

      const profileLabel = user ? (user.username ? user.username : user.email) : 'Profile';
      const profileButtonLabel = isMobile ? 'Profile' : profileLabel;

      function navButton(key, label, onClick, extraChild, extraProps) {
        const iconFactory = navIcons[key];
        const children = [];
        if (isMobile && typeof iconFactory === 'function') {
          children.push(
            H('span', { className: 'nav-icon', 'aria-hidden': 'true' }, iconFactory())
          );
          children.push(H('span', { className: 'nav-label' }, label));
        } else {
          children.push(label);
        }
        if (extraChild) {
          children.push(extraChild);
        }

        const mergedProps = Object.assign({}, extraProps || {}, {
          className: ['btn', active === key ? 'primary' : '', extraProps && extraProps.className || ''].filter(Boolean).join(' '),
          onClick
        });

        if (!mergedProps.type) {
          mergedProps.type = 'button';
        }

        return H('button', mergedProps, ...children);
      }

      const authArea = user
        ? H('div', { className: 'row', style: { gap: 8 } },
            !!user.is_admin && H('button', {
              className: 'btn danger',
              onClick: async () => {
                if (confirm('Delete ALL listings? This cannot be undone.')) {
                  await onAdminDeleteAll?.();
                }
              }
            }, 'Admin: Delete ALL')
          )
        : null;

      const unreadDotColor = hasAdminUnread ? '#111' : '#ef4444';

      const messagesBtn = navButton('messages', 'Messages', () => {
        if (!user) { alert('Log in to view messages.'); return; }
        onNav('messages');
      },
        (unreadCount > 0) && H('span', { className: 'nav-unread-dot', style: { background: unreadDotColor } }),
        { style: { position: 'relative' } }
      );

      return H('header', null,
        H('div', { className: 'container row', style: { justifyContent: 'space-between' } },
          H('div', { className: 'row', style: { gap: 18, alignItems: 'center' } },
            H('div', { className: 'brand-copy' },
              H('div', { className: 'brand-title' }, 'Trovelr')
            )
          ),
          H('nav', { className: 'row' },
            navButton('browse', 'Listings', () => onNav('browse')),
            messagesBtn,
            navButton('profile', profileButtonLabel, () => onNav('profile'), null, { title: 'Profile & settings' }),
            user?.is_admin && navButton('admin', 'Admin', () => onNav('admin'))
          ),
          authArea
        )
      );
    }

    return {
      GlobalLoader,
      ResumeOverlay,
      Header
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.components = window.ListItApp.components || {};
  window.ListItApp.components.layout = {
    createLayoutComponents
  };
})();
