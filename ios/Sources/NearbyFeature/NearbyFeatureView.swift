import SwiftUI
import CoreLocation
import DesignSystem
import SharedServices

public struct NearbyFeatureView: View {
    @Environment(\.designSystem) private var designSystem
    @StateObject private var locationManager = NearbyLocationManager()
    @State private var searchText: String = ""
    @State private var radiusMiles: Double
    @State private var selectedFilter: NearbyFilter = .trending
    @State private var listings: [NearbyListing] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var reloadTask: Task<Void, Never>?
    @FocusState private var isSearchFocused: Bool

    private let nearbyService: NearbyService
    private let capabilityEmitter: (String, [String: Any]) -> Void

    private static let radiusRange: ClosedRange<Double> = 1...50
    private static let currencyFormatter: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.maximumFractionDigits = 0
        return formatter
    }()

    public init(nearbyService: NearbyService,
                defaultRadiusMiles: Double = 10,
                capabilityEmitter: @escaping (String, [String: Any]) -> Void = { _, _ in }) {
        self.nearbyService = nearbyService
        let clampedRadius = min(max(defaultRadiusMiles, NearbyFeatureView.radiusRange.lowerBound), NearbyFeatureView.radiusRange.upperBound)
        self._radiusMiles = State(initialValue: clampedRadius)
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
            .task {
                locationManager.requestInitialAuthorization()
                await loadNearby(reason: .initial)
            }
            .onChange(of: locationManager.authorizationStatus) { newStatus in
                if newStatus.isAuthorized {
                    locationManager.refreshLocation()
                }
                if newStatus.isDenied {
                    errorMessage = "Enable location access in Settings to explore nearby listings."
                }
            }
            .onReceive(locationManager.$lastLocation.compactMap { $0 }) { _ in
                Task { await loadNearby(reason: .locationChange) }
            }
            .onChange(of: selectedFilter) { _ in
                capabilityEmitter("haptic", ["style": "impact.light"])
                Task { await loadNearby(reason: .filterChange) }
            }
            .onChange(of: radiusMiles) { _ in
                capabilityEmitter("haptic", ["style": "selection"])
                scheduleReload()
            }
            .onChange(of: searchText) { _ in
                scheduleReload()
            }
        }
    }

    private var discoveryCard: some View {
        ListItCard(title: "Discover what's close", subtitle: discoverySubtitle) {
            VStack(alignment: .leading, spacing: designSystem.spacing.small) {
                Text("Tailor the feed with search keywords, radius controls, and pill filters. Native SwiftUI surfaces reuse shared-core helpers so boosts, favorites, and haptics feel identical to the browser experience.")
                    .font(designSystem.typography.callout)
                    .foregroundStyle(.secondary)

                if locationManager.authorizationStatus.isDenied {
                    Button {
                        capabilityEmitter("settings", ["destination": "privacy-location"]) 
                    } label: {
                        Label("Open Settings", systemImage: "gearshape")
                            .font(designSystem.typography.callout)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(designSystem.colors.accent)
                } else {
                    TextField("Search nearby listings", text: $searchText)
                        .focused($isSearchFocused)
                        .textFieldStyle(.roundedBorder)
                        .font(designSystem.typography.body)
                        .submitLabel(.search)
                        .onSubmit {
                            Task { await loadNearby(reason: .searchCommit) }
                        }

                    VStack(alignment: .leading, spacing: designSystem.spacing.xSmall) {
                        Text("Radius: \(Int(radiusMiles)) mi")
                            .font(designSystem.typography.caption)
                            .foregroundStyle(.secondary)
                        Slider(value: $radiusMiles, in: NearbyFeatureView.radiusRange, step: 1)
                            .tint(designSystem.colors.accent)
                    }

                    HStack(spacing: designSystem.spacing.small) {
                        Button {
                            capabilityEmitter("haptic", ["style": "impact.medium"])
                            locationManager.refreshLocation()
                            Task { await loadNearby(reason: .manualRefresh) }
                        } label: {
                            Label("Refresh", systemImage: "arrow.triangle.2.circlepath")
                                .font(designSystem.typography.callout)
                        }
                        .buttonStyle(.bordered)

                        if isLoading {
                            ProgressView()
                                .progressViewStyle(.circular)
                        }
                    }
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
            Text("Nearby results")
                .font(designSystem.typography.headline)

            if isLoading && listings.isEmpty {
                ProgressView("Loading nearby listings…")
                    .font(designSystem.typography.body)
            } else if let errorMessage {
                ContentUnavailableView("Unable to load", systemImage: "exclamationmark.triangle", description: Text(errorMessage))
            } else if filteredListings.isEmpty {
                ContentUnavailableView("Nothing nearby yet", systemImage: "mappin.slash", description: Text(emptyStateMessage))
            } else {
                LazyVGrid(columns: gridColumns, spacing: designSystem.spacing.medium) {
                    ForEach(filteredListings) { listing in
                        ListItCard(title: listing.title, subtitle: subtitle(for: listing)) {
                            listingDetails(for: listing)
                        }
                    }
                }
            }
        }
    }

    private var discoverySubtitle: String {
        switch locationManager.authorizationStatus {
        case .notDetermined:
            return "Grant location access to tailor recommendations around you."
        case .restricted:
            return "Location access is restricted on this device."
        case .denied:
            return "Location access is turned off."
        case .authorizedAlways, .authorizedWhenInUse:
            if locationManager.lastLocation != nil {
                return "Powered by shared-core nearby APIs and JavaScript helpers."
            }
            return "Fetching your location…"
        @unknown default:
            return "" 
        }
    }

    private var filteredListings: [NearbyListing] {
        var items = listings
        let trimmedQuery = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedQuery.isEmpty {
            let query = trimmedQuery.lowercased()
            items = items.filter { listing in
                let haystacks = [listing.title, listing.subtitle, listing.location ?? ""]
                    .map { $0.lowercased() }
                let tagMatch = listing.normalizedTags.contains { $0.contains(query) }
                return haystacks.contains { $0.contains(query) } || tagMatch
            }
        }

        switch selectedFilter {
        case .trending:
            return items
        case .newest:
            return items.sorted { (a, b) in
                let lhs = a.createdAt ?? .distantPast
                let rhs = b.createdAt ?? .distantPast
                return lhs > rhs
            }
        case .priceDrops:
            return items.filter { listing in
                listing.normalizedTags.contains { $0.contains("price_drop") || $0.contains("reduced") }
            }
        case .favorites:
            return items.filter { $0.isFavorite }
        }
    }

    private var emptyStateMessage: String {
        if locationManager.authorizationStatus.isDenied {
            return "Enable location permissions to discover what's available near you."
        }
        if !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "Try another search term or widen your radius."
        }
        switch selectedFilter {
        case .priceDrops:
            return "No price drops match your filters yet."
        case .favorites:
            return "Save listings on the web to see them here."
        default:
            return "Adjust your filters or refresh to load the latest listings."
        }
    }

    private var gridColumns: [GridItem] {
        [GridItem(.adaptive(minimum: 220), spacing: designSystem.spacing.medium, alignment: .top)]
    }

    private func subtitle(for listing: NearbyListing) -> String {
        if !listing.subtitle.isEmpty { return listing.subtitle }
        var parts: [String] = []
        if let priceText = formattedPrice(for: listing) { parts.append(priceText) }
        if let location = listing.location { parts.append(location) }
        return parts.joined(separator: " • ")
    }

    private func formattedPrice(for listing: NearbyListing) -> String? {
        guard let price = listing.price else { return nil }
        return NearbyFeatureView.currencyFormatter.string(from: NSNumber(value: price))
    }

    @ViewBuilder
    private func listingDetails(for listing: NearbyListing) -> some View {
        VStack(alignment: .leading, spacing: designSystem.spacing.small) {
            HStack(alignment: .center, spacing: designSystem.spacing.small) {
                if !listing.distanceText.isEmpty {
                    Label(listing.distanceText, systemImage: "location")
                        .font(designSystem.typography.footnote)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if listing.isBoosted {
                    Label("Boosted", systemImage: "bolt.fill")
                        .font(designSystem.typography.caption)
                        .foregroundStyle(designSystem.colors.accent)
                }
            }

            if let location = listing.location {
                Label(location, systemImage: "mappin.and.ellipse")
                    .font(designSystem.typography.callout)
                    .foregroundStyle(.secondary)
            }

            if let priceText = formattedPrice(for: listing) {
                Text(priceText)
                    .font(designSystem.typography.headline)
                    .foregroundStyle(designSystem.colors.onSurface)
            }

            if !listing.displayTags.isEmpty {
                HStack(spacing: designSystem.spacing.xSmall) {
                    ForEach(listing.displayTags, id: \.self) { tag in
                        Text(tag)
                            .font(designSystem.typography.caption)
                            .padding(.vertical, designSystem.spacing.xSmall / 2)
                            .padding(.horizontal, designSystem.spacing.small)
                            .background(designSystem.colors.surface.opacity(0.6))
                            .foregroundStyle(designSystem.colors.onSurface.opacity(0.8))
                            .clipShape(Capsule())
                    }
                }
            }

            Divider()

            HStack(spacing: designSystem.spacing.small) {
                Button {
                    capabilityEmitter("nearby.favorite", ["listingId": listing.id])
                    capabilityEmitter("haptic", ["style": "impact.medium"])
                } label: {
                    Label("Favorite", systemImage: listing.isFavorite ? "heart.fill" : "heart")
                }

                Spacer()

                Button {
                    capabilityEmitter("nearby.share", ["listingId": listing.id])
                } label: {
                    Label("Share", systemImage: "square.and.arrow.up")
                }
            }
            .font(designSystem.typography.callout)
            .foregroundStyle(.secondary)
            .buttonStyle(.plain)
        }
    }

    private func filterBackground(for filter: NearbyFilter) -> Color {
        filter == selectedFilter ? designSystem.colors.primary : designSystem.colors.surface
    }

    private func filterForeground(for filter: NearbyFilter) -> Color {
        filter == selectedFilter ? designSystem.colors.onPrimary : designSystem.colors.onSurface
    }

    private func scheduleReload() {
        reloadTask?.cancel()
        reloadTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 400_000_000)
            await loadNearby(reason: .debouncedRefresh)
        }
    }

    @MainActor
    private func loadNearby(reason: ReloadReason) async {
        reloadTask?.cancel()

        let coordinate = locationManager.lastLocation?.coordinate
        if coordinate == nil && locationManager.authorizationStatus.isAuthorized {
            locationManager.refreshLocation()
        }

        isLoading = true
        errorMessage = nil

        do {
            let radiusMeters = radiusMiles * 1609.344
            let summaries = try await nearbyService.fetchNearby(
                latitude: coordinate?.latitude,
                longitude: coordinate?.longitude,
                radiusMeters: radiusMeters,
                query: searchText,
                filter: selectedFilter.queryValue
            )
            listings = summaries.map(NearbyListing.init(summary:))
            if listings.isEmpty {
                errorMessage = emptyStateMessage
            }
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }
}

private enum ReloadReason {
    case initial
    case locationChange
    case filterChange
    case manualRefresh
    case searchCommit
    case debouncedRefresh
}

private struct NearbyListing: Identifiable {
    let id: String
    let title: String
    let subtitle: String
    let distanceText: String
    let location: String?
    let price: Double?
    let tags: [String]
    let createdAt: Date?
    let isBoosted: Bool
    let isFavorite: Bool

    init(summary: NearbyListingSummary) {
        self.id = summary.id
        self.title = summary.title
        self.subtitle = summary.subtitle
        self.distanceText = summary.distanceText
        self.location = summary.location
        self.price = summary.price
        self.tags = summary.tags
        self.createdAt = summary.createdAt
        self.isBoosted = summary.isBoosted
        self.isFavorite = summary.isFavorite
    }

    var normalizedTags: [String] {
        tags.map { $0.lowercased() }
    }

    var displayTags: [String] {
        Array(tags.prefix(3))
    }
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

    var queryValue: String? {
        switch self {
        case .trending: return nil
        case .newest: return "newest"
        case .priceDrops: return "priceDrops"
        case .favorites: return "favorites"
        }
    }
}

private final class NearbyLocationManager: NSObject, ObservableObject {
    @Published var authorizationStatus: CLAuthorizationStatus
    @Published var lastLocation: CLLocation?

    private let manager: CLLocationManager

    override init() {
        let manager = CLLocationManager()
        self.manager = manager
        if #available(iOS 14.0, *) {
            self.authorizationStatus = manager.authorizationStatus
        } else {
            self.authorizationStatus = CLLocationManager.authorizationStatus()
        }
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager.distanceFilter = 50
    }

    func requestInitialAuthorization() {
        if authorizationStatus == .notDetermined {
            manager.requestWhenInUseAuthorization()
        } else if authorizationStatus.isAuthorized {
            refreshLocation()
        }
    }

    func refreshLocation() {
        guard CLLocationManager.locationServicesEnabled(), authorizationStatus.isAuthorized else { return }
        manager.requestLocation()
    }
}

extension NearbyLocationManager: CLLocationManagerDelegate {
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            if #available(iOS 14.0, *) {
                authorizationStatus = manager.authorizationStatus
            } else {
                authorizationStatus = type(of: manager).authorizationStatus()
            }
            if authorizationStatus.isAuthorized {
                manager.requestLocation()
            }
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        Task { @MainActor in
            lastLocation = location
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        print("[NearbyLocationManager] Location error: \(error.localizedDescription)")
    }
}

private extension CLAuthorizationStatus {
    var isAuthorized: Bool {
        self == .authorizedAlways || self == .authorizedWhenInUse
    }

    var isDenied: Bool {
        self == .denied || self == .restricted
    }
}
