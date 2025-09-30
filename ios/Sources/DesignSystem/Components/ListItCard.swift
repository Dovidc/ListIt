import SwiftUI

public struct ListItCard<Content: View>: View {
    @Environment(\.designSystem) private var system
    private let title: String?
    private let subtitle: String?
    private let content: Content

    public init(title: String? = nil, subtitle: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.subtitle = subtitle
        self.content = content()
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: system.spacing.small) {
            if let title {
                Text(title)
                    .font(system.typography.headline)
                    .foregroundStyle(system.colors.secondary)
            }
            if let subtitle {
                Text(subtitle)
                    .font(system.typography.subheadline)
                    .foregroundStyle(system.colors.secondary.opacity(0.7))
            }
            content
                .font(system.typography.body)
        }
        .padding(system.spacing.medium)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(system.colors.surface)
        .clipShape(RoundedRectangle(cornerRadius: system.corners.medium, style: .continuous))
        .shadow(color: system.colors.secondary.opacity(0.05), radius: 8, x: 0, y: 4)
    }
}
