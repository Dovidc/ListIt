import SwiftUI
import SharedServices
import DesignSystem

public struct ProfileFeatureView: View {
    @Environment(\.designSystem) private var designSystem
    @ObservedObject private var preferences: PreferencesService
    private let capabilityEmitter: (String, [String: Any]) -> Void

    public init(preferencesService: PreferencesService, capabilityEmitter: @escaping (String, [String: Any]) -> Void = { _, _ in }) {
        _preferences = ObservedObject(wrappedValue: preferencesService)
        self.capabilityEmitter = capabilityEmitter
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: designSystem.spacing.large) {
                    introCard
                    automationCard
                    notificationsCard
                }
                .padding(designSystem.spacing.large)
            }
            .background(designSystem.colors.background.ignoresSafeArea())
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(designSystem.enablesLargeTitles ? .large : .inline)
        }
    }

    private var introCard: some View {
        ListItCard(title: "Keep preferences aligned", subtitle: "Match the native experience with the existing web profile toggles.") {
            Text("Changes you make here update the shared preference store so Auto-list, AI descriptions, inquiry mode, Nearby sharing, and notifications behave the same way on every platform.")
                .font(designSystem.typography.callout)
                .foregroundStyle(.secondary)
        }
    }

    private var automationCard: some View {
        ListItCard(title: "Automations", subtitle: "Mirror the web profile switches for listing creation.") {
            VStack(alignment: .leading, spacing: designSystem.spacing.medium) {
                preferenceToggle(
                    title: "Auto-list",
                    detail: "new uploads",
                    description: "Automatically publish new listings with your saved defaults when you finish uploading.",
                    binding: binding(get: { preferences.autoListEnabled }) { value in
                        await preferences.setAutoListEnabled(value)
                    }
                )

                if preferences.autoListEnabled {
                    Divider()

                    preferenceToggle(
                        title: "Inquiry text",
                        detail: "replace price with offer line",
                        description: "Swap the price field for an offer prompt whenever Auto-list posts on your behalf.",
                        binding: binding(get: { preferences.autoInquiryEnabled }) { value in
                            await preferences.setAutoInquiryEnabled(value)
                        }
                    )
                }

                Divider()

                preferenceToggle(
                    title: "AI descriptions",
                    detail: "fill description for you",
                    description: "Let ListIt write draft descriptions using the same AI helpers from the web composer.",
                    binding: binding(get: { preferences.aiDescriptionEnabled }) { value in
                        await preferences.setAiDescriptionEnabled(value)
                    }
                )

                Divider()

                preferenceToggle(
                    title: "Auto Nearby",
                    detail: "auto-list extra option",
                    description: "Uses your most recent saved location so Auto-list shares listings to the Nearby feed automatically.",
                    binding: binding(get: { preferences.autoPostNearbyEnabled }) { value in
                        await preferences.setAutoPostNearbyEnabled(value)
                    }
                )
            }
            .animation(.easeInOut(duration: 0.2), value: preferences.autoListEnabled)
        }
    }

    private var notificationsCard: some View {
        ListItCard(title: "Notifications", subtitle: "Stay in the loop when buyers reach out.") {
            preferenceToggle(
                title: "Message alerts",
                detail: "messages & activity",
                description: "Enable shared-core message notifications and activity toasts so you never miss a conversation.",
                binding: binding(get: { preferences.notificationsEnabled }) { value in
                    await preferences.setNotificationsEnabled(value)
                }
            )
        }
    }

    private func binding(get: @escaping () -> Bool, set: @escaping (Bool) async -> Void) -> Binding<Bool> {
        Binding(
            get: get,
            set: { newValue in
                Task { await set(newValue) }
                let style = newValue ? "success" : "impact.light"
                capabilityEmitter("haptic", ["style": style])
            }
        )
    }

    private func preferenceToggle(title: String, detail: String, description: String, binding: Binding<Bool>) -> some View {
        VStack(alignment: .leading, spacing: designSystem.spacing.small) {
            Toggle(isOn: binding) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(designSystem.typography.headline)
                    Text(detail)
                        .font(designSystem.typography.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .toggleStyle(SwitchToggleStyle(tint: designSystem.colors.accent))

            Text(description)
                .font(designSystem.typography.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, designSystem.spacing.xSmall)
    }
}

#if DEBUG
struct ProfileFeatureView_Previews: PreviewProvider {
    static var previews: some View {
        NavigationStack {
            ProfileFeatureView(preferencesService: PreferencesService(store: PreviewPreferencesStore()))
        }
    }
}

private final class PreviewPreferencesStore: PreferencesStoring {
    private var storage: [String: Any] = [:]

    func object(forKey key: String) -> Any? { storage[key] }

    func set(_ value: Any?, forKey key: String) {
        storage[key] = value
    }
}
#endif
