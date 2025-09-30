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

public struct TypographyFont: Equatable {
    public var swiftUI: Font
    public var uiKit: UIFont

    public init(swiftUI: Font, uiKit: UIFont) {
        self.swiftUI = swiftUI
        self.uiKit = uiKit
    }

    public static func == (lhs: TypographyFont, rhs: TypographyFont) -> Bool {
        lhs.swiftUI == rhs.swiftUI &&
            lhs.uiKit.fontName == rhs.uiKit.fontName &&
            abs(lhs.uiKit.pointSize - rhs.uiKit.pointSize) < CGFloat.ulpOfOne &&
            lhs.uiKit.fontDescriptor.symbolicTraits == rhs.uiKit.fontDescriptor.symbolicTraits
    }
}

public struct TypographyScale: Equatable {
    public var largeTitleFont: TypographyFont
    public var titleFont: TypographyFont
    public var headlineFont: TypographyFont
    public var bodyFont: TypographyFont
    public var calloutFont: TypographyFont
    public var subheadlineFont: TypographyFont
    public var footnoteFont: TypographyFont

    public init(largeTitle: TypographyFont,
                title: TypographyFont,
                headline: TypographyFont,
                body: TypographyFont,
                callout: TypographyFont,
                subheadline: TypographyFont,
                footnote: TypographyFont) {
        self.largeTitleFont = largeTitle
        self.titleFont = title
        self.headlineFont = headline
        self.bodyFont = body
        self.calloutFont = callout
        self.subheadlineFont = subheadline
        self.footnoteFont = footnote
    }

    public var largeTitle: Font { largeTitleFont.swiftUI }
    public var title: Font { titleFont.swiftUI }
    public var headline: Font { headlineFont.swiftUI }
    public var body: Font { bodyFont.swiftUI }
    public var callout: Font { calloutFont.swiftUI }
    public var subheadline: Font { subheadlineFont.swiftUI }
    public var footnote: Font { footnoteFont.swiftUI }

    public var largeTitleUIFont: UIFont { largeTitleFont.uiKit }
    public var titleUIFont: UIFont { titleFont.uiKit }
    public var headlineUIFont: UIFont { headlineFont.uiKit }
    public var bodyUIFont: UIFont { bodyFont.uiKit }
    public var calloutUIFont: UIFont { calloutFont.uiKit }
    public var subheadlineUIFont: UIFont { subheadlineFont.uiKit }
    public var footnoteUIFont: UIFont { footnoteFont.uiKit }
}

public extension TypographyScale {
    static func preferred() -> TypographyScale {
        TypographyPreset.rounded.makeScale()
    }

    static func fromEnvironment(_ environment: [String: String]) -> TypographyScale {
        TypographyEnvironmentResolver(environment: environment).resolve()
    }

