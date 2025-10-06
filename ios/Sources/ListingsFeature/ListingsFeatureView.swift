import SwiftUI
import SharedServices
import DesignSystem

public struct ListingsFeatureView: View {
    @Environment(\.designSystem) private var designSystem
    @State private var listings: [Listing] = []
    @State private var isLoading = false
    @State private var isLoadingMore = false
    @State private var hasNextPage = false
    @State private var nextCursor: String?
    @State private var errorMessage: String?

    @State private var searchText = ""
    @State private var appliedSearch = ""
    @State private var locationDraft = ""
    @State private var appliedLocation = ""
    @State private var selectedSort: ListingsRequest.Sort = .newest

    @State private var selectedListing: Listing?
    @State private var showingSortSheet = false
    @State private var showingLocationSheet = false
    @State private var showingComposer = false

    @State private var searchDebounceTask: Task<Void, Never>?

    private let pageSize = 20
    private let listingsService: ListingsService
    private let capabilityEmitter: (String, [String: Any]) -> Void

    public init(listingsService: ListingsService, capabilityEmitter: @escaping (String, [String: Any]) -> Void = { _, _ in }) {
        self.listingsService = listingsService
        self.capabilityEmitter = capabilityEmitter
    }

    public var body: some View {
        NavigationStack {
            Group {
                if isLoading && listings.isEmpty {
                    ProgressView("Loading listings…")
                        .progressViewStyle(.circular)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let errorMessage, listings.isEmpty {
                    ContentUnavailableView("Unable to Load", systemImage: "exclamationmark.triangle", description: Text(errorMessage))
                } else {
                    listingsContent
                }
            }
            .navigationTitle("Listings")
            .navigationBarTitleDisplayMode(designSystem.enablesLargeTitles ? .large : .inline)
            .toolbar { toolbarContent }
            .searchable(text: $searchText, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search listings")
            .onSubmit(of: .search) {
                applySearchImmediately()
            }
            .onChange(of: searchText) { newValue in
                scheduleSearchDebounce(for: newValue)
            }
            .refreshable {
                await loadListings(reset: true)
            }
            .task {
                await loadListings(reset: true)
            }
            .sheet(item: $selectedListing) { listing in
                ListingDetailSheet(listing: listing)
            }
            .sheet(isPresented: $showingComposer) {
                NavigationStack {
                    AIComposerSheet()
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button("Done") { showingComposer = false }
                            }
                        }
                }
                .presentationDetents([.medium, .large])
            }
            .sheet(isPresented: $showingLocationSheet) {
                NavigationStack {
                    LocationFilterSheet(location: $locationDraft, onApply: {
                        appliedLocation = locationDraft
                        showingLocationSheet = false
                        Task { await loadListings(reset: true) }
                    }) {
                        showingLocationSheet = false
                    }
                }
            }
            .confirmationDialog("Sort Listings", isPresented: $showingSortSheet, titleVisibility: .visible) {
                ForEach(ListingsRequest.Sort.allCases) { sort in
                    Button(sort.displayName) {
                        guard selectedSort != sort else { return }
                        selectedSort = sort
                        Task { await loadListings(reset: true) }
                    }
                }
                Button("Cancel", role: .cancel) { }
            }
            .onDisappear {
                searchDebounceTask?.cancel()
            }
        }
    }

    private var listingsContent: some View {
        List {
            heroSection
                .listRowInsets(EdgeInsets())
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)

            filtersSection
                .listRowInsets(EdgeInsets())
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)

