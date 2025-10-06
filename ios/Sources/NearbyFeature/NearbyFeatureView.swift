import SwiftUI
import DesignSystem

public struct NearbyFeatureView: View {
    @Environment(\.designSystem) private var designSystem
    @State private var searchText: String = ""
    @State private var radius: Double = 10
    @State private var selectedFilter: NearbyFilter = .trending
    private let capabilityEmitter: (String, [String: Any]) -> Void

    private let sampleListings: [NearbyListing] = [
        .init(title: "Vintage camera bundle", distance: "0.4 mi", isBoosted: true),
        .init(title: "Handmade planter set", distance: "1.2 mi", isBoosted: false),
        .init(title: "Electric cargo bike", distance: "2.8 mi", isBoosted: false)
    ]

    public init(capabilityEmitter: @escaping (String, [String: Any]) -> Void = { _, _ in }) {
        self.capabilityEmitter = capabilityEmitter
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: designSystem.spacing.large) {
                    discoveryCard
                    filtersSection
                    listingsSection
                }
                .padding(designSystem.spacing.large)
            }
            .background(designSystem.colors.background.ignoresSafeArea())
            .navigationTitle("Nearby")
            .navigationBarTitleDisplayMode(designSystem.enablesLargeTitles ? .large : .inline)
        }
    }

    private var discoveryCard: some View {
        ListItCard(title: "Discover what's close", subtitle: "Location-aware stories from the shared core") {
            VStack(alignment: .leading, spacing: designSystem.spacing.small) {
                Text("Tailor the feed with search keywords, radius controls, and pill filters. The SwiftUI surface mirrors the browser shell so favorites, boosts, and quick actions feel familiar.")
                    .font(designSystem.typography.callout)
                    .foregroundStyle(.secondary)

                TextField("Search nearby listings", text: $searchText)
                    .textFieldStyle(.roundedBorder)
                    .font(designSystem.typography.body)

                VStack(alignment: .leading, spacing: designSystem.spacing.xSmall) {
                    Text("Radius: \(Int(radius)) mi")
                        .font(designSystem.typography.caption)
                        .foregroundStyle(.secondary)
                    Slider(value: $radius, in: 1...50, step: 1) { _ in
                        capabilityEmitter("haptic", ["style": "selection"])
                    }
                    .tint(designSystem.colors.accent)
                }
            }
        }
    }

    private var filtersSection: some View {
        VStack(alignment: .leading, spacing: designSystem.spacing.small) {
            Text("Quick filters")
                .font(designSystem.typography.subheadline)
                .foregroundStyle(.secondary)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: designSystem.spacing.small) {
                    ForEach(NearbyFilter.allCases, id: \.self) { filter in
                        Button {
                            withAnimation(.easeInOut) {
                                selectedFilter = filter
                                capabilityEmitter("haptic", ["style": "impact.light"])
                            }
                        } label: {
                            Text(filter.title)
                                .font(designSystem.typography.callout)
                                .padding(.vertical, designSystem.spacing.xSmall)
                                .padding(.horizontal, designSystem.spacing.medium)
                                .background(filterBackground(for: filter))
                                .foregroundStyle(filterForeground(for: filter))
                                .clipShape(Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var listingsSection: some View {
        VStack(alignment: .leading, spacing: designSystem.spacing.medium) {
            Text("Preview results")
                .font(designSystem.typography.headline)

            ForEach(sampleListings) { listing in
                ListItCard(title: listing.title, subtitle: "\(listing.distance) · \(selectedFilter.title)") {
                    HStack(spacing: designSystem.spacing.small) {
                        Label("Favorite", systemImage: "heart")
                            .onTapGesture {
                                capabilityEmitter("haptic", ["style": "impact.medium"])
                            }
                        Spacer()
                        if listing.isBoosted {
                            Label("Boosted", systemImage: "bolt.fill")
                                .font(designSystem.typography.caption)
                                .foregroundStyle(designSystem.colors.accent)
                        }
                    }
                    .font(designSystem.typography.callout)
                    .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func filterBackground(for filter: NearbyFilter) -> Color {
        filter == selectedFilter ? designSystem.colors.primary : designSystem.colors.surface
    }

    private func filterForeground(for filter: NearbyFilter) -> Color {
        filter == selectedFilter ? designSystem.colors.onPrimary : designSystem.colors.onSurface
    }
}

private struct NearbyListing: Identifiable {
    let id = UUID()
    let title: String
    let distance: String
    let isBoosted: Bool
}

private enum NearbyFilter: CaseIterable {
    case trending
    case newest
    case priceDrops
    case favorites

    var title: String {
        switch self {
        case .trending: return "Trending"
        case .newest: return "Newest"
        case .priceDrops: return "Price drops"
        case .favorites: return "Favorites"
        }
    }
}