    static func preset(_ preset: TypographyPreset) -> TypographyScale {
        preset.makeScale()
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

    func applyingEnvironmentOverrides(_ environment: [String: String]) -> SpacingScale {
        var updated = self

        if let value = environment["LISTIT_IOS_THEME_SPACING_XSMALL"],
           let amount = Double(value) {
            updated.xSmall = CGFloat(amount)
        }
        if let value = environment["LISTIT_IOS_THEME_SPACING_SMALL"],
           let amount = Double(value) {
            updated.small = CGFloat(amount)
        }
        if let value = environment["LISTIT_IOS_THEME_SPACING_MEDIUM"],
           let amount = Double(value) {
            updated.medium = CGFloat(amount)
        }
        if let value = environment["LISTIT_IOS_THEME_SPACING_LARGE"],
           let amount = Double(value) {
            updated.large = CGFloat(amount)
        }
        if let value = environment["LISTIT_IOS_THEME_SPACING_XLARGE"],
           let amount = Double(value) {
            updated.xLarge = CGFloat(amount)
        }

        return updated
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

    func applyingEnvironmentOverrides(_ environment: [String: String]) -> CornerRadiusScale {
        var updated = self

        if let value = environment["LISTIT_IOS_THEME_CORNER_RADIUS_SMALL"],
           let amount = Double(value) {
            updated.small = CGFloat(amount)
        }
        if let value = environment["LISTIT_IOS_THEME_CORNER_RADIUS_MEDIUM"],
           let amount = Double(value) {
            updated.medium = CGFloat(amount)
        }
        if let value = environment["LISTIT_IOS_THEME_CORNER_RADIUS_LARGE"],
           let amount = Double(value) {
            updated.large = CGFloat(amount)
        }

        return updated
    }
}

public enum TypographyPreset: String, CaseIterable {
    case rounded
    case system
    case serif
    case monospaced
    case editorial

    public static var `default`: TypographyPreset { .rounded }

    init?(environmentValue: String) {
        switch environmentValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "rounded", "native": self = .rounded
        case "system", "default": self = .system
        case "serif", "editorial-serif": self = .serif
        case "mono", "monospaced", "code": self = .monospaced
        case "editorial", "magazine": self = .editorial
        default: return nil
        }
    }

    var displayName: String {
        switch self {
        case .rounded: return "Rounded"
        case .system: return "System"
        case .serif: return "Serif"
        case .monospaced: return "Monospaced"
        case .editorial: return "Editorial"
        }
    }

    fileprivate func baseOverride(for style: TypographyStyle) -> TypographyOverrideDescriptor? {
        switch self {
        case .rounded:
            switch style {
            case .largeTitle: return TypographyOverrideDescriptor(design: .rounded, weight: .bold)
            case .title: return TypographyOverrideDescriptor(design: .rounded, weight: .semibold)
            case .headline: return TypographyOverrideDescriptor(design: .rounded, weight: .semibold)
            case .body: return TypographyOverrideDescriptor()
            case .callout: return TypographyOverrideDescriptor()
            case .subheadline: return TypographyOverrideDescriptor(weight: .medium)
            case .footnote: return TypographyOverrideDescriptor(design: .monospaced)
            }
        case .system:
            switch style {
            case .largeTitle: return TypographyOverrideDescriptor(weight: .bold)
            case .title: return TypographyOverrideDescriptor(weight: .semibold)
            case .headline: return TypographyOverrideDescriptor(weight: .semibold)
            case .body, .callout: return TypographyOverrideDescriptor()
            case .subheadline: return TypographyOverrideDescriptor(weight: .medium)
            case .footnote: return TypographyOverrideDescriptor()
            }
        case .serif:
            switch style {
            case .largeTitle: return TypographyOverrideDescriptor(design: .serif, weight: .black)
            case .title: return TypographyOverrideDescriptor(design: .serif, weight: .bold)
            case .headline: return TypographyOverrideDescriptor(design: .serif, weight: .semibold)
            case .body, .callout: return TypographyOverrideDescriptor(design: .serif)
            case .subheadline: return TypographyOverrideDescriptor(design: .serif, weight: .medium)
            case .footnote: return TypographyOverrideDescriptor(design: .serif, weight: .medium)
            }
        case .monospaced:
            switch style {
            case .largeTitle: return TypographyOverrideDescriptor(design: .monospaced, weight: .bold)
            case .title: return TypographyOverrideDescriptor(design: .monospaced, weight: .semibold)
            case .headline: return TypographyOverrideDescriptor(design: .monospaced, weight: .semibold)
            case .body, .callout: return TypographyOverrideDescriptor(design: .monospaced)
            case .subheadline: return TypographyOverrideDescriptor(design: .monospaced, weight: .medium)
            case .footnote: return TypographyOverrideDescriptor(design: .monospaced)
            }
        case .editorial:
            switch style {
            case .largeTitle: return TypographyOverrideDescriptor(design: .serif, weight: .heavy)
            case .title: return TypographyOverrideDescriptor(design: .serif, weight: .bold, scale: 1.04)
            case .headline: return TypographyOverrideDescriptor(design: .serif, weight: .semibold)
            case .body, .callout: return TypographyOverrideDescriptor(design: .serif)
            case .subheadline: return TypographyOverrideDescriptor(design: .serif, weight: .medium)
            case .footnote: return TypographyOverrideDescriptor(design: .serif, weight: .regular, scale: 0.96)
            }
        }
    }

    fileprivate var globalOverride: TypographyOverrideDescriptor? {
        switch self {
        case .editorial:
            return TypographyOverrideDescriptor(scale: 1.02)
        default:
            return nil
        }
    }

    func makeScale(overrides environment: [String: String] = [:]) -> TypographyScale {
        TypographyEnvironmentResolver(environment: environment, preset: self).resolve()
    }
}

private enum TypographyCategory {
    case display
    case content
    case meta
}

private enum TypographyStyle: CaseIterable {
    case largeTitle
    case title
    case headline
    case body
    case callout
    case subheadline
    case footnote

