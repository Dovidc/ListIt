import SwiftUI
import UIKit
import DesignSystem

enum AppearanceConfigurator {
    static func configure() {
        apply(theme: DesignSystemTheme())
    }

    static func apply(theme: DesignSystemTheme) {
        apply(designSystem: theme.makeDesignSystem())
    }

    static func apply(designSystem: DesignSystem) {
        configureNavigationBar(with: designSystem)
        configureTabBar(with: designSystem)
        configureToolbars(with: designSystem)
    }

    private static func configureNavigationBar(with designSystem: DesignSystem) {
        let appearance = UINavigationBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(designSystem.colors.surface)
        appearance.titleTextAttributes = [
            .font: UIFont.preferredFont(forTextStyle: .headline),
            .foregroundColor: UIColor(designSystem.colors.secondary)
        ]
        appearance.largeTitleTextAttributes = [
            .font: UIFont.preferredFont(forTextStyle: .largeTitle),
            .foregroundColor: UIColor(designSystem.colors.secondary)
        ]
        appearance.shadowColor = UIColor(designSystem.colors.secondary).withAlphaComponent(0.08)
        UINavigationBar.appearance().prefersLargeTitles = designSystem.enablesLargeTitles
        UINavigationBar.appearance().tintColor = UIColor(designSystem.colors.accent)
        UINavigationBar.appearance().standardAppearance = appearance
        UINavigationBar.appearance().scrollEdgeAppearance = appearance
        UINavigationBar.appearance().compactAppearance = appearance
    }

    private static func configureTabBar(with designSystem: DesignSystem) {
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(designSystem.colors.surface)

        let selectedColor = UIColor(designSystem.colors.accent)
        let normalColor = UIColor(designSystem.colors.secondary).withAlphaComponent(0.55)

        [appearance.stackedLayoutAppearance,
         appearance.inlineLayoutAppearance,
         appearance.compactInlineLayoutAppearance].forEach { itemAppearance in
            itemAppearance.selected.iconColor = selectedColor
            itemAppearance.selected.titleTextAttributes = [.foregroundColor: selectedColor]
            itemAppearance.normal.iconColor = normalColor
            itemAppearance.normal.titleTextAttributes = [.foregroundColor: normalColor]
        }

        UITabBar.appearance().tintColor = selectedColor
        UITabBar.appearance().unselectedItemTintColor = normalColor
        UITabBar.appearance().standardAppearance = appearance
        if #available(iOS 15.0, *) {
            UITabBar.appearance().scrollEdgeAppearance = appearance
        }
    }

    private static func configureToolbars(with designSystem: DesignSystem) {
        let appearance = UIToolbarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(designSystem.colors.surface)
        appearance.buttonAppearance.normal.titleTextAttributes = [
            .foregroundColor: UIColor(designSystem.colors.accent)
        ]
        UIToolbar.appearance().tintColor = UIColor(designSystem.colors.accent)
        UIToolbar.appearance().standardAppearance = appearance
        if #available(iOS 15.0, *) {
            UIToolbar.appearance().scrollEdgeAppearance = appearance
        }
    }
}
