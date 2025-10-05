import SwiftUI
import SharedServices
import DesignSystem

public struct ListingsFeatureView: View {
    @Environment(\.designSystem) private var designSystem
    @State private var listings: [Listing] = []
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
            Group {
                if isLoading {
                    ProgressView()
                } else if let errorMessage {
                    ContentUnavailableView("Unable to Load", systemImage: "exclamationmark.triangle", description: Text(errorMessage))
                } else {
                    List {
                        heroSection
                            .listRowInsets(EdgeInsets())
                            .listRowSeparator(.hidden)
                            .listRowBackground(Color.clear)

                        ForEach(listings) { listing in
                            ListItCard(title: listing.title, subtitle: listing.subtitle) {
                                Text("Native listing card powered by the shared core service")
                                    .font(designSystem.typography.callout)
                                    .foregroundStyle(.secondary)
                            }
                            .listRowBackground(Color.clear)
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                if designSystem.supportsSwipeActions {
                                    Button { capabilityEmitter("haptic", ["style": "impact.medium"]) } label: {
                                        Label("Favorite", systemImage: "heart")
                                    }
                                    .tint(designSystem.colors.accent)
                                }
                            }
                        }
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                    .background(designSystem.colors.background)
                    .refreshable { await loadListings() }
                }
            }
            .navigationTitle("Listings")
            .navigationBarTitleDisplayMode(designSystem.enablesLargeTitles ? .large : .inline)
            .task { await loadListings() }
        }
    }

    @MainActor
    private func loadListings() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let summaries = try await listingsService.fetchListings()
            listings = summaries.map(Listing.init(model:))
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private var heroSection: some View {
        ListingsHeroBanner(isRefreshing: isLoading) {
            capabilityEmitter("haptic", ["style": "notification.success"])
            Task { await loadListings() }
        }
    }
}

private extension ListingsFeatureView {
    struct Listing: Identifiable {
        let id: String
        let title: String
        let subtitle: String
    }
}

extension ListingsFeatureView.Listing {
    init(model: ListingSummary) {
        self.id = model.id
        self.title = model.title
        self.subtitle = model.subtitle
    }
}

private struct ListingsHeroBanner: View {
    @Environment(\.designSystem) private var designSystem
    @State private var animateOverlay = false
    let isRefreshing: Bool
    let refreshAction: () -> Void

    var body: some View {
        ZStack(alignment: .leading) {
            RoundedRectangle(cornerRadius: designSystem.corners.large, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [
                            designSystem.colors.primary,
                            designSystem.colors.primary.opacity(0.85),
                            designSystem.colors.accent
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay(accentOverlay)

            VStack(alignment: .leading, spacing: designSystem.spacing.small) {
                Text("Native Listings Preview")
                    .font(designSystem.typography.largeTitle)
                    .foregroundStyle(designSystem.colors.onPrimary)

                Text("The SwiftUI listings tab now applies the shared ListIt theme and design tokens. Pull to refresh or tap below to reload the shared core sample data.")
                    .font(designSystem.typography.body)
                    .foregroundStyle(designSystem.colors.onPrimary.opacity(0.85))

                Button {
                    refreshAction()
                } label: {
                    Label(isRefreshing ? "Refreshing…" : "Refresh preview", systemImage: "arrow.triangle.2.circlepath")
                        .font(designSystem.typography.callout)
                        .padding(.vertical, designSystem.spacing.xSmall)
                        .padding(.horizontal, designSystem.spacing.medium)
                        .background(
                            RoundedRectangle(cornerRadius: designSystem.corners.small, style: .continuous)
                                .fill(designSystem.colors.onPrimary.opacity(0.18))
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: designSystem.corners.small, style: .continuous)
                                .stroke(designSystem.colors.onPrimary.opacity(0.35), lineWidth: 1)
                        )
                        .foregroundStyle(designSystem.colors.onPrimary)
                }
                .buttonStyle(.plain)
                .disabled(isRefreshing)
                .opacity(isRefreshing ? 0.7 : 1)
            }
            .padding(.vertical, designSystem.spacing.large)
            .padding(.horizontal, designSystem.spacing.large)
        }
        .padding(.horizontal, designSystem.spacing.medium)
        .padding(.top, designSystem.spacing.medium)
        .accessibilityElement(children: .combine)
        .onAppear { animateOverlay = true }
    }

    private var accentOverlay: some View {
        ZStack {
            Circle()
                .fill(Color.white.opacity(0.25))
                .scaleEffect(animateOverlay ? 1.15 : 0.85)
                .offset(x: animateOverlay ? 60 : 10, y: animateOverlay ? -40 : -20)
                .blur(radius: 55)

            RoundedRectangle(cornerRadius: designSystem.corners.large, style: .continuous)
                .strokeBorder(Color.white.opacity(0.2), lineWidth: 1)
                .blendMode(.screen)
        }
        .animation(.easeInOut(duration: 3).repeatForever(autoreverses: true), value: animateOverlay)
    }
}
