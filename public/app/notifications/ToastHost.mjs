import {
  Fragment,
  createElement,
  useMemo
} from '../shared/runtime.mjs';
import { useNotifications } from './NotificationsContext.mjs';

export function ToastHost() {
  const { toasts, dismiss } = useNotifications();
  const hasToasts = toasts.length > 0;
  const items = useMemo(() => toasts.map((toast) => {
    const className = `toast toast-${toast.type}`;
    return createElement('div', {
      key: toast.id,
      className,
      'data-testid': 'toast'
    },
      createElement('div', { className: 'toast-title' }, toast.title || 'Notification'),
      toast.message && createElement('div', { className: 'toast-body' }, toast.message),
      toast.action && createElement('button', {
        type: 'button',
        className: 'btn toast-action',
        onClick: () => {
          try {
            toast.action?.();
          } finally {
            dismiss(toast.id);
          }
        }
      }, toast.actionLabel || 'View'),
      createElement('button', {
        type: 'button',
        className: 'toast-dismiss',
        onClick: () => dismiss(toast.id),
        'aria-label': 'Dismiss notification'
      }, '×')
    );
  }), [toasts, dismiss]);

  if (!hasToasts) return null;

  return createElement(Fragment, null,
    createElement('div', { className: 'toast-stack', role: 'status', 'aria-live': 'polite' }, items)
  );
}
