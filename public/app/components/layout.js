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
      const isMobile = window.innerWidth < 768;
      return H('div', { className: fadeOut ? 'resume-overlay fade-out' : 'resume-overlay' },
        H('div', { className: 'resume-overlay__content' },
          H('div', { className: 'resume-overlay__icon' },
            H('div', { className: 'resume-overlay__geometric' },
              H('div', { className: 'resume-overlay__hexagon resume-overlay__hexagon--outer' }),
              H('div', { className: 'resume-overlay__hexagon resume-overlay__hexagon--middle' }),
              H('div', { className: 'resume-overlay__hexagon resume-overlay__hexagon--inner' })
            )
          ),
          isMobile && H('div', { className: 'resume-overlay__quote' },
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
            H('div', { className: 'row', style: { gap: 8, alignItems: 'center' } },
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

      const authArea = null;

      const unreadDotColor = hasAdminUnread ? '#111' : '#ef4444';

      const messagesBtn = navButton('messages', 'Messages', () => {
        if (!user) { onAuthClick('login'); return; }
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
          H('nav', { className: 'row', style: { alignItems: 'center' } },
            navButton('browse', 'Listings', () => onNav('browse')),
            messagesBtn,
            navButton('profile', profileButtonLabel, () => onNav('profile'), null, { title: 'Profile & settings' }),
            user?.is_admin && navButton('admin', 'Admin', () => onNav('admin'))
          ),
          authArea
        )
      );
    }

    function CustomDropdown({ value, onChange, options, disabled, style }) {
      const [isOpen, setIsOpen] = React.useState(false);
      const containerRef = React.useRef(null);

      // Close dropdown when clicking outside
      React.useEffect(() => {
        function handleClickOutside(event) {
          if (containerRef.current && !containerRef.current.contains(event.target)) {
            setIsOpen(false);
          }
        }
        if (isOpen) {
          document.addEventListener('mousedown', handleClickOutside);
          document.addEventListener('touchstart', handleClickOutside);
        }
        return () => {
          document.removeEventListener('mousedown', handleClickOutside);
          document.removeEventListener('touchstart', handleClickOutside);
        };
      }, [isOpen]);

      const selectedOption = options.find(opt => opt.value === value);
      const selectedLabel = selectedOption ? selectedOption.label : '';

      const handleSelect = (optValue) => {
        onChange({ target: { value: optValue } });
        setIsOpen(false);
      };

      return H('div', {
        ref: containerRef,
        className: 'custom-dropdown' + (isOpen ? ' open' : '') + (disabled ? ' disabled' : ''),
        style: style
      },
        H('button', {
          type: 'button',
          className: 'custom-dropdown__trigger',
          onClick: () => !disabled && setIsOpen(!isOpen),
          disabled: disabled
        },
          H('span', { className: 'custom-dropdown__value' }, selectedLabel),
          H('span', { className: 'custom-dropdown__arrow' },
            H('svg', {
              width: 12,
              height: 12,
              viewBox: '0 0 12 12',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 2,
              strokeLinecap: 'round',
              strokeLinejoin: 'round'
            },
              H('path', { d: isOpen ? 'M9 7.5L6 4.5L3 7.5' : 'M3 4.5L6 7.5L9 4.5' })
            )
          )
        ),
        isOpen && H('div', { className: 'custom-dropdown__menu' },
          options.map(opt =>
            H('button', {
              key: opt.value,
              type: 'button',
              className: 'custom-dropdown__option' + (opt.value === value ? ' selected' : ''),
              onClick: () => handleSelect(opt.value)
            },
              opt.label,
              opt.value === value && H('span', { className: 'custom-dropdown__check' },
                H('svg', {
                  width: 14,
                  height: 14,
                  viewBox: '0 0 14 14',
                  fill: 'none',
                  stroke: 'currentColor',
                  strokeWidth: 2,
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round'
                },
                  H('path', { d: 'M11 4L5.5 10L3 7.5' })
                )
              )
            )
          )
        )
      );
    }

    return {
      GlobalLoader,
      ResumeOverlay,
      Header,
      CustomDropdown
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.components = window.ListItApp.components || {};
  window.ListItApp.components.layout = {
    createLayoutComponents
  };
})();
