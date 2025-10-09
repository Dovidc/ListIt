import SwiftUI

public struct ListItBrandHeader: View {
    @Environment(\.designSystem) private var system

    private let eyebrow: String?
    private let title: String
    private let subtitle: String?
    private let description: String?
    private let accessory: AnyView?
    private let action: AnyView?

    public init(title: String,
                eyebrow: String? = nil,
                subtitle: String? = nil,
                description: String? = nil,
                @ViewBuilder accessory: () -> some View,
                @ViewBuilder action: () -> some View) {
        self.title = title
        self.eyebrow = eyebrow
        self.subtitle = subtitle
        self.description = description
        self.accessory = ListItBrandHeader.optionalView(from: accessory)
        self.action = ListItBrandHeader.optionalView(from: action)
    }

    public init(title: String,
                eyebrow: String? = nil,
                subtitle: String? = nil,
                description: String? = nil,
                @ViewBuilder accessory: () -> some View) {
        self.init(title: title,
                  eyebrow: eyebrow,
                  subtitle: subtitle,
                  description: description,
                  accessory: accessory,
                  action: { EmptyView() })
    }

    public init(title: String,
                eyebrow: String? = nil,
                subtitle: String? = nil,
                description: String? = nil,
                @ViewBuilder action: () -> some View) {
        self.init(title: title,
                  eyebrow: eyebrow,
                  subtitle: subtitle,
                  description: description,
                  accessory: { EmptyView() },
                  action: action)
    }

    public init(title: String,
                eyebrow: String? = nil,
                subtitle: String? = nil,
                description: String? = nil) {
        self.init(title: title,
                  eyebrow: eyebrow,
                  subtitle: subtitle,
                  description: description,
                  accessory: { EmptyView() },
                  action: { EmptyView() })
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: system.spacing.medium) {
            headerContent()
            if let action {
                action
                    .padding(.top, system.spacing.small)
            }
        }
        .padding(.vertical, system.spacing.large)
        .padding(.horizontal, system.spacing.large)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(backgroundGradient)
        .overlay(stylingOverlay)
        .clipShape(RoundedRectangle(cornerRadius: system.corners.large, style: .continuous))
        .shadow(color: system.colors.primary.opacity(0.18), radius: 18, x: 0, y: 12)
        .padding(.vertical, system.spacing.small)
    }

    @ViewBuilder
    private func headerContent() -> some View {
        HStack(alignment: .center, spacing: system.spacing.large) {
            VStack(alignment: .leading, spacing: system.spacing.small) {
                if let eyebrow {
                    Text(eyebrow.uppercased())
                        .font(system.typography.caption.weight(.semibold))
                        .foregroundStyle(system.colors.onPrimary.opacity(0.72))
                        .padding(.bottom, system.spacing.xSmall / 2)
                }

                Text(title)
                    .font(system.typography.largeTitle)
                    .foregroundStyle(system.colors.onPrimary)
                    .lineLimit(2)

                if let subtitle {
                    Text(subtitle)
                        .font(system.typography.headline)
                        .foregroundStyle(system.colors.onPrimary.opacity(0.88))
                }

                if let description {
                    Text(description)
                        .font(system.typography.body)
                        .foregroundStyle(system.colors.onPrimary.opacity(0.8))
                        .lineSpacing(4)
                        .padding(.top, system.spacing.xSmall)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if let accessory {
                accessory
                    .frame(minWidth: 0)
                    .transition(.opacity.combined(with: .scale(scale: 0.95)))
            }
        }
    }

    private var backgroundGradient: LinearGradient {
        LinearGradient(colors: [
            system.colors.primary,
            system.colors.accent.opacity(0.85),
            system.colors.secondary
        ], startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    private var stylingOverlay: some View {
        RoundedRectangle(cornerRadius: system.corners.large, style: .continuous)
            .strokeBorder(system.colors.onPrimary.opacity(0.18), lineWidth: 1)
            .overlay(
                RoundedRectangle(cornerRadius: system.corners.large * CGFloat(1.1), style: .continuous)
                    .inset(by: -system.spacing.xSmall)
                    .stroke(system.colors.primary.opacity(0.12), lineWidth: 2)
                    .blur(radius: 4)
                    .opacity(0.6)
            )
    }

    private static func optionalView(from builder: () -> some View) -> AnyView? {
        let view = builder()
        if view is EmptyView {
            return nil
        }
        return AnyView(view)
    }
}

#if DEBUG
struct ListItBrandHeader_Previews: PreviewProvider {
    static var previews: some View {
        DesignSystemProvider(theme: DesignSystemTheme()) {
            ListItBrandHeader(title: "ListIt Nearby",
                              eyebrow: "Discover",
                              subtitle: "Good things are around the corner",
                              description: "Match the energy of the web hero with gradients, confident typography, and space for supporting art.",
                              accessory: {
                                  Image(systemName: "sparkles")
                                      .symbolVariant(.fill)
                                      .font(.system(size: 40))
                                      .foregroundStyle(LinearGradient(colors: [Color.white.opacity(0.9), Color.white.opacity(0.4)], startPoint: .top, endPoint: .bottom))
                                      .padding(.all, 16)
                                      .background(Color.white.opacity(0.12))
                                      .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                              },
                              action: {
                                  Button("Browse nearby deals") {}
                                      .buttonStyle(ListItPrimaryButtonStyle())
                              })
                .padding()
                .background(Color.gray.opacity(0.1))
        }
        .previewLayout(.sizeThatFits)
    }
}
#endif
