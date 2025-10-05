import SwiftUI
import SharedServices
import DesignSystem

public struct AdminFeatureView: View {
    @Environment(\.designSystem) private var designSystem
    @State private var flaggedListings: [AdminFlaggedListing] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    private let listingsService: ListingsService
    private let capabilityEmitter: (String, [String: Any]) -> Void

    public init(listingsService: ListingsService, capabilityEmitter: @escaping (String, [String: Any]) -> Void = { _, _ in }) {
        self.listingsService = listingsService
        self.capabilityEmitter = capabilityEmitter
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: designSystem.spacing.large) {
                    ListItCard(title: "Flagged Listings", subtitle: "Moderate reports directly from the shared core") {
                        VStack(alignment: .leading, spacing: designSystem.spacing.small) {
                            Text("The admin tab mirrors moderation tools from the web experience, allowing moderators to review reports without leaving the native app.")
                                .font(designSystem.typography.callout)
                                .foregroundStyle(.secondary)

                            Button(action: refreshFlagged) {
                                if isLoading {
                                    ProgressView()
                                } else {
                                    Label("Refresh", systemImage: "arrow.clockwise")
                                }
                            }
                            .buttonStyle(ListItPrimaryButtonStyle())
                            .disabled(isLoading)
                        }
                    }

                    if let errorMessage {
                        ListItCard(title: "Error") {
                            Text(errorMessage)
                                .font(designSystem.typography.callout)
                                .foregroundStyle(designSystem.colors.danger)
                        }
                    }

                    if flaggedListings.isEmpty && !isLoading {
                        ContentUnavailableView(
                            "No Reports",
                            systemImage: "checkmark.seal",
                            description: Text("All caught up! Flagged listings from the shared core will appear here for moderation.")
                        )
                    } else {
                        LazyVStack(spacing: designSystem.spacing.medium) {
                            ForEach(flaggedListings) { listing in
                                AdminFlaggedRow(listing: listing, listingsService: listingsService, capabilityEmitter: capabilityEmitter, onComplete: refreshFlagged)
                                    .padding(.horizontal)
                            }
                        }
                    }
                }
                .padding()
            }
            .background(designSystem.colors.background.ignoresSafeArea())
            .navigationTitle("Admin")
            .navigationBarTitleDisplayMode(designSystem.enablesLargeTitles ? .large : .inline)
            .task { await loadFlagged() }
            .refreshable { await loadFlagged(force: true) }
        }
    }

    private func refreshFlagged() {
        Task { await loadFlagged(force: true) }
    }

    @MainActor
    private func loadFlagged(force: Bool = false) async {
        if isLoading && !force { return }
        isLoading = true
        defer { isLoading = false }
        do {
            flaggedListings = try await listingsService.fetchFlaggedListings(meta: SharedCoreRequestMeta(silent: true))
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
            capabilityEmitter("haptic", ["style": "error"])
        }
    }
}

private struct AdminFlaggedRow: View {
    @Environment(\.designSystem) private var designSystem
    let listing: AdminFlaggedListing
    let listingsService: ListingsService
    let capabilityEmitter: (String, [String: Any]) -> Void
    let onComplete: () -> Void
    @State private var isProcessing = false
    @State private var actionError: String?

    var body: some View {
        ListItCard(title: listing.title, subtitle: listing.subtitle) {
            VStack(alignment: .leading, spacing: designSystem.spacing.small) {
                if let reporterCount = listing.reporterCount {
                    Label("\(reporterCount) reports", systemImage: "person.2")
                        .font(designSystem.typography.footnote)
                        .foregroundStyle(.secondary)
                }

                if !listing.reasons.isEmpty {
                    VStack(alignment: .leading, spacing: designSystem.spacing.xSmall) {
                        ForEach(listing.reasons, id: \.self) { reason in
                            Text("• \(reason)")
                                .font(designSystem.typography.callout)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                if let actionError {
                    Text(actionError)
                        .font(designSystem.typography.footnote)
                        .foregroundStyle(designSystem.colors.danger)
                }

                HStack(spacing: designSystem.spacing.small) {
                    Button(role: .destructive, action: deleteListing) {
                        if isProcessing {
                            ProgressView()
                        } else {
                            Label("Delete Listing", systemImage: "trash")
                        }
                    }
                    .buttonStyle(ListItSecondaryButtonStyle())
                    .disabled(isProcessing)

                    Button(action: clearFlag) {
                        Label("Clear Flag", systemImage: "checkmark")
                    }
                    .buttonStyle(ListItPrimaryButtonStyle())
                    .disabled(isProcessing)
                }
            }
        }
    }

    private func deleteListing() {
        Task {
            isProcessing = true
            actionError = nil
            do {
                try await listingsService.adminDeleteListing(id: listing.id)
                try await listingsService.adminDeleteFlagged(id: listing.id)
                capabilityEmitter("haptic", ["style": "success"])
                onComplete()
            } catch {
                actionError = error.localizedDescription
                capabilityEmitter("haptic", ["style": "error"])
            }
            isProcessing = false
        }
    }

    private func clearFlag() {
        Task {
            isProcessing = true
            actionError = nil
            do {
                try await listingsService.adminDeleteFlagged(id: listing.id)
                capabilityEmitter("haptic", ["style": "impact.light"])
                onComplete()
            } catch {
                actionError = error.localizedDescription
                capabilityEmitter("haptic", ["style": "error"])
            }
            isProcessing = false
        }
    }
}
