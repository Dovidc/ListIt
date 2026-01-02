/**
 * In-App Purchase service using RevenueCat
 * Works for both iOS and Android
 */
(() => {
  // RevenueCat API keys
  const REVENUECAT_IOS_KEY = 'appl_FGekEpkmrbWaYAsUDOvzXcSBvWR';
  const REVENUECAT_ANDROID_KEY = 'goog_MSMwTBUetahviEwzUZTmVmcbGVc';
  const ENTITLEMENT_ID = 'Trovelr Premium';

  function createIAPService({ api } = {}) {
    let initialized = false;
    let Purchases = null;

    // Check if running in native app (iOS or Android)
    function isNativeApp() {
      try {
        const platform = window.Capacitor?.getPlatform?.();
        return platform === 'ios' || platform === 'android';
      } catch {
        return false;
      }
    }

    // Check if running in iOS native app
    function isIOSNative() {
      try {
        const platform = window.Capacitor?.getPlatform?.();
        return platform === 'ios';
      } catch {
        return false;
      }
    }

    // Check if running in Android native app
    function isAndroidNative() {
      try {
        const platform = window.Capacitor?.getPlatform?.();
        return platform === 'android';
      } catch {
        return false;
      }
    }

    // Initialize RevenueCat - call this on app startup
    async function initialize(userId = null) {
      if (!isNativeApp()) {
        console.log('[RevenueCat] Not native app, skipping initialization');
        return false;
      }

      if (initialized) {
        console.log('[RevenueCat] Already initialized');
        return true;
      }

      try {
        // Dynamic import for RevenueCat
        const RC = await import('@revenuecat/purchases-capacitor');
        Purchases = RC.Purchases;

        const platform = window.Capacitor.getPlatform();
        const apiKey = platform === 'ios' ? REVENUECAT_IOS_KEY : REVENUECAT_ANDROID_KEY;

        console.log('[RevenueCat] Configuring for platform:', platform);

        await Purchases.configure({
          apiKey: apiKey
        });

        // If we have a user ID, log them in
        if (userId) {
          await Purchases.logIn({ appUserID: userId });
          console.log('[RevenueCat] Logged in user:', userId);
        }

        initialized = true;
        console.log('[RevenueCat] Initialized successfully');
        return true;
      } catch (err) {
        console.error('[RevenueCat] Initialization error:', err);
        return false;
      }
    }

    // Log in a user (call after user authenticates)
    async function login(userId) {
      if (!Purchases || !initialized) {
        await initialize(userId);
        return;
      }

      try {
        await Purchases.logIn({ appUserID: String(userId) });
        console.log('[RevenueCat] User logged in:', userId);
      } catch (err) {
        console.error('[RevenueCat] Login error:', err);
      }
    }

    // Log out user
    async function logout() {
      if (!Purchases || !initialized) return;

      try {
        await Purchases.logOut();
        console.log('[RevenueCat] User logged out');
      } catch (err) {
        console.error('[RevenueCat] Logout error:', err);
      }
    }

    // Check if user has active premium subscription
    async function hasActiveSubscription() {
      if (!Purchases || !initialized) {
        return false;
      }

      try {
        const { customerInfo } = await Purchases.getCustomerInfo();
        const isActive = customerInfo.entitlements.active[ENTITLEMENT_ID] !== undefined;
        console.log('[RevenueCat] Subscription active:', isActive);
        return isActive;
      } catch (err) {
        console.error('[RevenueCat] Error checking subscription:', err);
        return false;
      }
    }

    // Get customer info
    async function getCustomerInfo() {
      if (!Purchases || !initialized) {
        return null;
      }

      try {
        const { customerInfo } = await Purchases.getCustomerInfo();
        return customerInfo;
      } catch (err) {
        console.error('[RevenueCat] Error getting customer info:', err);
        return null;
      }
    }

    // Get available offerings (products)
    async function getOfferings() {
      if (!Purchases || !initialized) {
        return null;
      }

      try {
        const { offerings } = await Purchases.getOfferings();
        console.log('[RevenueCat] Offerings:', offerings);
        return offerings;
      } catch (err) {
        console.error('[RevenueCat] Error getting offerings:', err);
        return null;
      }
    }

    // Get formatted price string
    async function getPrice() {
      try {
        const offerings = await getOfferings();
        if (offerings?.current?.monthly) {
          return offerings.current.monthly.product.priceString;
        }
        if (offerings?.current?.availablePackages?.[0]) {
          return offerings.current.availablePackages[0].product.priceString;
        }
      } catch (err) {
        console.error('[RevenueCat] Error getting price:', err);
      }
      return '$2.99'; // Fallback
    }

    // Purchase the subscription
    async function purchase() {
      if (!isNativeApp()) {
        throw new Error('IAP only available in native app');
      }

      if (!Purchases || !initialized) {
        const success = await initialize();
        if (!success) {
          throw new Error('RevenueCat not initialized');
        }
      }

      try {
        // Get offerings
        const { offerings } = await Purchases.getOfferings();

        if (!offerings?.current?.availablePackages?.length) {
          throw new Error('No packages available');
        }

        // Get the first available package (monthly subscription)
        const packageToPurchase = offerings.current.monthly ||
                                   offerings.current.availablePackages[0];

        console.log('[RevenueCat] Purchasing package:', packageToPurchase.identifier);

        // Make the purchase
        const { customerInfo } = await Purchases.purchasePackage({
          aPackage: packageToPurchase
        });

        // Check if purchase was successful
        const isActive = customerInfo.entitlements.active[ENTITLEMENT_ID] !== undefined;

        if (isActive) {
          console.log('[RevenueCat] Purchase successful!');

          // Notify our server about the purchase
          await notifyServerOfPurchase(customerInfo);

          return { success: true, customerInfo };
        } else {
          throw new Error('Purchase completed but entitlement not active');
        }
      } catch (err) {
        // Check if user cancelled
        if (err.code === 'PURCHASE_CANCELLED' || err.userCancelled) {
          console.log('[RevenueCat] User cancelled purchase');
          throw new Error('Purchase cancelled');
        }
        console.error('[RevenueCat] Purchase error:', err);
        throw err;
      }
    }

    // Notify our server about a purchase (for syncing supporter status)
    async function notifyServerOfPurchase(customerInfo) {
      const token = localStorage.getItem('token');
      if (!token) {
        console.warn('[RevenueCat] No auth token, skipping server notification');
        return;
      }

      try {
        const response = await fetch('/api/subscriptions/revenuecat/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            revenuecatUserId: customerInfo.originalAppUserId,
            entitlements: Object.keys(customerInfo.entitlements.active)
          })
        });

        if (!response.ok) {
          console.error('[RevenueCat] Server sync failed');
        } else {
          console.log('[RevenueCat] Server synced successfully');
        }
      } catch (err) {
        console.error('[RevenueCat] Server sync error:', err);
      }
    }

    // Restore previous purchases
    async function restorePurchases() {
      if (!isNativeApp()) {
        return { restored: false };
      }

      if (!Purchases || !initialized) {
        await initialize();
      }

      if (!Purchases) {
        return { restored: false };
      }

      try {
        console.log('[RevenueCat] Restoring purchases...');
        const { customerInfo } = await Purchases.restorePurchases();

        const isActive = customerInfo.entitlements.active[ENTITLEMENT_ID] !== undefined;

        if (isActive) {
          console.log('[RevenueCat] Purchases restored successfully');
          await notifyServerOfPurchase(customerInfo);
          return { restored: true, customerInfo };
        }

        console.log('[RevenueCat] No active subscription found');
        return { restored: false };
      } catch (err) {
        console.error('[RevenueCat] Restore error:', err);
        return { restored: false, error: err.message };
      }
    }

    return {
      initialize,
      login,
      logout,
      purchase,
      restorePurchases,
      getOfferings,
      getPrice,
      hasActiveSubscription,
      getCustomerInfo,
      isNativeApp,
      isIOSNative,
      isAndroidNative,
      ENTITLEMENT_ID
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.iap = { createIAPService };
})();
