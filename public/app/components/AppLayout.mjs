import {
  Fragment,
  createElement
} from '../shared/runtime.mjs';
import { ServicesProvider, useServices } from '../api/services.mjs';
import { NotificationsProvider } from '../notifications/NotificationsContext.mjs';
import { ToastHost } from '../notifications/ToastHost.mjs';
import { AuthProvider, useAuth } from '../auth/AuthContext.mjs';
import { AuthPanel } from '../auth/AuthPanel.mjs';
import { ListingsProvider } from '../listings/ListingsContext.mjs';
import { ListingsView } from '../listings/ListingsView.mjs';
import { UploadsProvider } from '../uploads/UploadsContext.mjs';
import { NewListingForm } from '../uploads/NewListingForm.mjs';

function Header() {
  const { user } = useAuth();
  return createElement('header', { className: 'app-header' },
    createElement('div', { className: 'container header-inner' },
      createElement('div', { className: 'brand' },
        createElement('div', { className: 'brand-badge' },
          createElement('div', { className: 'brand-ring' }),
          createElement('span', { className: 'brand-initials' }, 'LI')
        ),
        createElement('div', { className: 'brand-copy' },
          createElement('span', { className: 'brand-title' }, 'ListIt'),
          createElement('span', { className: 'brand-tagline' }, 'Sell smarter. Shop local.')
        )
      ),
      user && createElement('div', { className: 'header-user' },
        createElement('span', null, user.username || user.email || 'Account')
      )
    )
  );
}

function GlobalLoader() {
  const { loadingCount } = useServices();
  if (!loadingCount) return null;
  return createElement('div', { className: 'global-loader', 'data-testid': 'global-loader' },
    createElement('div', { className: 'spinner' }),
    createElement('div', { className: 'loader-text' }, 'Working…')
  );
}

function MainContent() {
  const { isAuthenticated } = useAuth();
  return createElement('main', { className: 'container app-main' },
    isAuthenticated ? createElement(NewListingForm) : createElement(AuthPanel),
    createElement(ListingsView)
  );
}

export function AppLayout() {
  return createElement(Fragment, null,
    createElement(Header),
    createElement(GlobalLoader),
    createElement(MainContent),
    createElement(ToastHost)
  );
}

export function AppProviders({ children }) {
  return createElement(ServicesProvider, null,
    createElement(NotificationsProvider, null,
      createElement(AuthProvider, null,
        createElement(ListingsProvider, null,
          createElement(UploadsProvider, null, children)
        )
      )
    )
  );
}