    var environmentKey: String {
        switch self {
        case .largeTitle: return "LISTIT_IOS_THEME_FONT_LARGE_TITLE"
        case .title: return "LISTIT_IOS_THEME_FONT_TITLE"
        case .headline: return "LISTIT_IOS_THEME_FONT_HEADLINE"
        case .body: return "LISTIT_IOS_THEME_FONT_BODY"
        case .callout: return "LISTIT_IOS_THEME_FONT_CALLOUT"
        case .subheadline: return "LISTIT_IOS_THEME_FONT_SUBHEADLINE"
        case .footnote: return "LISTIT_IOS_THEME_FONT_FOOTNOTE"
        }
    }

    var textStyle: UIFont.TextStyle {
        switch self {
        case .largeTitle: return .largeTitle
        case .title: return .title1
        case .headline: return .headline
        case .body: return .body
        case .callout: return .callout
        case .subheadline: return .subheadline
        case .footnote: return .footnote
        }
    }

    var category: TypographyCategory {
        switch self {
        case .largeTitle, .title: return .display
        case .headline, .body, .callout: return .content
        case .subheadline, .footnote: return .meta
        }
    }
}

private struct TypographyOverrideDescriptor {
    var family: String?
    var design: UIFontDescriptor.SystemDesign?
    var weight: UIFont.Weight?
    var scale: CGFloat?

    init(family: String? = nil,
         design: UIFontDescriptor.SystemDesign? = nil,
         weight: UIFont.Weight? = nil,
         scale: CGFloat? = nil) {
        self.family = family
        self.design = design
        self.weight = weight
        self.scale = scale
    }

    init?(rawValue: String) {
        self.init()

        let components = rawValue.split(whereSeparator: { $0 == "," || $0 == ";" })

        for component in components {
            let pair = component.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: true)
            guard pair.count == 2 else { continue }
            let key = pair[0].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let value = pair[1].trimmingCharacters(in: .whitespacesAndNewlines)

            switch key {
            case "family", "font":
                if !value.isEmpty { family = value }
            case "design":
                design = UIFontDescriptor.SystemDesign(token: value)
            case "weight":
                weight = UIFont.Weight(token: value)
            case "scale":
                if let amount = Double(value) { scale = CGFloat(amount) }
            default:
                continue
            }
        }

        if isEmpty { return nil }
    }

    var isEmpty: Bool {
        family == nil && design == nil && weight == nil && scale == nil
    }

    func apply(to descriptor: UIFontDescriptor, textStyle: UIFont.TextStyle) -> UIFontDescriptor {
        var updated = descriptor

        if let family {
            updated = updated.withFamily(family)
        }
        if let design, let designed = updated.withDesign(design) {
            updated = designed
        }
        if let weight {
            updated = updated.applying(weight: weight)
        }
        if let scale {
            let baseDescriptor = UIFontDescriptor.preferredFontDescriptor(withTextStyle: textStyle)
            let baseSize = updated.pointSize > 0 ? updated.pointSize : baseDescriptor.pointSize
            updated = updated.withSize(baseSize * scale)
        }

        return updated
    }
}

private struct TypographyEnvironmentResolver {
    let environment: [String: String]
    let preset: TypographyPreset

    init(environment: [String: String], preset: TypographyPreset? = nil) {
        self.environment = environment
        if let preset {
            self.preset = preset
        } else if let value = environment["LISTIT_IOS_THEME_TYPOGRAPHY_PRESET"],
                  let resolved = TypographyPreset(environmentValue: value) {
            self.preset = resolved
        } else {
            self.preset = TypographyPreset.default
        }
    }

