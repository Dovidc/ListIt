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
                    if #available(iOS 17.0, *) {
                        ContentUnavailableView(
                            "Unable to Load",
                            systemImage: "exclamationmark.triangle",
                            description: Text(errorMessage)
                        )
                    } else {
                        VStack(spacing: 16) {
                            Image(systemName: "exclamationmark.triangle")
                                .font(.system(size: 40))
                                .foregroundStyle(.secondary)
                            Text("Unable to Load")
                                .font(.title2)
                                .fontWeight(.semibold)
                            Text(errorMessage)
                                .font(.body)
                                .multilineTextAlignment(.center)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                        .padding()
                    }
                } else {
                    List {
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