            ForEach(listings) { listing in
                ListItCard(title: listing.title, subtitle: listing.subtitle) {
                    VStack(alignment: .leading, spacing: designSystem.spacing.xSmall) {
                        if let formattedPrice = listing.formattedPrice {
                            Label(formattedPrice, systemImage: "tag")
                        }
                        if let location = listing.location, !location.isEmpty {
                            Label(location, systemImage: "mappin.and.ellipse")
                        }
                        Text("Powered by the shared core listings service.")
                            .foregroundStyle(.secondary)
                    }
                }
                .contentShape(Rectangle())
                .onTapGesture {
                    selectedListing = listing
                }
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    if designSystem.supportsSwipeActions {
                        Button {
                            capabilityEmitter("haptic", ["style": "impact.medium"])
                        } label: {
                            Label("Favorite", systemImage: "heart")
                        }
                        .tint(designSystem.colors.accent)
                    }
                }
                .onAppear {
                    if listing == listings.last {
                        Task { await loadListings(reset: false) }
                    }
                }
                .padding(.top, designSystem.spacing.small)
            }

            if isLoadingMore {
                loadingMoreRow
            } else if hasNextPage {
                loadMoreButton
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(designSystem.colors.background)
    }

    private var filtersSection: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: designSystem.spacing.small) {
                FilterPill(title: selectedSort.displayName, icon: "arrow.up.arrow.down", isActive: selectedSort != .newest) {
                    showingSortSheet = true
                }

                FilterPill(title: appliedLocation.isEmpty ? "Location" : appliedLocation, icon: "mappin.and.line.dotted.tshape", isActive: !appliedLocation.isEmpty) {
                    locationDraft = appliedLocation
                    showingLocationSheet = true
                }

                if !appliedSearch.isEmpty || !appliedLocation.isEmpty || selectedSort != .newest {
                    FilterPill(title: "Reset", icon: "arrow.counterclockwise", isActive: true) {
                        resetFilters()
                    }
                }
            }
            .padding(.horizontal, designSystem.spacing.medium)
            .padding(.vertical, designSystem.spacing.small)
        }
    }

    private var loadingMoreRow: some View {
        HStack {
            Spacer()
            ProgressView("Loading more…")
                .progressViewStyle(.circular)
            Spacer()
        }
        .padding(.vertical, designSystem.spacing.medium)
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
    }

    private var loadMoreButton: some View {
        HStack {
            Spacer()
            Button {
                Task { await loadListings(reset: false) }
            } label: {
                Label("Load more results", systemImage: "ellipsis.circle")
            }
            .buttonStyle(.plain)
            Spacer()
        }
        .padding(.vertical, designSystem.spacing.medium)
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
    }

    private var heroSection: some View {
        ListingsHeroBanner(isRefreshing: isLoading) {
            capabilityEmitter("haptic", ["style": "notification.success"])
            Task { await loadListings(reset: true) }
        }
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button {
                showingComposer = true
            } label: {
                Label("AI Draft", systemImage: "sparkles")
            }
        }
    }
}

private extension ListingsFeatureView {
    @MainActor
    func loadListings(reset: Bool) async {
        if reset {
            guard !isLoading else { return }
            isLoading = true
            isLoadingMore = false
            errorMessage = nil
        } else {
            guard hasNextPage, !isLoadingMore else { return }
            isLoadingMore = true
        }

        let request = ListingsRequest(
            query: appliedSearch,
            location: appliedLocation,
            sort: selectedSort,
            limit: pageSize,
            cursor: reset ? nil : nextCursor
        )

        do {
            let page = try await listingsService.fetchListings(request: request)
            let mapped = page.listings.map(Listing.init(summary:))
            if reset {
                listings = mapped
            } else {
                let existingIDs = Set(listings.map { $0.id })
                listings.append(contentsOf: mapped.filter { !existingIDs.contains($0.id) })
            }
            nextCursor = page.nextCursor
            hasNextPage = page.hasNext
            errorMessage = nil
        } catch {
            if listings.isEmpty {
                errorMessage = error.localizedDescription
            }
        }

        if reset {
            isLoading = false
        } else {
            isLoadingMore = false
        }
    }

    func applySearchImmediately() {
        searchDebounceTask?.cancel()
        if appliedSearch != searchText {
            appliedSearch = searchText
            Task { await loadListings(reset: true) }
        }
    }

    func scheduleSearchDebounce(for text: String) {
        searchDebounceTask?.cancel()
        searchDebounceTask = Task {
            try? await Task.sleep(nanoseconds: 450_000_000)
            guard !Task.isCancelled else { return }
            await MainActor.run {
                if appliedSearch != text {
                    appliedSearch = text
                    Task { await loadListings(reset: true) }
                }
            }
        }
    }

    func resetFilters() {
        searchDebounceTask?.cancel()
        searchText = ""
        appliedSearch = ""
        appliedLocation = ""
        selectedSort = .newest
        Task { await loadListings(reset: true) }
    }
}

