(() => {
  function createMessageCenterFeature({ React, api, helpers, notifications }) {
    if (!React || typeof React.useState !== 'function') {
      throw new Error('Message center feature requires React.');
    }
    if (!api) {
      throw new Error('Message center feature requires an API client.');
    }

    const { useState, useEffect, useRef, useCallback } = React;

    const loadSeen = helpers?.loadSeen;
    const saveSeen = helpers?.saveSeen;
    if (typeof loadSeen !== 'function') {
      throw new Error('Message center feature requires loadSeen helper.');
    }
    if (typeof saveSeen !== 'function') {
      throw new Error('Message center feature requires saveSeen helper.');
    }

    const useMessageNotifications = notifications?.useMessageNotifications;
    if (typeof useMessageNotifications !== 'function') {
      throw new Error('Message center feature requires useMessageNotifications hook.');
    }

    function useMessageCenter({ user, tab, onTabChange, onClearSeller }) {
      const [activeConvoId, setActiveConvoId] = useState(null);
      const [unreadCount, setUnreadCount] = useState(0);
      const [hasAdminUnread, setHasAdminUnread] = useState(false);
      const [windowFocused, setWindowFocused] = useState(() => {
        if (typeof document === 'undefined') return true;
        return !document.hidden;
      });

      const tabRef = useRef(tab);
      const activeConvoIdRef = useRef(activeConvoId);
      const windowFocusedRef = useRef(windowFocused);

      const notificationsInstance = useMessageNotifications({
        onSelectConversation: (conversationId) => {
          setActiveConvoId(conversationId || null);
          if (typeof onClearSeller === 'function') {
            onClearSeller();
          }
          if (typeof onTabChange === 'function') {
            onTabChange('messages');
          }
        }
      });

      const {
        showMessageToast,
        playNotificationTone,
        getConversationMeta,
        handleConversationsUpdate,
        resetNotifications,
        messageToasts,
        handleToastClick,
        removeToast
      } = notificationsInstance;

      useEffect(() => {
        tabRef.current = tab;
      }, [tab]);

      useEffect(() => {
        activeConvoIdRef.current = activeConvoId;
      }, [activeConvoId]);

      useEffect(() => {
        windowFocusedRef.current = windowFocused;
      }, [windowFocused]);

      useEffect(() => {
        if (typeof window === 'undefined' || typeof document === 'undefined') return;
        const handleFocus = () => setWindowFocused(true);
        const handleBlur = () => setWindowFocused(false);
        const handleVisibility = () => setWindowFocused(!document.hidden);
        window.addEventListener('focus', handleFocus);
        window.addEventListener('blur', handleBlur);
        document.addEventListener('visibilitychange', handleVisibility);
        return () => {
          window.removeEventListener('focus', handleFocus);
          window.removeEventListener('blur', handleBlur);
          document.removeEventListener('visibilitychange', handleVisibility);
        };
      }, []);

      const recomputeUnread = useCallback(async () => {
        try {
          if (!user) {
            setUnreadCount(0);
            setHasAdminUnread(false);
            return;
          }
          const convos = await api.listConversations({ silent: true });
          if (typeof handleConversationsUpdate === 'function') {
            handleConversationsUpdate(convos);
          }
          const seen = loadSeen(user.id);

          let unread = 0;
          let adminUnread = false;

          for (const convo of Array.isArray(convos) ? convos : []) {
            const lastId = convo?.last_message_id;
            const lastSender = convo?.last_message_sender_id;
            const seenValue = seen[convo?.id] || 0;
            let isUnread = false;

            if (lastId && lastSender && lastSender !== user.id) {
              if (!seenValue || lastId > seenValue) {
                isUnread = true;
              }
            }

            if (isUnread) {
              unread++;
              if (convo?.last_message_is_admin) {
                adminUnread = true;
              }
            }
          }

          setUnreadCount(unread);
          setHasAdminUnread(adminUnread);
        } catch {}
      }, [user?.id, api, loadSeen, handleConversationsUpdate]);

      useEffect(() => {
        if (!user) {
          setActiveConvoId(null);
          setUnreadCount(0);
          setHasAdminUnread(false);
          if (typeof resetNotifications === 'function') {
            resetNotifications();
          }
          return;
        }
        recomputeUnread();
      }, [user?.id, recomputeUnread, resetNotifications]);

      useEffect(() => {
        if (!user) return;

        let ws = null;
        let reconnectTimeout = null;

        function connectWebSocket() {
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          const wsUrl = `${protocol}//${window.location.host}/ws`;

          ws = new WebSocket(wsUrl);

          ws.onopen = () => {
            clearTimeout(reconnectTimeout);
          };

          ws.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);

              if (data?.type === 'new_message') {
                if (data.sender_id !== user.id) {
                  recomputeUnread();
                  const isViewingThisConversation =
                    tabRef.current === 'messages' &&
                    activeConvoIdRef.current === data.conversation_id &&
                    windowFocusedRef.current;

                  const shouldNotify = !isViewingThisConversation;

                  if (shouldNotify) {
                    const bodyText = typeof data?.message?.body === 'string' ? data.message.body : '';
                    const images = Array.isArray(data?.message?.images) ? data.message.images : [];
                    const convoMeta = typeof getConversationMeta === 'function'
                      ? getConversationMeta(data.conversation_id)
                      : null;
                    const senderName = data?.sender_username || convoMeta?.other_user_username || '';
                    const listingTitle = convoMeta?.listing_title || '';

                    if (typeof showMessageToast === 'function') {
                      showMessageToast({
                        conversationId: data.conversation_id,
                        messageId: data?.message?.id || null,
                        senderName,
                        listingTitle,
                        preview: bodyText,
                        imageCount: images.length
                      });
                    }
                    if (typeof playNotificationTone === 'function') {
                      playNotificationTone();
                    }
                  }
                }
              }
            } catch (err) {
              console.error('WebSocket message error (Message center):', err);
            }
          };

          ws.onerror = (error) => {
            console.error('WebSocket error (Message center):', error);
          };

          ws.onclose = (event) => {
            ws = null;
            if (event?.code !== 1008) {
              reconnectTimeout = setTimeout(() => {
                if (user) connectWebSocket();
              }, 3000);
            }
          };

          const pingInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ping' }));
            }
          }, 25000);

          return () => {
            clearInterval(pingInterval);
            if (ws) ws.close();
          };
        }

        const cleanup = connectWebSocket();

        return () => {
          if (typeof cleanup === 'function') cleanup();
          clearTimeout(reconnectTimeout);
          if (ws) {
            ws.close();
            ws = null;
          }
        };
      }, [user?.id, recomputeUnread, showMessageToast, playNotificationTone, getConversationMeta]);

      return {
        activeConvoId,
        setActiveConvoId,
        unreadCount,
        hasAdminUnread,
        recomputeUnread,
        notifications: {
          messageToasts,
          handleToastClick,
          removeToast,
          handleConversationsUpdate,
          resetNotifications,
          showMessageToast,
          playNotificationTone,
          getConversationMeta
        }
      };
    }

    return {
      useMessageCenter
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.messageCenter = {
    createMessageCenterFeature
  };
})();
