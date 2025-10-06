import SwiftUI

public struct ListItPillFilter: View {
    @Environment(\.designSystem) private var system

    private let title: String
    private let subtitle: String?
    private let badgeText: String?
    private let icon: Image?
    private let isSelected: Bool
    private let action: () -> Void

    public init(title: String,
                subtitle: String? = nil,
                icon: Image? = nil,
                badge: String? = nil,
                isSelected: Bool,
                action: @escaping () -> Void) {
        self.title = title
        self.subtitle = subtitle
        self.icon = icon
        self.badgeText = badge
        self.isSelected = isSelected
        self.action = action
    }

    public init(title: String,
                subtitle: String? = nil,
                systemImageName: String,
                badge: String? = nil,
                isSelected: Bool,
                action: @escaping () -> Void) {
        self.init(title: title,
                  subtitle: subtitle,
                  icon: Image(systemName: systemImageName),
                  badge: badge,
                  isSelected: isSelected,
                  action: action)
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: system.spacing.small) {
                if let icon {
                    icon
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .imageScale(.medium)
                        .foregroundStyle(contentColor)
                        .padding(.trailing, subtitle == nil ? 0 : 2)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(system.typography.callout)
                        .foregroundStyle(contentColor)
                        .lineLimit(1)

                    if let subtitle {
                        Text(subtitle)
                            .font(system.typography.caption)
                            .foregroundStyle(contentColor.opacity(0.85))
                            .lineLimit(1)
                    }
                }

                if let badgeText {
                    Spacer(minLength: system.spacing.small)

                    Text(badgeText)
                        .font(system.typography.caption)
                        .padding(.vertical, system.spacing.xSmall * 0.75)
                        .padding(.horizontal, system.spacing.small)
                        .background(badgeBackground)
                        .foregroundStyle(badgeForeground)
                        .clipShape(Capsule())
                }
            }
            .padding(.vertical, system.spacing.xSmall)
            .padding(.horizontal, system.spacing.medium)
            .background(background)
            .overlay(border)
            .clipShape(Capsule())
            .shadow(color: shadowColor, radius: isSelected ? 8 : 0, x: 0, y: isSelected ? 4 : 0)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var background: some View {
        Capsule()
            .fill(
                LinearGradient(
                    colors: isSelected
                        ? [system.colors.primary, system.colors.primary.opacity(0.9), system.colors.accent]
                        : [system.colors.surface.opacity(0.96), system.colors.surface.opacity(0.9)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
    }

    private var border: some View {
        Capsule()
            .stroke(isSelected ? system.colors.onPrimary.opacity(0.35) : system.colors.onSurface.opacity(0.12), lineWidth: 1)
    }

    private var contentColor: Color {
        isSelected ? system.colors.onPrimary : system.colors.onSurface
    }

    private var badgeBackground: some ShapeStyle {
        isSelected
            ? AnyShapeStyle(Color.white.opacity(0.18))
            : AnyShapeStyle(system.colors.primary.opacity(0.12))
    }

    private var badgeForeground: Color {
        isSelected ? system.colors.onPrimary : system.colors.primary
    }

    private var shadowColor: Color {
        isSelected ? system.colors.primary.opacity(0.18) : Color.clear
    }

    private var accessibilityLabel: Text {
        if let subtitle {
            return Text("\(title), \(subtitle)")
        }
        return Text(title)
    }
}

#if DEBUG
struct ListItPillFilter_Previews: PreviewProvider {
    static var previews: some View {
        DesignSystemProvider(theme: DesignSystemTheme()) {
            VStack(spacing: 16) {
                ListItPillFilter(title: "Trending",
                                 subtitle: "Popular now",
                                 systemImageName: "sparkles",
                                 isSelected: true) {}

                ListItPillFilter(title: "Favorites",
                                 systemImageName: "heart.fill",
                                 badge: "12",
                                 isSelected: false) {}
            }
            .padding()
            .background(Color(white: 0.95))
        }
        .previewLayout(.sizeThatFits)
    }
}
#endif
