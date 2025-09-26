(() => {
  function createNotificationsFeature({ React }) {
    if (!React || typeof React.useState !== 'function') {
      throw new Error('Notifications feature requires React.');
    }

    const { useState, useRef, useEffect, useCallback } = React;

    function useMessageNotifications({ onSelectConversation } = {}) {
      const [messageToasts, setMessageToasts] = useState([]);
      const toastTimersRef = useRef(new Map());
      const conversationMapRef = useRef(new Map());
      const audioCtxRef = useRef(null);

      const ensureAudioContext = useCallback(() => {
        if (typeof window === 'undefined') return null;
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return null;
        if (!audioCtxRef.current) {
          try {
            audioCtxRef.current = new Ctor();
          } catch (err) {
            console.warn('Audio context initialization failed:', err);
            return null;
          }
        }
        return audioCtxRef.current;
      }, []);

      const playNotificationTone = useCallback(() => {
        const ctx = ensureAudioContext();
        if (!ctx) return;
        const start = ctx.currentTime || 0;
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
        try {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(880, start);
          gain.gain.setValueAtTime(0, start);
          gain.gain.linearRampToValueAtTime(0.08, start + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(start);
          osc.stop(start + 0.5);
        } catch (err) {
          console.warn('Notification sound failed:', err);
        }
      }, [ensureAudioContext]);

      useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const unlock = () => {
          const ctx = ensureAudioContext();
          if (ctx && ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
          }
        };
        window.addEventListener('click', unlock);
        window.addEventListener('keydown', unlock);
        return () => {
          window.removeEventListener('click', unlock);
          window.removeEventListener('keydown', unlock);
        };
      }, [ensureAudioContext]);

      useEffect(() => () => {
        toastTimersRef.current.forEach(clearTimeout);
        toastTimersRef.current.clear();
      }, []);

      const removeToast = useCallback((id) => {
        if (!id) return;
        const timers = toastTimersRef.current;
        if (timers.has(id)) {
          clearTimeout(timers.get(id));
          timers.delete(id);
        }
        setMessageToasts((prev) => prev.filter((t) => t.id !== id));
      }, []);

      const showMessageToast = useCallback((payload = {}) => {
        if (typeof window === 'undefined') return;
        const now = Date.now();
        const id = payload.id || `msg:${payload.messageId || now}`;
        const senderName = (payload.senderName || '').toString().trim();
        const listingTitle = (payload.listingTitle || '').toString().trim();
        const imageCount = Number.isFinite(payload.imageCount)
          ? Number(payload.imageCount)
          : (payload.hasImages ? 1 : 0);
        let preview = typeof payload.preview === 'string' ? payload.preview.trim() : '';
        if (preview) preview = preview.replace(/\s+/g, ' ');
        if (!preview) {
          if (imageCount > 1) preview = 'Sent you photos.';
          else if (imageCount === 1) preview = 'Sent you a photo.';
          else preview = 'Tap to open the conversation.';
        }
        if (preview.length > 120) preview = `${preview.slice(0, 117)}…`;
        const titleParts = [];
        if (senderName) titleParts.push(senderName);
        if (listingTitle) titleParts.push(listingTitle);
        const title = titleParts.join(' · ') || 'New message';
        const toast = {
          id,
          conversationId: payload.conversationId || null,
          title,
          preview,
          ts: now
        };
        setMessageToasts((prev) => {
          const trimmed = prev.filter((item) => now - item.ts < 5500 && item.id !== toast.id);
          return [...trimmed, toast];
        });
        const duration = Number.isFinite(payload.durationMs) ? Number(payload.durationMs) : 6000;
        const timers = toastTimersRef.current;
        if (timers.has(id)) {
          clearTimeout(timers.get(id));
        }
        const timerId = window.setTimeout(() => removeToast(id), duration);
        timers.set(id, timerId);
      }, [removeToast]);

      const handleToastClick = useCallback((toast) => {
        if (!toast) return;
        if (typeof onSelectConversation === 'function') {
          onSelectConversation(toast.conversationId || null);
        }
        removeToast(toast.id);
      }, [onSelectConversation, removeToast]);

      const handleConversationsUpdate = useCallback((list) => {
        if (!Array.isArray(list)) {
          conversationMapRef.current = new Map();
          return;
        }
        const map = new Map();
        for (const convo of list) {
          if (!convo || convo.id == null) continue;
          map.set(convo.id, convo);
        }
        conversationMapRef.current = map;
      }, []);

      const getConversationMeta = useCallback((id) => {
        if (id == null) return null;
        return conversationMapRef.current.get(id) || null;
      }, []);

      const resetNotifications = useCallback(() => {
        toastTimersRef.current.forEach(clearTimeout);
        toastTimersRef.current.clear();
        setMessageToasts([]);
        conversationMapRef.current = new Map();
      }, []);

      return {
        messageToasts,
        showMessageToast,
        removeToast,
        handleToastClick,
        handleConversationsUpdate,
        playNotificationTone,
        resetNotifications,
        getConversationMeta
      };
    }

    return {
      useMessageNotifications
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.notifications = {
    createNotificationsFeature
  };
})();
