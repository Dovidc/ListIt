import SwiftUI

public struct FilterPill: View {
    @Environment(\.designSystem) private var system

    private let title: String
    private let icon: String?
    private let isActive: Bool
    private let action: () -> Void

    public init(title: String, icon: String? = nil, isActive: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.icon = icon
        self.isActive = isActive
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: system.spacing.xSmall) {
                if let icon {
                    Image(systemName: icon)
                }
                Text(title)
            }
            .font(system.typography.callout)
            .padding(.horizontal, system.spacing.medium)
            .padding(.vertical, system.spacing.xSmall)
            .frame(minHeight: 32)
            .background(background)
            .overlay(border)
            .foregroundStyle(isActive ? system.colors.onPrimary : system.colors.onSurface)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private var background: some View {
        Capsule()
            .fill(isActive ? system.colors.accent : system.colors.surface)
            .shadow(color: system.colors.onSurface.opacity(isActive ? 0.15 : 0.05), radius: isActive ? 6 : 3, x: 0, y: isActive ? 3 : 2)
    }

    private var border: some View {
        Capsule()
            .stroke(isActive ? system.colors.accent.opacity(0.0) : system.colors.onSurface.opacity(0.08), lineWidth: 1)
    }
}