    func resolve() -> TypographyScale {
        let globalOverride = environment["LISTIT_IOS_THEME_FONT_GLOBAL"].flatMap(TypographyOverrideDescriptor.init(rawValue:))
        let displayOverride = environment["LISTIT_IOS_THEME_FONT_DISPLAY"].flatMap(TypographyOverrideDescriptor.init(rawValue:))
        let contentOverride = environment["LISTIT_IOS_THEME_FONT_CONTENT"].flatMap(TypographyOverrideDescriptor.init(rawValue:))
        let metaOverride = environment["LISTIT_IOS_THEME_FONT_META"].flatMap(TypographyOverrideDescriptor.init(rawValue:))

        var specific: [TypographyStyle: TypographyOverrideDescriptor] = [:]
        for style in TypographyStyle.allCases {
            if let raw = environment[style.environmentKey], let descriptor = TypographyOverrideDescriptor(rawValue: raw) {
                specific[style] = descriptor
            }
        }

        func categoryOverride(for style: TypographyStyle) -> TypographyOverrideDescriptor? {
            switch style.category {
            case .display: return displayOverride
            case .content: return contentOverride
            case .meta: return metaOverride
            }
        }

        var fonts: [TypographyStyle: TypographyFont] = [:]

        for style in TypographyStyle.allCases {
            var descriptor = UIFontDescriptor.preferredFontDescriptor(withTextStyle: style.textStyle)

            if let base = preset.baseOverride(for: style) {
                descriptor = base.apply(to: descriptor, textStyle: style.textStyle)
            }

            if let presetGlobal = preset.globalOverride {
                descriptor = presetGlobal.apply(to: descriptor, textStyle: style.textStyle)
            }

            if let globalOverride {
                descriptor = globalOverride.apply(to: descriptor, textStyle: style.textStyle)
            }

            if let category = categoryOverride(for: style) {
                descriptor = category.apply(to: descriptor, textStyle: style.textStyle)
            }

            if let styleOverride = specific[style] {
                descriptor = styleOverride.apply(to: descriptor, textStyle: style.textStyle)
            }

            let uiFont = UIFont(descriptor: descriptor, size: 0)
            let swiftUIFont = Font.custom(uiFont.fontName,
                                          size: uiFont.pointSize,
                                          relativeTo: style.textStyle.swiftUITextStyle)
            fonts[style] = TypographyFont(swiftUI: swiftUIFont, uiKit: uiFont)
        }

        return TypographyScale(
            largeTitle: fonts[.largeTitle]!,
            title: fonts[.title]!,
            headline: fonts[.headline]!,
            body: fonts[.body]!,
            callout: fonts[.callout]!,
            subheadline: fonts[.subheadline]!,
            footnote: fonts[.footnote]!
        )
    }
}

private extension UIFontDescriptor {
    func applying(weight: UIFont.Weight) -> UIFontDescriptor {
        var traits = fontAttributes[.traits] as? [UIFontDescriptor.TraitKey: Any] ?? [:]
        traits[.weight] = weight
        return addingAttributes([.traits: traits])
    }
}

private extension UIFontDescriptor.SystemDesign {
    init?(token: String) {
        switch token.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "rounded": self = .rounded
        case "serif": self = .serif
        case "monospaced", "mono", "code": self = .monospaced
        case "default", "system": self = .default
        default: return nil
        }
    }
}

private extension UIFont.Weight {
    init?(token: String) {
        switch token.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "ultralight": self = .ultraLight
        case "thin": self = .thin
        case "light": self = .light
        case "regular", "normal": self = .regular
        case "medium": self = .medium
        case "semibold", "semi-bold": self = .semibold
        case "bold": self = .bold
        case "heavy": self = .heavy
        case "black": self = .black
        default: return nil
        }
    }
}

private extension UIFont.TextStyle {
    var swiftUITextStyle: Font.TextStyle {
        switch self {
        case .largeTitle: return .largeTitle
        case .title1: return .title
        case .title2: return .title2
        case .title3: return .title3
        case .headline: return .headline
        case .body: return .body
        case .callout: return .callout
        case .subheadline: return .subheadline
        case .footnote: return .footnote
        case .caption1: return .caption
        case .caption2: return .caption2
        default: return .body
        }
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
