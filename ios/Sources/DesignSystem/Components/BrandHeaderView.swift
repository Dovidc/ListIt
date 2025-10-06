import SwiftUI

/// A reusable branded header that mirrors the Creegslist web shell.
///
/// The view renders the brand badge, title, and tagline using the active
/// `DesignSystem` tokens so the native experience inherits the same palette and
/// typography as the web client. An optional accessory view can be supplied for
/// trailing controls (e.g., settings buttons or profile avatars).
public struct BrandHeaderView: View {
    @Environment(\.designSystem) private var system

    private let title: String
    private let tagline: String
    private let initials: String
    private let accessory: AnyView?

    public init(title: String = "Creegslist",
                tagline: String = "Sell on the spot",
                initials: String = "CL") {
        self.title = title
        self.tagline = tagline
        self.initials = initials
        self.accessory = nil
    }

    public init<Accessory: View>(title: String = "Creegslist",
                                 tagline: String = "Sell on the spot",
                                 initials: String = "CL",
                                 @ViewBuilder accessory: () -> Accessory) {
        self.title = title
        self.tagline = tagline
        self.initials = initials
        let view = accessory()
        self.accessory = AnyView(view)
    }

    public var body: some View {
        HStack(alignment: .center, spacing: system.spacing.medium) {
            HStack(alignment: .center, spacing: system.spacing.small) {
                brandBadge
                VStack(alignment: .leading, spacing: system.spacing.xSmall) {
                    Text(title)
                        .font(system.typography.headline)
                        .foregroundStyle(system.colors.onBackground)
                    Text(tagline)
                        .font(system.typography.subheadline)
                        .foregroundStyle(system.colors.onBackground.opacity(0.7))
                }
            }
            .padding(.vertical, system.spacing.small)

            Spacer(minLength: system.spacing.small)

            if let accessory {
                accessory
                    .font(system.typography.callout)
                    .foregroundStyle(system.colors.onBackground)
            }
        }
        .padding(.horizontal, system.spacing.medium)
        .padding(.vertical, system.spacing.small)
        .background(backgroundDecoration)
        .clipShape(RoundedRectangle(cornerRadius: system.corners.large, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: system.corners.large, style: .continuous)
                .stroke(system.colors.primary.opacity(0.08), lineWidth: 1)
        )
    }

    private var brandBadge: some View {
        let size = max(system.spacing.large + system.spacing.medium,
                       system.spacing.medium * CGFloat(2.25))
        let innerCorner = max(system.corners.medium - 4, 2)
        return ZStack {
            RoundedRectangle(cornerRadius: system.corners.medium, style: .continuous)
                .fill(
                    LinearGradient(colors: [
                        system.colors.primary,
                        system.colors.accent
                    ], startPoint: .topLeading, endPoint: .bottomTrailing)
                )
                .frame(width: size, height: size)
                .overlay(
                    RoundedRectangle(cornerRadius: system.corners.medium, style: .continuous)
                        .stroke(system.colors.surface.opacity(0.35), lineWidth: 2)
                )
                .shadow(color: system.colors.primary.opacity(0.18), radius: 16, x: 0, y: 6)

            RoundedRectangle(cornerRadius: innerCorner, style: .continuous)
                .stroke(system.colors.surface.opacity(0.6), lineWidth: 4)
                .frame(width: size - 8, height: size - 8)

            Text(initials)
                .font(system.typography.title)
                .fontWeight(.heavy)
                .foregroundStyle(system.colors.onPrimary)
        }
        .accessibilityLabel(Text("\(title) logo"))
    }

    private var backgroundDecoration: some View {
        RoundedRectangle(cornerRadius: system.corners.large, style: .continuous)
            .fill(
                LinearGradient(colors: [
                    system.colors.background,
                    system.colors.background.opacity(0.92)
                ], startPoint: .top, endPoint: .bottom)
            )
            .shadow(color: system.colors.onBackground.opacity(0.04), radius: 18, x: 0, y: 8)
    }
}

#if DEBUG
struct BrandHeaderView_Previews: PreviewProvider {
    static var previews: some View {
        DesignSystemProvider(theme: .init()) {
            VStack(spacing: 24) {
                BrandHeaderView()
                BrandHeaderView(accessory: {
                    Button(action: {}) {
                        Label("Settings", systemImage: "gear")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color(hex: "#2956FF"))
                })
                .padding(.trailing)
            }
            .padding()
            .background(Color(hex: "#F5F6FA"))
        }
        .previewLayout(.sizeThatFits)
    }
}
#endif
