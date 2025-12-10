import UIKit
import Capacitor
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    var window: UIWindow?
    var pendingConversationId: String? = nil

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Set notification delegate BEFORE anything else
        UNUserNotificationCenter.current().delegate = self

        // Let the webview control the background color - don't set window background

        // Note: Cold start notification taps are handled by userNotificationCenter:didReceive
        // We don't need to check launchOptions here as that delegate method handles all cases

        return true
    }

    // Called when notification is tapped (app in background or closed)
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let userInfo = response.notification.request.content.userInfo

        print("[AppDelegate] Notification tapped! userInfo keys: \(userInfo.keys)")
        print("[AppDelegate] Full userInfo: \(userInfo)")

        // Get conversation_id from payload - check multiple possible locations
        var conversationId: String? = nil

        // Direct key
        if let convoId = userInfo["conversation_id"] {
            conversationId = "\(convoId)"
            print("[AppDelegate] Found conversation_id at root: \(conversationId!)")
        }
        // Inside "aps" dictionary
        else if let aps = userInfo["aps"] as? [String: Any], let convoId = aps["conversation_id"] {
            conversationId = "\(convoId)"
            print("[AppDelegate] Found conversation_id in aps: \(conversationId!)")
        }
        // Inside custom data dictionary
        else if let data = userInfo["data"] as? [String: Any], let convoId = data["conversation_id"] {
            conversationId = "\(convoId)"
            print("[AppDelegate] Found conversation_id in data: \(conversationId!)")
        }
        else {
            print("[AppDelegate] No conversation_id found in payload")
        }

        if let convoIdStr = conversationId {
            pendingConversationId = convoIdStr
            // Try multiple times with increasing delays
            navigateToConversation(convoIdStr, attempt: 1)
        }

        completionHandler()
    }

    private func navigateToConversation(_ conversationId: String, attempt: Int) {
        print("[AppDelegate] navigateToConversation called - conversationId: \(conversationId), attempt: \(attempt)")

        // Clear immediately on first attempt to prevent re-triggering
        if attempt == 1 {
            self.pendingConversationId = nil
        }

        let delay = Double(attempt) * 0.5 // 0.5s, 1s, 1.5s, 2s

        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            guard let rootVC = self.window?.rootViewController as? CAPBridgeViewController,
                  let webView = rootVC.bridge?.webView else {
                print("[AppDelegate] WebView not ready, attempt \(attempt)")
                // Retry if webview not ready (up to 4 attempts)
                if attempt < 4 {
                    self.navigateToConversation(conversationId, attempt: attempt + 1)
                } else {
                    print("[AppDelegate] Gave up after 4 attempts")
                }
                return
            }

            print("[AppDelegate] WebView ready, injecting JS for conversation \(conversationId)")

            let js = """
                (function() {
                    var log = function(msg) {
                        console.log('[Native] ' + msg);
                        // Always persist to localStorage for cold start debugging
                        var ts = new Date().toLocaleTimeString();
                        var logs = [];
                        try { logs = JSON.parse(localStorage.getItem('debugLogs') || '[]'); } catch(e) {}
                        logs.push('[' + ts + '] [Native] ' + msg);
                        if (logs.length > 20) logs = logs.slice(-20);
                        localStorage.setItem('debugLogs', JSON.stringify(logs));
                        // Also call live addDebugLog if available
                        if (window.ListItApp && window.ListItApp.AppNav && window.ListItApp.AppNav.addDebugLog) {
                            window.ListItApp.AppNav.addDebugLog('[Native] ' + msg);
                        }
                    };
                    log('Setting pendingConversationId: \(conversationId)');
                    localStorage.setItem('pendingConversationId', '\(conversationId)');
                    if (window.ListItApp && window.ListItApp.AppNav && window.ListItApp.AppNav.openConversation) {
                        log('Calling openConversation(\(conversationId))');
                        window.ListItApp.AppNav.openConversation(\(conversationId));
                        return 'navigated';
                    }
                    log('openConversation not available yet');
                    return 'not_ready';
                })();
            """

            webView.evaluateJavaScript(js) { result, error in
                if let error = error {
                    print("[AppDelegate] JS error: \(error)")
                }
                if let result = result {
                    print("[AppDelegate] JS result: \(result)")
                }
                if let result = result as? String, result == "not_ready", attempt < 4 {
                    // App not ready yet, retry
                    self.navigateToConversation(conversationId, attempt: attempt + 1)
                }
            }
        }
    }

    // Called when notification arrives while app is in foreground
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        // Show the notification even when app is in foreground
        completionHandler([.banner, .sound, .badge])
    }

    // MARK: - Push Notifications

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    func applicationWillResignActive(_ application: UIApplication) {
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Notification navigation is handled by userNotificationCenter:didReceive
        // No need to check pendingConversationId here
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
