import {
  React,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useState
} from '../shared/runtime.mjs';
import { useServices } from '../api/services.mjs';
import { useNotifications } from '../notifications/NotificationsContext.mjs';
import { useListings } from '../listings/ListingsContext.mjs';
import { useAuth } from '../auth/AuthContext.mjs';

const UploadsContext = React.createContext(null);

export function UploadsProvider({ children }) {
  const { api } = useServices();
  const { notify } = useNotifications();
  const { refreshAll, refreshMine } = useListings();
  const { user } = useAuth();
  const [isSubmitting, setSubmitting] = useState(false);

  const createListing = useCallback(async ({ payload, uploadTokens = [] }) => {
    if (!user || user.id == null) {
      throw new Error('not_authenticated');
    }
    if (!payload || typeof payload !== 'object') {
      throw new Error('payload_required');
    }
    const tokens = Array.from(new Set((uploadTokens || []).map((token) => String(token).trim()).filter(Boolean)));
    const requestBody = { ...payload };
    if (tokens.length) {
      requestBody.upload_tokens = tokens;
    }
    setSubmitting(true);
    try {
      const listing = await api.createListing(requestBody);
      await Promise.allSettled([refreshAll(), refreshMine()]);
      notify({
        type: 'success',
        title: 'Listing created',
        message: listing?.title || 'Your item has been published.'
      });
      return listing;
    } catch (error) {
      notify({
        type: 'error',
        title: 'Listing failed',
        message: error?.message || 'Unable to create listing.'
      });
      throw error;
    } finally {
      setSubmitting(false);
    }
  }, [api, notify, refreshAll, refreshMine, user]);

  const value = useMemo(() => ({
    isSubmitting,
    createListing
  }), [isSubmitting, createListing]);

  return createElement(UploadsContext.Provider, { value }, children);
}

export function useUploads() {
  const context = useContext(UploadsContext);
  if (!context) {
    throw new Error('useUploads must be used within an UploadsProvider');
  }
  return context;
}
