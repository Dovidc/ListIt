import SwiftUI

public struct ListItPillFilter<Label: View>: View {
    @Environment(\.designSystem) private var system
    @Environment(\.isEnabled) private var isEnabled

    private let isSelected: Bool
    private let badgeCount: Int?
    private let icon: Image?
    private let action: () -> Void
    private let label: Label

    public init(isSelected: Bool,
                badgeCount: Int? = nil,
                icon: Image? = nil,
                action: @escaping () -> Void,
                @ViewBuilder label: () -> Label) {
        self.isSelected = isSelected
        self.badgeCount = badgeCount
        self.icon = icon
        self.action = action
        self.label = label()
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: system.spacing.xSmall) {
                if let icon {
                    icon
                        .resizable()
                        .scaledToFit()
                        .frame(width: 16, height: 16)
                        .foregroundStyle(foregroundColor)
                }

                label
                    .font(system.typography.callout)
                    .foregroundStyle(foregroundColor)
                    .lineLimit(1)

                if let badgeText = badgeText {
                    Text(badgeText)
                        .font(system.typography.caption)
                        .fontWeight(.semibold)
                        .padding(.horizontal, system.spacing.xSmall)
                        .padding(.vertical, 4)
                        .background(badgeBackground)
                        .foregroundStyle(badgeForeground)
                        .clipShape(Capsule())
                        .accessibilityHidden(true)
                }
            }
            .padding(.horizontal, system.spacing.medium)
            .padding(.vertical, system.spacing.small * 0.75)
            .frame(minHeight: 36)
            .frame(minWidth: 44)
            .background(backgroundColor)
            .overlay(
                Capsule()
                    .strokeBorder(borderColor, lineWidth: 1)
            )
            .clipShape(Capsule())
            .contentShape(Capsule())
            .overlay(selectionHighlight)
            .animation(.easeInOut(duration: 0.2), value: isSelected)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }

    private var foregroundColor: Color {
        guard isEnabled else { return system.colors.onSurface.opacity(0.35) }
        return isSelected ? system.colors.primary : system.colors.onSurface.opacity(0.8)
    }

    private var borderColor: Color {
        guard isEnabled else { return system.colors.onSurface.opacity(0.12) }
        return isSelected ? system.colors.primary.opacity(0.8) : system.colors.onSurface.opacity(0.15)
    }

    private var backgroundColor: Color {
        guard isEnabled else { return system.colors.surface.opacity(0.8) }
        return isSelected ? system.colors.primary.opacity(0.12) : system.colors.surface
    }

    private var badgeBackground: Color {
        isSelected ? system.colors.primary : system.colors.onSurface.opacity(0.1)
    }

    private var badgeForeground: Color {
        isSelected ? system.colors.onPrimary : system.colors.onSurface.opacity(0.7)
    }

    private var badgeText: String? {
        guard let badgeCount, badgeCount > 0 else { return nil }
        return badgeCount > 99 ? "99+" : "\(badgeCount)"
    }

    private var selectionHighlight: some View {
        Capsule()
            .strokeBorder(selectionGlowColor, lineWidth: isSelected ? 4 : 0)
            .opacity(isSelected ? 0.45 : 0)
            .animation(.easeInOut(duration: 0.2), value: isSelected)
    }

    private var selectionGlowColor: Color {
        system.colors.primary.opacity(0.35)
    }
}

#if DEBUG
struct ListItPillFilter_Previews: PreviewProvider {
    static var previews: some View {
        DesignSystemProvider(theme: .init()) {
            VStack(spacing: 16) {
                ListItPillFilter(isSelected: true, badgeCount: 12, icon: Image(systemName: "sparkles")) {
                    Text("Boosted")
                }
                ListItPillFilter(isSelected: false, badgeCount: 3) {} label: {
                    Text("Nearby")
                }
                ListItPillFilter(isSelected: false, badgeCount: nil, icon: Image(systemName: "star")) {} label: {
                    Text("Saved")
                }
                ListItPillFilter(isSelected: false) {} label: {
                    Text("With really long label text")
                }
                .disabled(true)
            }
            .padding()
            .background(Color(.systemGroupedBackground))
        }
        .previewLayout(.sizeThatFits)
    }
}
#endif
