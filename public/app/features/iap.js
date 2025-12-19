/**
 * In-App Purchase service for iOS StoreKit integration
 * Uses cordova-plugin-purchase for Capacitor
 */
(() => {
  const PRODUCT_ID = '186000'; // From App Store Connect

  function createIAPService({ api } = {}) {
    let store = null;
    let initialized = false;
    let onPurchaseComplete = null;
    let onPurchaseError = null;

    // Check if running in iOS native app
    function isIOSNative() {
      try {
        const platform = window.Capacitor?.getPlatform?.();
        return platform === 'ios';
      } catch {
        return false;
      }
    }

    // Initialize the store - call this on app startup
    async function initialize() {
      if (!isIOSNative()) {
        console.log('[IAP] Not iOS native, skipping initialization');
        return false;
      }

      if (initialized) {
        console.log('[IAP] Already initialized');
        return true;
      }

      // Wait for cordova-plugin-purchase to be ready
      if (!window.CdvPurchase) {
        console.warn('[IAP] CdvPurchase not available');
        return false;
      }

      store = window.CdvPurchase.store;

      try {
        // Configure the store
        store.verbosity = window.CdvPurchase.LogLevel.DEBUG;

        // Register the product
        store.register([{
          id: PRODUCT_ID,
          type: window.CdvPurchase.ProductType.PAID_SUBSCRIPTION,
          platform: window.CdvPurchase.Platform.APPLE_APPSTORE
        }]);

        // Handle approved purchases
        store.when()
          .approved(async (transaction) => {
            console.log('[IAP] Purchase approved:', transaction);

            // Get the receipt and send to server for validation
            const receipt = transaction.parentReceipt;
            if (receipt) {
              try {
                const result = await validateReceiptWithServer(receipt);
                if (result.success) {
                  // Finish the transaction
                  await transaction.finish();
                  console.log('[IAP] Transaction finished');

                  if (onPurchaseComplete) {
                    onPurchaseComplete(result);
                  }
                } else {
                  console.error('[IAP] Server validation failed:', result.error);
                  if (onPurchaseError) {
                    onPurchaseError(new Error(result.error || 'Validation failed'));
                  }
                }
              } catch (err) {
                console.error('[IAP] Receipt validation error:', err);
                if (onPurchaseError) {
                  onPurchaseError(err);
                }
              }
            }
          })
          .finished((transaction) => {
            console.log('[IAP] Transaction finished:', transaction);
          })
          .verified((receipt) => {
            console.log('[IAP] Receipt verified:', receipt);
          });

        // Handle errors
        store.error((error) => {
          console.error('[IAP] Store error:', error);
          if (onPurchaseError) {
            onPurchaseError(error);
          }
        });

        // Initialize the store
        await store.initialize([window.CdvPurchase.Platform.APPLE_APPSTORE]);

        initialized = true;
        console.log('[IAP] Store initialized successfully');
        return true;
      } catch (err) {
        console.error('[IAP] Initialization error:', err);
        return false;
      }
    }

    // Validate receipt with our server
    async function validateReceiptWithServer(receipt) {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('Not authenticated');
      }

      // Get the raw receipt data
      const receiptData = receipt.nativeData?.appStoreReceipt;
      if (!receiptData) {
        throw new Error('No receipt data');
      }

      const response = await fetch('/api/subscriptions/apple/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          receipt: receiptData,
          productId: PRODUCT_ID
        })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Validation request failed');
      }

      return response.json();
    }

    // Get the product info (price, etc.)
    function getProduct() {
      if (!store || !initialized) {
        return null;
      }
      return store.get(PRODUCT_ID, window.CdvPurchase.Platform.APPLE_APPSTORE);
    }

    // Get formatted price string
    function getPrice() {
      const product = getProduct();
      if (product?.pricing) {
        return product.pricing.price;
      }
      return '$2.99'; // Fallback
    }

    // Purchase the subscription
    async function purchase() {
      if (!isIOSNative()) {
        throw new Error('IAP only available on iOS');
      }

      if (!store || !initialized) {
        const success = await initialize();
        if (!success) {
          throw new Error('Store not initialized');
        }
      }

      const product = getProduct();
      if (!product) {
        throw new Error('Product not found');
      }

      console.log('[IAP] Starting purchase for:', PRODUCT_ID);

      return new Promise((resolve, reject) => {
        onPurchaseComplete = (result) => {
          onPurchaseComplete = null;
          onPurchaseError = null;
          resolve(result);
        };
        onPurchaseError = (error) => {
          onPurchaseComplete = null;
          onPurchaseError = null;
          reject(error);
        };

        // Initiate the purchase
        const offer = product.getOffer();
        if (offer) {
          store.order(offer).catch(reject);
        } else {
          reject(new Error('No offer available'));
        }
      });
    }

    // Restore previous purchases
    async function restorePurchases() {
      if (!isIOSNative()) {
        return { restored: false };
      }

      if (!store || !initialized) {
        await initialize();
      }

      if (!store) {
        return { restored: false };
      }

      console.log('[IAP] Restoring purchases...');
      await store.restorePurchases();

      // Check if user has active subscription
      const product = getProduct();
      if (product?.owned) {
        return { restored: true };
      }

      return { restored: false };
    }

    // Check if user has active subscription (from store)
    function hasActiveSubscription() {
      const product = getProduct();
      return product?.owned || false;
    }

    return {
      initialize,
      purchase,
      restorePurchases,
      getProduct,
      getPrice,
      hasActiveSubscription,
      isIOSNative,
      PRODUCT_ID
    };
  }

  window.ListItApp = window.ListItApp || {};
  window.ListItApp.features = window.ListItApp.features || {};
  window.ListItApp.features.iap = { createIAPService };
})();
