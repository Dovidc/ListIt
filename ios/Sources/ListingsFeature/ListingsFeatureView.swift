import SwiftUI
import SharedServices

public struct ListingsFeatureView: View {
    @State private var listings: [Listing] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    private let listingsService: ListingsService

    public init(listingsService: ListingsService) {
        self.listingsService = listingsService
    }

    public var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView()
                } else if let errorMessage {
                    ContentUnavailableView("Unable to Load", systemImage: "exclamationmark.triangle", description: Text(errorMessage))
                } else {
                    List(listings) { listing in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(listing.title)
                                .font(.headline)
                            Text(listing.subtitle)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .refreshable { await loadListings() }
                }
            }
            .navigationTitle("Listings")
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
