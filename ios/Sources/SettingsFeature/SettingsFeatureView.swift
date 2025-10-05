import SwiftUI
import DesignSystem
import SharedServices

public struct SettingsFeatureView: View {
    @Environment(\.designSystem) private var designSystem
    @ObservedObject private var preferences: PreferencesService

    public init(preferences: PreferencesService) {
        self._preferences = ObservedObject(wrappedValue: preferences)
    }

    public var body: some View {
        NavigationStack {
            List {
                Section("Automation") {
                    toggleRow(
                        title: "Auto-list",
                        subtitle: "new uploads",
                        isOn: Binding(
                            get: { preferences.autoListEnabled },
                            set: { preferences.setAutoListEnabled($0) }
                        )
                    )

                    if preferences.autoListEnabled {
                        toggleRow(
                            title: "Inquiry text",
                            subtitle: "replace price with offer line",
                            isOn: Binding(
                                get: { preferences.autoInquiryEnabled },
                                set: { preferences.setAutoInquiryEnabled($0) }
                            )
                        )
                    }

                    toggleRow(
                        title: "AI descriptions",
                        subtitle: "fill description for you",
                        isOn: Binding(
                            get: { preferences.aiDescriptionEnabled },
                            set: { preferences.setAiDescriptionEnabled($0) }
                        )
                    )

                    toggleRow(
                        title: "Auto Nearby",
                        subtitle: "auto-list extra option",
                        isOn: Binding(
                            get: { preferences.autoPostNearbyEnabled },
                            set: { preferences.setAutoPostNearbyEnabled($0) }
                        )
                    )
                }

                Section("Notifications") {
                    toggleRow(
                        title: "Push notifications",
                        subtitle: "alerts for messages and activity",
                        isOn: Binding(
                            get: { preferences.notificationsEnabled },
                            set: { preferences.setNotificationsEnabled($0) }
                        )
                    )
                } footer: {
                    Text("Change these later in iOS Settings > Notifications if you update your mind.")
                        .font(designSystem.typography.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.top, designSystem.spacing.xSmall)
                }
            }
            .environment(\.defaultMinListRowHeight, 54)
            .listStyle(.insetGrouped)
            .tint(designSystem.colors.accent)
            .scrollContentBackground(.hidden)
            .background(designSystem.colors.background.ignoresSafeArea())
            .navigationTitle("Settings")
        }
    }

    private func toggleRow(title: String, subtitle: String, isOn: Binding<Bool>) -> some View {
        Toggle(isOn: isOn) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(designSystem.typography.headline)
                Text(subtitle)
                    .font(designSystem.typography.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding(.vertical, designSystem.spacing.xSmall)
        }
        .toggleStyle(SwitchToggleStyle(tint: designSystem.colors.accent))
    }
}

#if DEBUG
struct SettingsFeatureView_Previews: PreviewProvider {
    static var previews: some View {
        NavigationStack {
            SettingsFeatureView(preferences: PreferencesService())
        }
        .environment(\.designSystem, DesignSystemTheme().makeDesignSystem())
    }
}
#endif
