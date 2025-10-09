import SwiftUI
import DesignSystem
import SharedServices
import AuthFeature
import UploadFeature

public struct AdminFeatureView: View {
    @Environment(\.designSystem) private var designSystem
    private let authService: AuthService
    private let uploadService: UploadService
    private let capabilityEmitter: (String, [String: Any]) -> Void

    public init(
        authService: AuthService,
        uploadService: UploadService,
        capabilityEmitter: @escaping (String, [String: Any]) -> Void = { _, _ in }
    ) {
        self.authService = authService
        self.uploadService = uploadService
        self.capabilityEmitter = capabilityEmitter
    }

    public var body: some View {
        NavigationStack {
            List {
                Section("Operations") {
                    NavigationLink {
                        UploadFeatureView(
                            uploadService: uploadService,
                            capabilityEmitter: capabilityEmitter,
                            showsNavigationChrome: false
                        )
                        .navigationTitle("Upload Center")
                        .navigationBarTitleDisplayMode(designSystem.enablesLargeTitles ? .large : .inline)
                        .padding(.top, designSystem.spacing.medium)
                    } label: {
                        Label("Upload Center", systemImage: "icloud.and.arrow.up")
                    }

                    NavigationLink {
                        AuthFeatureView(
                            authService: authService,
                            capabilityEmitter: capabilityEmitter,
                            showsNavigationChrome: false
                        )
                        .navigationTitle("Sessions")
                        .navigationBarTitleDisplayMode(designSystem.enablesLargeTitles ? .large : .inline)
                    } label: {
                        Label("Sessions & Access", systemImage: "person.badge.key")
                    }
                }

                Section("Guidance") {
                    ListItCard(title: "Admin dashboards", subtitle: "Keep moderation and monetization in sync") {
                        VStack(alignment: .leading, spacing: designSystem.spacing.small) {
                            Text("The native admin space mirrors the browser tools, surfacing inventory audits, boosted listings, ad pacing, and trust & safety workflows in one place.")
                                .font(designSystem.typography.callout)
                                .foregroundStyle(.secondary)

                            Button {
                                capabilityEmitter("haptic", ["style": "impact.light"])
                            } label: {
                                Label("Review alerts", systemImage: "bell.badge")
                            }
                            .buttonStyle(ListItSecondaryButtonStyle())
                        }
                    }
                    .listRowInsets(EdgeInsets())
                    .listRowSeparator(.hidden)
                }
            }
            .listStyle(.insetGrouped)
            .background(designSystem.colors.background.ignoresSafeArea())
            .navigationTitle("Admin")
            .navigationBarTitleDisplayMode(designSystem.enablesLargeTitles ? .large : .inline)
        }
    }
}