private extension ListingsFeatureView {
    struct Listing: Identifiable, Equatable {
        let id: String
        let title: String
        let subtitle: String
        let price: Double?
        let location: String?

        init(id: String, title: String, subtitle: String, price: Double?, location: String?) {
            self.id = id
            self.title = title
            self.subtitle = subtitle
            self.price = price
            self.location = location
        }

        init(summary: ListingSummary) {
            self.init(id: summary.id, title: summary.title, subtitle: summary.subtitle, price: summary.price, location: summary.location)
        }

        var formattedPrice: String? {
            guard let price else { return nil }
            return ListingsFeatureView.priceFormatter.string(from: NSNumber(value: price))
        }
    }

    static let priceFormatter: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.maximumFractionDigits = 2
        formatter.minimumFractionDigits = 0
        return formatter
    }()
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
                Text("Powerful Native Listings")
                    .font(designSystem.typography.largeTitle)
                    .foregroundStyle(designSystem.colors.onPrimary)

                Text("Search, filter, and page through the shared listings feed with SwiftUI-native controls that mirror the web experience.")
                    .font(designSystem.typography.body)
                    .foregroundStyle(designSystem.colors.onPrimary.opacity(0.85))

                Button {
                    refreshAction()
                } label: {
                    Label(isRefreshing ? "Refreshing…" : "Refresh feed", systemImage: "arrow.triangle.2.circlepath")
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

private struct ListingDetailSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.designSystem) private var designSystem

    let listing: ListingsFeatureView.Listing

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: designSystem.spacing.large) {
                Text(listing.title)
                    .font(designSystem.typography.largeTitle)
                    .foregroundStyle(designSystem.colors.onBackground)

                VStack(alignment: .leading, spacing: designSystem.spacing.small) {
                    if let formattedPrice = listing.formattedPrice {
                        Label(formattedPrice, systemImage: "tag")
                    }
                    if let location = listing.location, !location.isEmpty {
                        Label(location, systemImage: "mappin.and.ellipse")
                    }
                    if !listing.subtitle.isEmpty {
                        Text(listing.subtitle)
                            .font(designSystem.typography.body)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                Text("This preview uses shared-core metadata so the native detail view always matches the React implementation, including price formatting and location context.")
                    .font(designSystem.typography.callout)
                    .foregroundStyle(.secondary)
            }
            .padding(designSystem.spacing.large)
        }
        .background(designSystem.colors.background)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Done") { dismiss() }
            }
        }
    }
}

private struct AIComposerSheet: View {
    @Environment(\.designSystem) private var designSystem
    @State private var prompt: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: designSystem.spacing.medium) {
            Text("AI-assisted Listing Draft")
                .font(designSystem.typography.title)

            Text("Describe what you want to sell and we will prefill the native composer using the shared AI helpers. This stub mirrors the upcoming integration point.")
                .font(designSystem.typography.body)
                .foregroundStyle(.secondary)

            TextEditor(text: $prompt)
                .padding(8)
                .frame(minHeight: 160)
                .background(
                    RoundedRectangle(cornerRadius: designSystem.corners.small, style: .continuous)
                        .fill(designSystem.colors.surface)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: designSystem.corners.small, style: .continuous)
                        .stroke(designSystem.colors.onSurface.opacity(0.1), lineWidth: 1)
                )

            Button {
                // future: trigger shared-core AI helpers
            } label: {
                Label("Generate draft", systemImage: "wand.and.stars")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(ListItPrimaryButtonStyle())
            .disabled(prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            Spacer(minLength: 0)
        }
        .padding(designSystem.spacing.large)
        .background(designSystem.colors.background)
    }
}

private struct LocationFilterSheet: View {
    @Environment(\.designSystem) private var designSystem
    @FocusState private var isFocused: Bool

    @Binding var location: String
    let onApply: () -> Void
    let onCancel: () -> Void

    var body: some View {
        Form {
            Section("Location") {
                TextField("City, region, or ZIP", text: $location)
                    .focused($isFocused)
            }
        }
        .navigationTitle("Location Filter")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel", action: onCancel)
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Apply", action: onApply)
            }
        }
        .onAppear {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                isFocused = true
            }
        }
    }
}
