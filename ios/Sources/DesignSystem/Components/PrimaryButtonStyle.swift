import SwiftUI

public struct ListItPrimaryButtonStyle: ButtonStyle {
    @Environment(\.designSystem) private var system

    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(system.typography.headline)
            .padding(.vertical, system.spacing.small)
            .frame(maxWidth: .infinity)
            .background(configuration.isPressed ? system.colors.primary.opacity(0.8) : system.colors.primary)
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: system.corners.medium, style: .continuous))
            .shadow(color: system.colors.primary.opacity(0.15), radius: configuration.isPressed ? 2 : 6, x: 0, y: configuration.isPressed ? 1 : 3)
            .animation(.easeInOut(duration: 0.15), value: configuration.isPressed)
    }
}

public struct ListItSecondaryButtonStyle: ButtonStyle {
    @Environment(\.designSystem) private var system

    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(system.typography.callout)
            .padding(.vertical, system.spacing.xSmall)
            .padding(.horizontal, system.spacing.medium)
            .background(configuration.isPressed ? system.colors.surface.opacity(0.85) : system.colors.surface)
            .foregroundStyle(system.colors.primary)
            .overlay(
                RoundedRectangle(cornerRadius: system.corners.small, style: .continuous)
                    .stroke(system.colors.primary.opacity(0.3), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: system.corners.small, style: .continuous))
            .animation(.easeInOut(duration: 0.15), value: configuration.isPressed)
    }
}
