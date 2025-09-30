import SwiftUI

public struct DesignSystem: Equatable {
    public var colors: ColorPalette
    public var typography: TypographyScale
    public var spacing: SpacingScale
    public var corners: CornerRadiusScale
    public var enablesLargeTitles: Bool
    public var supportsSwipeActions: Bool

    public init(colors: ColorPalette,
                typography: TypographyScale,
                spacing: SpacingScale,
                corners: CornerRadiusScale,
                enablesLargeTitles: Bool,
                supportsSwipeActions: Bool) {
        self.colors = colors
        self.typography = typography
        self.spacing = spacing
        self.corners = corners
        self.enablesLargeTitles = enablesLargeTitles
        self.supportsSwipeActions = supportsSwipeActions
    }
}

public struct DesignSystemTheme: Equatable {
    public var palette: ColorPalette
    public var typography: TypographyScale
    public var spacing: SpacingScale
    public var corners: CornerRadiusScale
    public var enablesLargeTitles: Bool
    public var supportsSwipeActions: Bool

    public init(palette: ColorPalette = .listItDefault(),
                typography: TypographyScale = .preferred(),
                spacing: SpacingScale = .comfortable(),
                corners: CornerRadiusScale = .fluid(),
                enablesLargeTitles: Bool = true,
                supportsSwipeActions: Bool = true) {
        self.palette = palette
        self.typography = typography
        self.spacing = spacing
        self.corners = corners
        self.enablesLargeTitles = enablesLargeTitles
        self.supportsSwipeActions = supportsSwipeActions
    }
}

public extension DesignSystemTheme {
    static func fromEnvironment(_ environment: [String: String]) -> DesignSystemTheme {
        var theme = DesignSystemTheme()

        if let hex = environment["LISTIT_IOS_THEME_PRIMARY"] { theme.palette.primary = Color(hex: hex) }
        if let hex = environment["LISTIT_IOS_THEME_SECONDARY"] { theme.palette.secondary = Color(hex: hex) }
        if let hex = environment["LISTIT_IOS_THEME_ACCENT"] { theme.palette.accent = Color(hex: hex) }
        if let hex = environment["LISTIT_IOS_THEME_BACKGROUND"] { theme.palette.background = Color(hex: hex) }
        if let hex = environment["LISTIT_IOS_THEME_SURFACE"] { theme.palette.surface = Color(hex: hex) }
        if let hex = environment["LISTIT_IOS_THEME_SUCCESS"] { theme.palette.success = Color(hex: hex) }
        if let hex = environment["LISTIT_IOS_THEME_WARNING"] { theme.palette.warning = Color(hex: hex) }
        if let hex = environment["LISTIT_IOS_THEME_DANGER"] { theme.palette.danger = Color(hex: hex) }
        if let hex = environment["LISTIT_IOS_THEME_ON_PRIMARY"] { theme.palette.onPrimary = Color(hex: hex) }
        if let hex = environment["LISTIT_IOS_THEME_ON_SECONDARY"] { theme.palette.onSecondary = Color(hex: hex) }
        if let hex = environment["LISTIT_IOS_THEME_ON_BACKGROUND"] { theme.palette.onBackground = Color(hex: hex) }
        if let hex = environment["LISTIT_IOS_THEME_ON_SURFACE"] { theme.palette.onSurface = Color(hex: hex) }

        if let enablesLargeTitles = environment["LISTIT_IOS_THEME_LARGE_TITLES"]?.boolValue {
            theme.enablesLargeTitles = enablesLargeTitles
        }
        if let supportsSwipeActions = environment["LISTIT_IOS_THEME_SWIPE_ACTIONS"]?.boolValue {
            theme.supportsSwipeActions = supportsSwipeActions
        }

        if let baseSpacing = environment["LISTIT_IOS_THEME_BASE_SPACING"],
           let base = Double(baseSpacing) {
            let cgBase = CGFloat(base)
            theme.spacing = SpacingScale(
                xSmall: cgBase * 0.5,
                small: cgBase,
                medium: cgBase * 1.5,
                large: cgBase * 2,
                xLarge: cgBase * 2.5
            )
        }
        theme.spacing = theme.spacing.applyingEnvironmentOverrides(environment)

        if let corner = environment["LISTIT_IOS_THEME_CORNER_RADIUS"],
           let base = Double(corner) {
            let cg = CGFloat(base)
            theme.corners = CornerRadiusScale(small: cg * 0.5, medium: cg, large: cg * 1.5)
        }
        theme.corners = theme.corners.applyingEnvironmentOverrides(environment)

        theme.typography = TypographyScale.fromEnvironment(environment)

        return theme
    }

    func makeDesignSystem() -> DesignSystem {
        DesignSystem(
            colors: palette,
            typography: typography,
            spacing: spacing,
            corners: corners,
            enablesLargeTitles: enablesLargeTitles,
            supportsSwipeActions: supportsSwipeActions
        )
    }
}

private struct DesignSystemEnvironmentKey: EnvironmentKey {
    static let defaultValue = DesignSystemTheme().makeDesignSystem()
}

public extension EnvironmentValues {
    var designSystem: DesignSystem {
        get { self[DesignSystemEnvironmentKey.self] }
        set { self[DesignSystemEnvironmentKey.self] = newValue }
    }
}

public struct DesignSystemProvider<Content: View>: View {
    private let system: DesignSystem
    private let content: Content

    public init(theme: DesignSystemTheme, @ViewBuilder content: () -> Content) {
        self.system = theme.makeDesignSystem()
        self.content = content()
    }

    public var body: some View {
        content
            .environment(\.designSystem, system)
            .tint(system.colors.accent)
            .preferredColorScheme(nil)
    }
}

private extension String {
    var boolValue: Bool? {
        switch lowercased() {
        case "true", "1", "yes", "y": return true
        case "false", "0", "no", "n": return false
        default: return nil
        }
    }
}
