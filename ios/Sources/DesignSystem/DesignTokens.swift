import SwiftUI
import UIKit

public struct ColorPalette: Equatable {
    public var primary: Color
    public var secondary: Color
    public var accent: Color
    public var background: Color
    public var surface: Color
    public var success: Color
    public var warning: Color
    public var danger: Color

    public init(primary: Color,
                secondary: Color,
                accent: Color,
                background: Color,
                surface: Color,
                success: Color,
                warning: Color,
                danger: Color) {
        self.primary = primary
        self.secondary = secondary
        self.accent = accent
        self.background = background
        self.surface = surface
        self.success = success
        self.warning = warning
        self.danger = danger
    }
}

public extension ColorPalette {
    static func listItDefault() -> ColorPalette {
        ColorPalette(
            primary: Color(hex: "#2956FF"),
            secondary: Color(hex: "#1B2A52"),
            accent: Color(hex: "#FF7A45"),
            background: Color(hex: "#F5F6FA"),
            surface: Color(hex: "#FFFFFF"),
            success: Color(hex: "#1BB55C"),
            warning: Color(hex: "#FFB020"),
            danger: Color(hex: "#FF4F52")
        )
    }
}

public struct TypographyScale: Equatable {
    public var largeTitle: Font
    public var title: Font
    public var headline: Font
    public var body: Font
    public var callout: Font
    public var subheadline: Font
    public var footnote: Font

    public init(largeTitle: Font,
                title: Font,
                headline: Font,
                body: Font,
                callout: Font,
                subheadline: Font,
                footnote: Font) {
        self.largeTitle = largeTitle
        self.title = title
        self.headline = headline
        self.body = body
        self.callout = callout
        self.subheadline = subheadline
        self.footnote = footnote
    }
}

public extension TypographyScale {
    static func preferred() -> TypographyScale {
        TypographyScale(
            largeTitle: .system(.largeTitle, design: .rounded).weight(.bold),
            title: .system(.title, design: .rounded).weight(.semibold),
            headline: .system(.headline, design: .rounded).weight(.semibold),
            body: .system(.body, design: .default),
            callout: .system(.callout, design: .default),
            subheadline: .system(.subheadline, design: .default).weight(.medium),
            footnote: .system(.footnote, design: .monospaced)
        )
    }
}

public struct SpacingScale: Equatable {
    public var xSmall: CGFloat
    public var small: CGFloat
    public var medium: CGFloat
    public var large: CGFloat
    public var xLarge: CGFloat

    public init(xSmall: CGFloat, small: CGFloat, medium: CGFloat, large: CGFloat, xLarge: CGFloat) {
        self.xSmall = xSmall
        self.small = small
        self.medium = medium
        self.large = large
        self.xLarge = xLarge
    }
}

public extension SpacingScale {
    static func comfortable() -> SpacingScale {
        SpacingScale(xSmall: 4, small: 8, medium: 16, large: 24, xLarge: 32)
    }
}

public struct CornerRadiusScale: Equatable {
    public var small: CGFloat
    public var medium: CGFloat
    public var large: CGFloat

    public init(small: CGFloat, medium: CGFloat, large: CGFloat) {
        self.small = small
        self.medium = medium
        self.large = large
    }
}

public extension CornerRadiusScale {
    static func fluid() -> CornerRadiusScale {
        CornerRadiusScale(small: 8, medium: 16, large: 28)
    }
}

public extension Color {
    init(hex: String) {
        self = Color(UIColor(hex: hex))
    }
}

private extension UIColor {
    convenience init(hex: String) {
        let sanitized = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int = UInt64()
        Scanner(string: sanitized).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch sanitized.count {
        case 3: // RGB (12-bit)
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6: // RGB (24-bit)
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: // ARGB (32-bit)
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 0, 0, 0)
        }
        self.init(red: CGFloat(r) / 255,
                  green: CGFloat(g) / 255,
                  blue: CGFloat(b) / 255,
                  alpha: CGFloat(a) / 255)
    }
}
