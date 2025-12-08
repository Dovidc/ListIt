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

        // Set window background to white to prevent black bars in safe areas
        window?.backgroundColor = .white

        // Check if launched from notification (cold start)
        if let notification = launchOptions?[.remoteNotification] as? [AnyHashable: Any] {
            if let convoId = notification["conversation_id"] {
                pendingConversationId = "\(convoId)"
            }
        }

        return true
    }

    // Called when notification is tapped (app in background or closed)
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let userInfo = response.notification.request.content.userInfo

        // Get conversation_id from payload
        if let conversationId = userInfo["conversation_id"] {
            let convoIdStr = "\(conversationId)"
            pendingConversationId = convoIdStr

            // Try multiple times with increasing delays
            navigateToConversation(convoIdStr, attempt: 1)
        }

        completionHandler()
    }

    private func navigateToConversation(_ conversationId: String, attempt: Int) {
        // Clear immediately on first attempt to prevent re-triggering
        if attempt == 1 {
            self.pendingConversationId = nil
        }

        let delay = Double(attempt) * 0.5 // 0.5s, 1s, 1.5s, 2s

        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            guard let rootVC = self.window?.rootViewController as? CAPBridgeViewController,
                  let webView = rootVC.bridge?.webView else {
                // Retry if webview not ready (up to 4 attempts)
                if attempt < 4 {
                    self.navigateToConversation(conversationId, attempt: attempt + 1)
                }
                return
            }

            let js = """
                (function() {
                    localStorage.setItem('pendingConversationId', '\(conversationId)');
                    if (window.ListItApp && window.ListItApp.AppNav && window.ListItApp.AppNav.openConversation) {
                        window.ListItApp.AppNav.openConversation(\(conversationId));
                        return 'navigated';
                    }
                    return 'not_ready';
                })();
            """

            webView.evaluateJavaScript(js) { result, error in
                if let result = result as? String, result == "not_ready", attempt < 4 {
                    // App not ready yet, retry
                    self.navigateToConversation(conversationId, attempt: attempt + 1)
                }
                // No need to clear pendingConversationId here - already cleared on first attempt
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
        // Check for pending notification navigation when app becomes active
        if let convoId = pendingConversationId {
            navigateToConversation(convoId, attempt: 1)
        }
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
