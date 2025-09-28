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

    function usePushNotifications({ user, pushMeta }) {
      const pushSetupRef = useRef({ userId: null, permission: null });

      const removePushSubscription = useCallback(async () => {
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

      useEffect(() => {
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
            pushSetupRef.current = { userId: user.id, permission: 'denied' };
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
                pushSetupRef.current = { userId: user.id, permission: 'error' };
                return;
              }
            }

            if (permission !== 'granted') {
              pushSetupRef.current = { userId: user.id, permission };
              return;
            }

            const applicationServerKey = base64UrlToUint8Array(vapidKey);
            if (!applicationServerKey) {
              pushSetupRef.current = { userId: user.id, permission: 'error' };
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
              pushSetupRef.current = { userId: user.id, permission: 'error' };
              return;
            }

            const serialized = serializePushSubscription(subscription);
            if (!serialized) {
              pushSetupRef.current = { userId: user.id, permission: 'error' };
              return;
            }

            await api.pushSubscribe(serialized, { silent: true });
            pushSetupRef.current = { userId: user.id, permission: 'granted' };
          } catch (err) {
            console.warn('Push setup failed:', err);
            pushSetupRef.current = { userId: user.id, permission: 'error' };
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
