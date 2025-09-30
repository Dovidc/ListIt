import SwiftUI
import UIKit

enum AppearanceConfigurator {
    static func configure() {
        configureNavigationBar()
        configureTabBar()
        configureToolbars()
    }

    private static func configureNavigationBar() {
        let appearance = UINavigationBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor.systemBackground
        appearance.titleTextAttributes = [
            .font: UIFont.preferredFont(forTextStyle: .headline),
            .foregroundColor: UIColor.label
        ]
        appearance.largeTitleTextAttributes = [
            .font: UIFont.systemFont(ofSize: 34, weight: .bold)
        ]
        UINavigationBar.appearance().standardAppearance = appearance
        UINavigationBar.appearance().scrollEdgeAppearance = appearance
    }

    private static func configureTabBar() {
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor.secondarySystemBackground
        UITabBar.appearance().standardAppearance = appearance
        if #available(iOS 15.0, *) {
            UITabBar.appearance().scrollEdgeAppearance = appearance
        }
    }

    private static func configureToolbars() {
        let appearance = UIToolbarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor.systemBackground
        UIToolbar.appearance().standardAppearance = appearance
        if #available(iOS 15.0, *) {
            UIToolbar.appearance().scrollEdgeAppearance = appearance
        }
    }
}
