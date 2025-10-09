import SwiftUI

public struct ListItBrandHeader<Accessory: View>: View {
    @Environment(\.designSystem) private var system

    private let title: String
    private let subtitle: String
    private let icon: Image?
    private let accessory: Accessory
    private let showsAccessory: Bool

    public init(title: String,
                subtitle: String,
                icon: Image? = nil,
                @ViewBuilder accessory: () -> Accessory) {
        self.title = title
        self.subtitle = subtitle
        self.icon = icon
        self.accessory = accessory()
        self.showsAccessory = true
    }

    public init(title: String,
                subtitle: String,
                icon: Image? = nil) where Accessory == EmptyView {
        self.title = title
        self.subtitle = subtitle
        self.icon = icon
        self.accessory = EmptyView()
        self.showsAccessory = false
    }

    public var body: some View {
        ZStack(alignment: .leading) {
            background

            VStack(alignment: .leading, spacing: system.spacing.medium) {
                headerStack

                Text(subtitle)
                    .font(system.typography.callout)
                    .foregroundStyle(system.colors.onPrimary.opacity(0.85))
                    .multilineTextAlignment(.leading)

                if showsAccessory {
                    Divider()
                        .overlay(system.colors.onPrimary.opacity(0.25))
                        .blendMode(.screen)
                        .padding(.trailing, system.spacing.large)

                    HStack {
                        Spacer(minLength: 0)
                        accessory
                            .font(system.typography.callout)
                            .foregroundStyle(system.colors.onPrimary)
                    }
                }
            }
            .padding(.vertical, system.spacing.large)
            .padding(.horizontal, system.spacing.large)
        }
        .clipShape(RoundedRectangle(cornerRadius: system.corners.large, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: system.corners.large, style: .continuous)
                .strokeBorder(system.colors.onPrimary.opacity(0.12), lineWidth: 1)
        )
        .shadow(color: system.colors.primary.opacity(0.18), radius: 12, x: 0, y: 10)
        .accessibilityElement(children: .combine)
    }

    private var background: some View {
        RoundedRectangle(cornerRadius: system.corners.large, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [
                        system.colors.primary,
                        system.colors.primary.opacity(0.92),
                        system.colors.accent
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(glowOverlay)
    }

    private var glowOverlay: some View {
        ZStack {
            Circle()
                .fill(Color.white.opacity(0.12))
                .frame(width: 180, height: 180)
                .offset(x: 40, y: -90)
                .blur(radius: 60)

            RoundedRectangle(cornerRadius: system.corners.large, style: .continuous)
                .strokeBorder(Color.white.opacity(0.18), lineWidth: 1)
                .blendMode(.screen)
        }
    }

    private var headerStack: some View {
        HStack(alignment: .center, spacing: system.spacing.medium) {
            if let icon {
                icon
                    .symbolRenderingMode(.hierarchical)
                    .font(.system(size: 28, weight: .semibold, design: .rounded))
                    .foregroundStyle(system.colors.onPrimary)
                    .padding(system.spacing.small)
                    .background(
                        RoundedRectangle(cornerRadius: system.corners.medium, style: .continuous)
                            .fill(system.colors.onPrimary.opacity(0.18))
                    )
            }

            Text(title)
                .font(system.typography.largeTitle)
                .foregroundStyle(system.colors.onPrimary)
                .lineLimit(2)
                .minimumScaleFactor(0.9)

            Spacer(minLength: 0)

        }
    }
}

#if DEBUG
struct ListItBrandHeader_Previews: PreviewProvider {
    static var previews: some View {
        DesignSystemProvider(theme: DesignSystemTheme()) {
            VStack(spacing: 24) {
                ListItBrandHeader(title: "ListIt profile",
                                   subtitle: "Keep preferences and automation toggles in sync between the web dashboard and native app.",
                                   icon: Image(systemName: "sparkles"))
                    .padding()

                ListItBrandHeader(title: "Launch a drop",
                                   subtitle: "Spotlight boosted listings and coordinate your next release with buyers nearby.",
                                   icon: Image(systemName: "flame")) {
                    Label("Schedule", systemImage: "calendar")
                        .padding(.vertical, 8)
                        .padding(.horizontal, 16)
                        .background(
                            Capsule()
                                .fill(Color.white.opacity(0.2))
                        )
                        .overlay(
                            Capsule()
                                .stroke(Color.white.opacity(0.35), lineWidth: 1)
                        )
                }
                .padding()
            }
            .background(Color.black.opacity(0.05))
        }
        .previewLayout(.sizeThatFits)
    }
}
#endif
