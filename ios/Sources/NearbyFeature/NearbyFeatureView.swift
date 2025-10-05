import SwiftUI
import CoreLocation
import Combine
import UIKit
import SharedServices
import DesignSystem

public struct NearbyFeatureView: View {
    @Environment(\.designSystem) private var designSystem
    @StateObject private var locationProvider = LocationProvider()
    @State private var radius: Double = 750
    @State private var searchQuery: String = ""
    @State private var results: [NearbyListing] = []
    @State private var isLoading = false
    @State private var statusMessage: String?
    @State private var lastLoadedLocation: CLLocation?

    private let listingsService: ListingsService
    private let capabilityEmitter: (String, [String: Any]) -> Void

    public init(listingsService: ListingsService, capabilityEmitter: @escaping (String, [String: Any]) -> Void = { _, _ in }) {
        self.listingsService = listingsService
        self.capabilityEmitter = capabilityEmitter
    }

    public var body: some View {
        NavigationStack {
            VStack(spacing: designSystem.spacing.large) {
                statusCard

                radiusControls

                if let statusMessage {
                    Text(statusMessage)
                        .font(designSystem.typography.callout)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal)
                }

                Group {
                    if isLoading {
                        ProgressView()
                            .tint(designSystem.colors.accent)
                    } else if results.isEmpty {
                        ContentUnavailableView(
                            "No Nearby Listings",
                            systemImage: "location.slash",
                            description: Text("Grant location access or adjust the radius to discover listings near you.")
                        )
                    } else {
                        ScrollView {
                            LazyVStack(spacing: designSystem.spacing.medium) {
                                ForEach(filteredResults) { listing in
                                    ListItCard(title: listing.title, subtitle: listing.subtitle) {
                                        VStack(alignment: .leading, spacing: designSystem.spacing.xSmall) {
                                            if let distance = listing.distanceDescription {
                                                Label(distance, systemImage: "location")
                                                    .font(designSystem.typography.footnote)
                                                    .foregroundStyle(.secondary)
                                            }
                                            Text("Powered by the shared nearby search service.")
                                                .font(designSystem.typography.callout)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                    .onTapGesture {
                                        capabilityEmitter("haptic", ["style": "impact.light"])
                                    }
                                }
                            }
                            .padding(.horizontal)
                        }
                        .scrollIndicators(.hidden)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .padding(.vertical, designSystem.spacing.large)
            .background(designSystem.colors.background.ignoresSafeArea())
            .navigationTitle("Nearby")
            .navigationBarTitleDisplayMode(designSystem.enablesLargeTitles ? .large : .inline)
            .task { await handleAuthorizationStatus(locationProvider.authorizationStatus) }
            .onReceive(locationProvider.$authorizationStatus) { status in
                Task { await handleAuthorizationStatus(status) }
            }
            .onReceive(locationProvider.$location.compactMap { $0 }) { location in
                Task { await loadNearbyListings(for: location) }
            }
            .onChange(of: radius) { _ in
                guard let location = locationProvider.location else { return }
                Task { await loadNearbyListings(for: location, force: false) }
            }
        }
    }

    private var filteredResults: [NearbyListing] {
        guard !searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return results
        }
        return results.filter { listing in
            listing.title.localizedCaseInsensitiveContains(searchQuery) ||
            listing.subtitle.localizedCaseInsensitiveContains(searchQuery)
        }
    }

    private var statusCard: some View {
        ListItCard(title: "Location Access", subtitle: locationSubtitle) {
            VStack(alignment: .leading, spacing: designSystem.spacing.small) {
                Text(locationDescription)
                    .font(designSystem.typography.callout)
                    .foregroundStyle(.secondary)

                HStack(spacing: designSystem.spacing.medium) {
                    Button(locationButtonTitle) {
                        handleLocationButtonTap()
                    }
                    .buttonStyle(ListItPrimaryButtonStyle())

                    if let radiusLabel {
                        Text("Radius: \(radiusLabel)")
                            .font(designSystem.typography.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private var radiusControls: some View {
        VStack(spacing: designSystem.spacing.small) {
            TextField("Filter listings", text: $searchQuery)
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal)

            HStack {
                Text("100m")
                    .font(designSystem.typography.footnote)
                    .foregroundStyle(.secondary)
                Slider(value: $radius, in: 100...5000, step: 50)
                    .tint(designSystem.colors.accent)
                Text("5km")
                    .font(designSystem.typography.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal)
        }
    }

    private var radiusLabel: String? {
        (try? listingsService.formatDistance(radius))
    }

    private var locationSubtitle: String {
        switch locationProvider.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            return "Active"
        case .notDetermined:
            return "Permission Needed"
        case .restricted, .denied:
            return "Access Denied"
        @unknown default:
            return "Unknown"
        }
    }

    private var locationDescription: String {
        switch locationProvider.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            return "We use your current location to surface listings nearby. Adjust the search radius to fine-tune the results."
        case .notDetermined:
            return "Enable location access to discover listings around you."
        case .restricted, .denied:
            return "Location access is disabled. Update your system settings to allow ListIt to determine nearby listings."
        @unknown default:
            return "Location status is unavailable."
        }
    }

    private var locationButtonTitle: String {
        switch locationProvider.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            return "Refresh"
        case .notDetermined:
            return "Request Access"
        case .restricted, .denied:
            return "Open Settings"
        @unknown default:
            return "Request Access"
        }
    }

    private func handleLocationButtonTap() {
        switch locationProvider.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            if let location = locationProvider.location {
                Task { await loadNearbyListings(for: location, force: true) }
            } else {
                locationProvider.requestLocation()
            }
        case .notDetermined:
            locationProvider.requestAuthorization()
        case .restricted, .denied:
            guard let settingsURL = URL(string: UIApplication.openSettingsURLString),
                  UIApplication.shared.canOpenURL(settingsURL)
            else { return }
            UIApplication.shared.open(settingsURL)
        @unknown default:
            locationProvider.requestAuthorization()
        }
    }

    @MainActor
    private func handleAuthorizationStatus(_ status: CLAuthorizationStatus) async {
        switch status {
        case .authorizedAlways, .authorizedWhenInUse:
            locationProvider.startUpdating()
        case .notDetermined:
            statusMessage = "Tap Request Access to enable nearby discovery."
        case .restricted, .denied:
            statusMessage = "Location access is disabled."
            results = []
        @unknown default:
            statusMessage = "Location status unavailable."
        }
    }

    @MainActor
    private func loadNearbyListings(for location: CLLocation, force: Bool = false) async {
        if !force, let lastLoadedLocation, lastLoadedLocation.distance(from: location) < 25 {
            return
        }
        isLoading = true
        statusMessage = nil
        defer { isLoading = false }

        do {
            let nearby = try await listingsService.fetchNearbyListings(
                latitude: location.coordinate.latitude,
                longitude: location.coordinate.longitude,
                radiusMeters: radius
            )
            results = nearby.map { listing in
                let distanceText = try? listingsService.formatDistance(listing.distanceMeters)
                return NearbyListing(
                    id: listing.summary.id,
                    title: listing.summary.title,
                    subtitle: listing.summary.subtitle,
                    distanceDescription: distanceText
                )
            }
            lastLoadedLocation = location
            if force {
                capabilityEmitter("haptic", ["style": "success"])
            }
        } catch {
            statusMessage = error.localizedDescription
            results = []
            capabilityEmitter("haptic", ["style": "error"])
        }
    }
}

private extension NearbyFeatureView {
    struct NearbyListing: Identifiable, Equatable {
        let id: String
        let title: String
        let subtitle: String
        let distanceDescription: String?
    }
}

private final class LocationProvider: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var authorizationStatus: CLAuthorizationStatus
    @Published var location: CLLocation?

    private let manager: CLLocationManager

    override init() {
        self.manager = CLLocationManager()
        self.authorizationStatus = manager.authorizationStatus
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func requestAuthorization() {
        manager.requestWhenInUseAuthorization()
    }

    func startUpdating() {
        manager.startUpdatingLocation()
    }

    func requestLocation() {
        manager.requestLocation()
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        authorizationStatus = manager.authorizationStatus
        if authorizationStatus == .authorizedWhenInUse || authorizationStatus == .authorizedAlways {
            manager.requestLocation()
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        if let latest = locations.last {
            location = latest
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        #if DEBUG
        print("Location manager error", error.localizedDescription)
        #endif
    }
}
