(() => {
  function createPushFeature({ React, api, helpers }) {
    if (!React || typeof React.useRef !== 'function') {
      throw new Error('Push feature requires React.');
    }
    if (!api) {
      throw new Error('Push feature requires an API client.');
    }

    const { useRef, useEffect, useCallback } = React;
    const serializePushSubscription = helpers?.serializePushSubscription;
    const base64UrlToUint8Array = helpers?.base64UrlToUint8Array;

    if (typeof serializePushSubscription !== 'function') {
      throw new Error('Push feature requires helpers.serializePushSubscription.');
    }
    if (typeof base64UrlToUint8Array !== 'function') {
      throw new Error('Push feature requires helpers.base64UrlToUint8Array.');
    }

    // Check if running in native iOS/Android via Capacitor
    function isNativeCapacitor() {
      const platform = window.Capacitor?.getPlatform?.();
      return platform === 'ios' || platform === 'android';
    }

    // Get Capacitor PushNotifications plugin
    function getCapacitorPush() {
      // Try different possible names for the plugin
      const plugins = window.Capacitor?.Plugins || {};
      return plugins.PushNotifications ||
             plugins.CapacitorPushNotifications ||
             plugins.pushNotifications ||
             window.Capacitor?.registerPlugin?.('PushNotifications');
    }

    function usePushNotifications({ user, pushMeta }) {
      const pushSetupRef = useRef({ userId: null, permission: null, platform: null });
      const listenersRef = useRef([]);

      // Remove push subscription (works for both web and native)
      const removePushSubscription = useCallback(async () => {
        // Native iOS/Android
        if (isNativeCapacitor()) {
          const PushNotifications = getCapacitorPush();
          if (!PushNotifications) return;
          try {
            // Tell server to remove this device's token
            const lastToken = pushSetupRef.current.token;
            if (lastToken) {
              try {
                await api.pushUnsubscribeIos?.({ token: lastToken }, { silent: true });
              } catch (err) {
                console.warn('iOS push unsubscribe request failed:', err);
              }
            }
            // Remove listeners
            for (const listener of listenersRef.current) {
              if (listener?.remove) await listener.remove();
            }
            listenersRef.current = [];
          } catch (err) {
            console.warn('Native push cleanup failed:', err);
          }
          return;
        }

        // Web push
        if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
        try {
          const registration = await navigator.serviceWorker.getRegistration();
          if (!registration || !registration.pushManager) return;
          const subscription = await registration.pushManager.getSubscription();
          if (!subscription) return;
          const serialized = serializePushSubscription(subscription);
          if (serialized) {
            try {
              await api.pushUnsubscribe(serialized, { silent: true });
            } catch (err) {
              console.warn('Push unsubscribe request failed:', err);
            }
          }
          try {
            await subscription.unsubscribe();
          } catch (err) {
            console.warn('Push unsubscribe failed:', err);
          }
        } catch (err) {
          console.warn('Push cleanup failed:', err);
        }
      }, [api, serializePushSubscription]);

      // Native iOS/Android push setup
      useEffect(() => {
        if (!isNativeCapacitor()) return;
        if (!user?.id) return;

        const PushNotifications = getCapacitorPush();

        if (!PushNotifications) {
          console.warn('PushNotifications plugin not available. Available:', Object.keys(window.Capacitor?.Plugins || {}));
          return;
        }

        let aborted = false;

        async function setupNativePush() {
          try {
            // Check/request permissions
            let permStatus = await PushNotifications.checkPermissions();

            if (permStatus.receive === 'prompt') {
              permStatus = await PushNotifications.requestPermissions();
            }

            if (permStatus.receive !== 'granted') {
              pushSetupRef.current = { userId: user.id, permission: permStatus.receive, platform: 'native' };
              return;
            }

            // IMPORTANT: Set up listeners BEFORE calling register() to avoid race condition
            // APNs can respond very quickly, and we'd miss the token if listeners aren't ready

            // Listen for registration success
            const registrationListener = await PushNotifications.addListener('registration', async (token) => {
              if (aborted) return;

              pushSetupRef.current = {
                userId: user.id,
                permission: 'granted',
                platform: 'native',
                token: token.value
              };

              // Send token to server
              try {
                await api.pushSubscribeIos({
                  token: token.value,
                  platform: window.Capacitor?.getPlatform?.() || 'ios'
                });
              } catch {
                // Silently fail - will retry on next app launch
              }
            });
            listenersRef.current.push(registrationListener);

            // Listen for registration errors
            const errorListener = await PushNotifications.addListener('registrationError', (error) => {
              console.error('Push registration failed:', error);
              pushSetupRef.current = { userId: user.id, permission: 'error', platform: 'native' };
            });
            listenersRef.current.push(errorListener);

            // NOW call register() after listeners are ready
            await PushNotifications.register();

            // Listen for push notifications received while app is open
            const receivedListener = await PushNotifications.addListener('pushNotificationReceived', (notification) => {
              // Could show an in-app toast here
            });
            listenersRef.current.push(receivedListener);

            // Helper to handle notification tap
            function handleNotificationTap(action) {
              console.log('[Push] Notification tapped:', JSON.stringify(action));
              // Try multiple possible data locations
              const notification = action.notification || action;
              const data = notification?.data || notification?.payload || action?.data || {};
              console.log('[Push] Notification data:', JSON.stringify(data));

              // conversation_id might be a number or string
              const conversationId = data?.conversation_id || data?.conversationId;
              console.log('[Push] conversation_id:', conversationId, 'openConversation available:', typeof window.ListItApp?.AppNav?.openConversation);

              if (conversationId) {
                // Open the specific conversation - use slight delay to ensure app is ready
                setTimeout(() => {
                  if (typeof window.ListItApp?.AppNav?.openConversation === 'function') {
                    console.log('[Push] Calling openConversation with:', conversationId);
                    window.ListItApp.AppNav.openConversation(Number(conversationId) || conversationId);
                  } else {
                    console.log('[Push] openConversation not available, falling back to setTab');
                    window.ListItApp?.AppNav?.setTab?.('messages');
                  }
                }, 100);
              } else {
                console.log('[Push] No conversation_id in notification data, keys:', Object.keys(data));
              }
            }

            // Listen for notification taps (while app is running)
            const actionListener = await PushNotifications.addListener('pushNotificationActionPerformed', handleNotificationTap);
            listenersRef.current.push(actionListener);

            // Check for cold start - app launched from notification tap
            try {
              const delivered = await PushNotifications.getDeliveredNotifications();
              console.log('[Push] Delivered notifications on launch:', JSON.stringify(delivered));
              if (delivered?.notifications?.length > 0) {
                // Handle the first notification
                handleNotificationTap({ notification: delivered.notifications[0] });
                // Clear delivered notifications
                await PushNotifications.removeAllDeliveredNotifications();
              }
            } catch (e) {
              console.log('[Push] getDeliveredNotifications not available or failed:', e);
            }

          } catch (err) {
            console.error('Native push setup failed:', err);
            pushSetupRef.current = { userId: user.id, permission: 'error', platform: 'native' };
          }
        }

        setupNativePush();

        return () => {
          aborted = true;
          // Clean up listeners on unmount
          for (const listener of listenersRef.current) {
            if (listener?.remove) listener.remove();
          }
          listenersRef.current = [];
        };
      }, [user?.id, api]);

      // Web push setup (existing logic)
      useEffect(() => {
        if (isNativeCapacitor()) return; // Skip web push on native

        let aborted = false;

        async function setupPushNotifications() {
          if (!user?.id) return;
          if (!pushMeta?.available) return;
          if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
          if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
          if (typeof Notification === 'undefined') return;

          const vapidKey = pushMeta?.vapidPublicKey;
          if (!vapidKey) return;

          const currentPermission = Notification.permission;
          const last = pushSetupRef.current;
          if (last && last.userId === user.id && last.permission === 'granted' && currentPermission === 'granted') {
            return;
          }

          if (currentPermission === 'denied') {
            pushSetupRef.current = { userId: user.id, permission: 'denied', platform: 'web' };
            return;
          }

          try {
            const registration = await navigator.serviceWorker.register('/sw.js');
            const readyRegistration = await navigator.serviceWorker.ready.catch(() => registration);
            if (aborted) return;

            let permission = Notification.permission;
            if (permission === 'default' && typeof Notification.requestPermission === 'function') {
              try {
                permission = await Notification.requestPermission();
              } catch (err) {
                console.warn('Notification permission request failed:', err);
                pushSetupRef.current = { userId: user.id, permission: 'error', platform: 'web' };
                return;
              }
            }

            if (permission !== 'granted') {
              pushSetupRef.current = { userId: user.id, permission, platform: 'web' };
              return;
            }

            const applicationServerKey = base64UrlToUint8Array(vapidKey);
            if (!applicationServerKey) {
              pushSetupRef.current = { userId: user.id, permission: 'error', platform: 'web' };
              return;
            }

            let subscription = await readyRegistration.pushManager.getSubscription();
            if (!subscription) {
              subscription = await readyRegistration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey
              });
            }

            if (!subscription) {
              pushSetupRef.current = { userId: user.id, permission: 'error', platform: 'web' };
              return;
            }

            const serialized = serializePushSubscription(subscription);
            if (!serialized) {
              pushSetupRef.current = { userId: user.id, permission: 'error', platform: 'web' };
              return;
            }

            await api.pushSubscribe(serialized, { silent: true });
            pushSetupRef.current = { userId: user.id, permission: 'granted', platform: 'web' };
          } catch (err) {
            console.warn('Push setup failed:', err);
            pushSetupRef.current = { userId: user.id, permission: 'error', platform: 'web' };
          }
        }

        setupPushNotifications();

        return () => { aborted = true; };
      }, [
        user?.id,
        pushMeta?.available,
        pushMeta?.vapidPublicKey,
        api,
        serializePushSubscription,
        base64UrlToUint8Array
      ]);

      return { removePushSubscription };
    }

    return { usePushNotifications };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.push = window.ListItApp.features.push || {};
  window.ListItApp.features.push.createPushFeature = createPushFeature;
})();
