(() => {
  console.log('[Push] push.js file loaded');
  alert('PUSH.JS LOADED - TEST');

  function createPushFeature({ React, api, helpers }) {
    console.log('[Push] createPushFeature called');
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
      return window.Capacitor?.Plugins?.PushNotifications;
    }

    function usePushNotifications({ user, pushMeta }) {
      console.log('[Push] usePushNotifications hook called', { userId: user?.id, pushMeta });
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
        console.log('[Push Debug] Starting push setup check');
        console.log('[Push Debug] isNativeCapacitor:', isNativeCapacitor());
        console.log('[Push Debug] platform:', window.Capacitor?.getPlatform?.());
        console.log('[Push Debug] user?.id:', user?.id);
        console.log('[Push Debug] Capacitor.Plugins:', Object.keys(window.Capacitor?.Plugins || {}));

        if (!isNativeCapacitor()) {
          console.log('[Push Debug] Not native Capacitor, skipping');
          return;
        }
        if (!user?.id) {
          console.log('[Push Debug] No user id, skipping');
          return;
        }

        const PushNotifications = getCapacitorPush();
        console.log('[Push Debug] PushNotifications plugin:', !!PushNotifications);

        if (!PushNotifications) {
          console.warn('PushNotifications plugin not available');
          return;
        }

        let aborted = false;

        async function setupNativePush() {
          try {
            console.log('[Push Debug] setupNativePush starting');

            // Check/request permissions
            let permStatus = await PushNotifications.checkPermissions();
            console.log('[Push Debug] checkPermissions result:', permStatus);

            if (permStatus.receive === 'prompt') {
              console.log('[Push Debug] Requesting permissions...');
              permStatus = await PushNotifications.requestPermissions();
              console.log('[Push Debug] requestPermissions result:', permStatus);
            }

            if (permStatus.receive !== 'granted') {
              console.log('Push permission not granted:', permStatus.receive);
              pushSetupRef.current = { userId: user.id, permission: permStatus.receive, platform: 'native' };
              return;
            }

            // Register with APNs/FCM
            console.log('[Push Debug] Calling PushNotifications.register()');
            await PushNotifications.register();
            console.log('[Push Debug] register() called successfully');

            // Listen for registration success
            const registrationListener = await PushNotifications.addListener('registration', async (token) => {
              if (aborted) return;
              console.log('Push registration success, token:', token.value?.substring(0, 20) + '...');

              pushSetupRef.current = {
                userId: user.id,
                permission: 'granted',
                platform: 'native',
                token: token.value
              };

              // Send token to server
              try {
                await api.pushSubscribeIos?.({
                  token: token.value,
                  platform: window.Capacitor?.getPlatform?.() || 'ios'
                }, { silent: true });
              } catch (err) {
                console.warn('Failed to register iOS token with server:', err);
              }
            });
            listenersRef.current.push(registrationListener);

            // Listen for registration errors
            const errorListener = await PushNotifications.addListener('registrationError', (error) => {
              console.error('Push registration failed:', error);
              pushSetupRef.current = { userId: user.id, permission: 'error', platform: 'native' };
            });
            listenersRef.current.push(errorListener);

            // Listen for push notifications received while app is open
            const receivedListener = await PushNotifications.addListener('pushNotificationReceived', (notification) => {
              console.log('Push received in foreground:', notification);
              // Could show an in-app toast here
            });
            listenersRef.current.push(receivedListener);

            // Listen for notification taps
            const actionListener = await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
              console.log('Push notification tapped:', action);
              // Could navigate to relevant screen here
              const data = action.notification?.data;
              if (data?.conversation_id) {
                // Navigate to messages
                window.ListItApp?.AppNav?.setTab?.('messages');
              }
            });
            listenersRef.current.push(actionListener);

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
