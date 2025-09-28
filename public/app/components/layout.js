(() => {
  function createLayoutComponents({ React }) {
    if (!React || typeof React.createElement !== 'function') {
      throw new Error('Layout components require React.');
    }

    const H = (tag, props, ...children) => React.createElement(tag, props || null, ...children);

    function GlobalLoader({ active }) {
      if (!active) return null;
      return H('div', { className: 'global-loader' },
        H('div', { className: 'spinner' }),
        H('div', { className: 'loader-text' }, 'Loading...')
      );
    }

    function Header({ user, setUser, onNav, active, unreadCount, onAdminDeleteAll, isMobile, onAuthClick, hasAdminUnread }) {
      if (!user) {
        return H('header', null,
          H('div', { className: 'container row', style: { justifyContent: 'space-between' } },
            H('div', { className: 'row', style: { gap: 18, alignItems: 'center' } },
              H('div', { className: 'brand-badge' },
                H('div', { className: 'brand-ring' }),
                H('div', { className: 'brand-initials' }, 'CL')
              ),
              H('div', { className: 'brand-copy' },
                H('div', { className: 'brand-title' }, 'Creegslist'),
                H('div', { className: 'brand-tagline' }, 'Sell on the spot')
              )
            ),
            H('div', { className: 'row', style: { gap: 8 } },
              H('button', { className: 'btn', onClick: () => onAuthClick('register') }, 'Register'),
              H('button', { className: 'btn primary', onClick: () => onAuthClick('login') }, 'Log In')
            )
          )
        );
      }

      const profileLabel = user ? (user.username ? `@${user.username}` : user.email) : 'Profile';

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

      const messagesBtn = H('button', {
        className: `btn ${active==='messages'?'primary':''}`,
        style: { position: 'relative' },
        onClick: () => {
          if (!user) { alert('Log in to view messages.'); return; }
          onNav('messages');
        }
      }, 'Messages',
        (unreadCount > 0) &&
          H('span', { style: { position: 'absolute', top: -2, right: -2, width: 10, height: 10, borderRadius: 10, background: unreadDotColor } })
      );

      return H('header', null,
        H('div', { className: 'container row', style: { justifyContent: 'space-between' } },
          H('div', { className: 'row', style: { gap: 18, alignItems: 'center' } },
            H('div', { className: 'brand-badge' },
              H('div', { className: 'brand-ring' }),
              H('div', { className: 'brand-initials' }, 'CL')
            ),
            H('div', { className: 'brand-copy' },
              H('div', { className: 'brand-title' }, 'Creegslist'),
              H('div', { className: 'brand-tagline' }, 'Sell on the spot')
            )
          ),
          H('nav', { className: 'row' },
            H('button', { className: `btn ${active==='browse'?'primary':''}`, onClick: () => onNav('browse') }, 'Listings'),
            isMobile && H('button', { className: `btn ${active==='nearby'?'primary':''}`, onClick: () => onNav('nearby') }, 'Nearby'),
            messagesBtn,
            H('button', { className: `btn ${active==='profile'?'primary':''}`, onClick: () => onNav('profile'), title: 'Profile & settings' }, profileLabel),
            user?.is_admin && H('button', { className: `btn ${active==='admin'?'primary':''}`, onClick: () => onNav('admin') }, 'Admin')
          ),
          authArea
        )
      );
    }

    return {
      GlobalLoader,
      Header
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.components = window.ListItApp.components || {};
  window.ListItApp.components.layout = {
    createLayoutComponents
  };
})();
