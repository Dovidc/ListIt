import SwiftUI
import SharedServices
import DesignSystem

public struct ListingsFeatureView: View {
    @Environment(\.designSystem) private var designSystem
    @StateObject private var viewModel: ListingsViewModel
    @State private var composerMode: ListingComposerView.Mode?
    @State private var showingMassList = false
    private let listingsService: ListingsService
    private let uploadService: UploadService
    private let capabilityEmitter: (String, [String: Any]) -> Void

    public init(listingsService: ListingsService,
                uploadService: UploadService,
                capabilityEmitter: @escaping (String, [String: Any]) -> Void = { _, _ in }) {
        _viewModel = StateObject(wrappedValue: ListingsViewModel(service: listingsService))
        self.listingsService = listingsService
        self.uploadService = uploadService
        self.capabilityEmitter = capabilityEmitter
    }

    public var body: some View {
        NavigationStack {
            content
                .navigationTitle("Listings")
                .navigationBarTitleDisplayMode(designSystem.enablesLargeTitles ? .large : .inline)
                .background(designSystem.colors.background.ignoresSafeArea())
                .toolbar { toolbar }
                .task { await viewModel.loadInitial() }
                .sheet(item: $viewModel.presentedListing, onDismiss: { viewModel.clearPresentedListing() }) { listing in
                    ListingDetailSheet(
                        listing: listing,
                        onToggleFavorite: { toggleFavorite(for: listing) },
                        onSelectCover: { image in viewModel.updateCover(image, for: listing) },
                        onEdit: {
                            capabilityEmitter("haptic", ["style": "impact.soft"])
                            viewModel.presentedListing = nil
                            composerMode = .edit(listing)
                        },
                        capabilityEmitter: capabilityEmitter
                    )
                }
                .sheet(item: $composerMode) { mode in
                    ListingComposerView(
                        mode: mode,
                        listingsService: listingsService,
                        uploadService: uploadService
                    ) { listing in
                        capabilityEmitter("haptic", ["style": "notification.success"])
                        viewModel.upsert(listing)
                    }
                }
                .sheet(isPresented: $showingMassList) {
                    MassListView(
                        listingsService: listingsService,
                        uploadService: uploadService
                    ) { outcome in
                        if outcome.created > 0 {
                            capabilityEmitter("haptic", ["style": "notification.success"])
                        }
                        Task { await viewModel.refresh(reloading: true) }
                    }
                }
        }
    }

    private var content: some View {
        Group {
            switch viewModel.state {
            case .idle, .loading where viewModel.displayedListings.isEmpty:
                loadingState
            case .failed(let message) where viewModel.displayedListings.isEmpty:
                ContentUnavailableView(
                    "Unable to load",
                    systemImage: "exclamationmark.triangle",
                    description: Text(message)
                )
                .padding()
            default:
                ScrollView {
                    LazyVStack(spacing: designSystem.spacing.large, pinnedViews: []) {
                        ListingsHeroBanner(isRefreshing: viewModel.isRefreshing) {
                            capabilityEmitter("haptic", ["style": "notification.success"])
                            Task { await viewModel.refresh() }
                        }
                        FiltersPanel(viewModel: viewModel)
                        listingsSection
                    }
                    .padding(.horizontal, designSystem.spacing.medium)
                    .padding(.vertical, designSystem.spacing.large)
                }
                .scrollDismissesKeyboard(.immediately)
                .refreshable { await viewModel.refresh() }
            }
        }
    }

    private var listingsSection: some View {
        Group {
            if viewModel.displayedListings.isEmpty {
                ContentUnavailableView(
                    "No listings match",
                    systemImage: "magnifyingglass",
                    description: Text("Try broadening your search, adjusting filters, or clearing selected tags.")
                )
                .padding()
            } else {
                LazyVStack(spacing: designSystem.spacing.medium) {
                    ForEach(viewModel.displayedListings) { listing in
                        ListingCardView(
                            listing: listing,
                            onTap: {
                                viewModel.present(listing)
                                capabilityEmitter("haptic", ["style": "impact.light"])
                            },
                            onToggleFavorite: {
                                toggleFavorite(for: listing)
                            }
                        )
                        .onAppear {
                            Task { await viewModel.loadMoreIfNeeded(current: listing) }
                        }
                    }

                    if viewModel.isLoadingNextPage {
                        ProgressView()
                            .padding(.vertical, designSystem.spacing.medium)
                    }
                }
            }
        }
    }

    private var loadingState: some View {
        VStack(spacing: designSystem.spacing.medium) {
            ProgressView()
            Text("Loading marketplace…")
                .font(designSystem.typography.callout)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .navigationBarTrailing) {
            if viewModel.state.isLoaded {
                Menu {
                    Button {
                        composerMode = .create
                    } label: {
                        Label("Create listing", systemImage: "square.and.pencil")
                    }

                    Button {
                        showingMassList = true
                    } label: {
                        Label("Mass list", systemImage: "rectangle.stack.badge.plus")
                    }
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("Compose listing")
            }
        }
        ToolbarItem(placement: .navigationBarTrailing) {
            if viewModel.state.isLoaded {
                Menu {
                    Button(role: .destructive) {
                        viewModel.resetFilters()
                        capabilityEmitter("haptic", ["style": "impact.soft"])
                    } label: {
                        Label("Reset Filters", systemImage: "arrow.uturn.left")
                    }
                } label: {
                    Image(systemName: "slider.horizontal.3")
                        .imageScale(.medium)
                }
                .accessibilityLabel("Filter options")
            }
        }
    }

    private func toggleFavorite(for listing: ListingSummary) {
        let willFavorite = !listing.isFavorite
        capabilityEmitter("haptic", ["style": willFavorite ? "notification.success" : "impact.light"])
        viewModel.toggleFavorite(for: listing)
    }
}

@MainActor
private final class ListingsViewModel: ObservableObject {
    enum LoadingState: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)

        var isLoaded: Bool {
            if case .loaded = self { return true }
            return false
        }
    }

    @Published private(set) var state: LoadingState = .idle
    @Published private(set) var displayedListings: [ListingSummary] = []
    @Published private(set) var availableTags: [String] = []
    @Published private(set) var isLoadingNextPage = false
    @Published private(set) var isRefreshing = false
    @Published var searchTerm: String = "" {
        didSet { applyFilters() }
    }
    @Published var locationTerm: String = "" {
        didSet { applyFilters() }
    }
    @Published var showFavoritesOnly = false {
        didSet { applyFilters() }
    }
    @Published var showBoostedOnly = false {
        didSet { applyFilters() }
    }
    @Published var includePhotosOnly = false {
        didSet { applyFilters() }
    }
    @Published var selectedPriceFilter: PriceFilter = .all {
        didSet { applyFilters() }
    }
    @Published var selectedSort: ListingsSort = .newest {
        didSet {
            Task { await refresh(reloading: true) }
        }
    }
    @Published var selectedTags: Set<String> = [] {
        didSet { applyFilters() }
    }
    @Published var presentedListing: ListingSummary?

    private let service: ListingsService
    private var allListings: [ListingSummary] = []
    private var nextCursor: String?
    private var hasNextPage = false

    init(service: ListingsService) {
        self.service = service
    }

    func loadInitial() async {
        guard state == .idle else { return }
        await refresh()
    }

    func refresh(reloading: Bool = false) async {
        if reloading {
            state = .loading
        }
        isRefreshing = true
        do {
            let page = try await service.fetchListings(query: currentQuery, cursor: nil, limit: 30)
            allListings = page.listings
            hasNextPage = page.hasNext
            nextCursor = page.nextCursor
            updateAvailableTags()
            applyFilters(animate: reloading)
            state = .loaded
        } catch {
            state = .failed(error.localizedDescription)
        }
        isRefreshing = false
    }

    func loadMoreIfNeeded(current listing: ListingSummary) async {
        guard hasNextPage, !isLoadingNextPage else { return }
        guard let index = displayedListings.firstIndex(where: { $0.id == listing.id }) else { return }
        let threshold = max(displayedListings.count - 5, 0)
        guard index >= threshold else { return }

        isLoadingNextPage = true
        do {
            let page = try await service.fetchListings(query: currentQuery, cursor: nextCursor, limit: 30)
            allListings.append(contentsOf: page.listings)
            hasNextPage = page.hasNext
            nextCursor = page.nextCursor
            updateAvailableTags()
            applyFilters()
        } catch {
            state = .failed(error.localizedDescription)
        }
        isLoadingNextPage = false
    }

    func toggleFavorite(for listing: ListingSummary) {
        let newValue = !listing.isFavorite
        allListings = allListings.map { item in
            item.id == listing.id ? item.updatingFavorite(newValue) : item
        }
        applyFilters()
        if presentedListing?.id == listing.id {
            presentedListing = presentedListing?.updatingFavorite(newValue)
        }
    }

    func upsert(_ listing: ListingSummary) {
        if let index = allListings.firstIndex(where: { $0.id == listing.id }) {
            allListings[index] = listing
        } else {
            allListings.insert(listing, at: 0)
        }
        updateAvailableTags()
        applyFilters(animate: true)
    }

    func updateCover(_ image: ListingSummary.GalleryImage, for listing: ListingSummary) {
        allListings = allListings.map { item in
            item.id == listing.id ? item.updatingCoverImage(image.url) : item
        }
        applyFilters()
        if presentedListing?.id == listing.id {
            presentedListing = presentedListing?.updatingCoverImage(image.url)
        }
    }

    func present(_ listing: ListingSummary) {
        presentedListing = listing
    }

    func clearPresentedListing() {
        if let presented = presentedListing {
            presentedListing = allListings.first(where: { $0.id == presented.id }) ?? presented
        }
    }

    func toggleTag(_ tag: String) {
        if selectedTags.contains(tag) {
            selectedTags.remove(tag)
        } else {
            selectedTags.insert(tag)
        }
    }

    func resetFilters() {
        searchTerm = ""
        locationTerm = ""
        showFavoritesOnly = false
        showBoostedOnly = false
        includePhotosOnly = false
        selectedPriceFilter = .all
        selectedTags = []
        Task { await refresh(reloading: true) }
    }

    private var currentQuery: ListingsQuery {
        ListingsQuery(search: searchTerm, location: locationTerm, sort: selectedSort)
    }

    private func applyFilters(animate: Bool = false) {
        var results = allListings

        if showFavoritesOnly {
            results = results.filter { $0.isFavorite }
        }

        if showBoostedOnly {
            results = results.filter { $0.isBoosted }
        }

        if includePhotosOnly {
            results = results.filter { $0.coverImageURL != nil || !$0.galleryImages.isEmpty }
        }

        switch selectedPriceFilter {
        case .all:
            break
        case .free:
            results = results.filter { ($0.price ?? 0) == 0 }
        case .under50, .under100, .under250, .under500:
            if let range = selectedPriceFilter.range {
                results = results.filter { listing in
                    guard let price = listing.price else { return false }
                    return range.contains(price)
                }
            }
        }

        if !selectedTags.isEmpty {
            let tagSet = Set(selectedTags.map { $0.lowercased() })
            results = results.filter { listing in
                let listingTags = Set(listing.tags.map { $0.lowercased() })
                return !listingTags.isDisjoint(with: tagSet)
            }
        }

        let search = searchTerm.trimmingCharacters(in: .whitespacesAndNewlines)
        if !search.isEmpty {
            let query = search.lowercased()
            results = results.filter { listing in
                listing.title.lowercased().contains(query) ||
                listing.subtitle.lowercased().contains(query) ||
                listing.description.lowercased().contains(query) ||
                listing.tags.contains { $0.lowercased().contains(query) }
            }
        }

        let locationFilter = locationTerm.trimmingCharacters(in: .whitespacesAndNewlines)
        if !locationFilter.isEmpty {
            let needle = locationFilter.lowercased()
            results = results.filter { listing in
                listing.location?.lowercased().contains(needle) ?? false
            }
        }

        results = sort(results, using: selectedSort)

        if animate {
            withAnimation(.spring(response: 0.35, dampingFraction: 0.9)) {
                displayedListings = results
            }
        } else {
            displayedListings = results
        }
    }

    private func sort(_ listings: [ListingSummary], using sort: ListingsSort) -> [ListingSummary] {
        switch sort {
        case .newest:
            return listings.sorted { lhs, rhs in
                (lhs.createdAt ?? .distantPast) > (rhs.createdAt ?? .distantPast)
            }
        case .priceLow:
            return listings.sorted { lhs, rhs in
                guard let left = lhs.price else { return false }
                guard let right = rhs.price else { return true }
                return left < right
            }
        case .priceHigh:
            return listings.sorted { lhs, rhs in
                guard let left = lhs.price else { return false }
                guard let right = rhs.price else { return true }
                return left > right
            }
        case .nearby:
            return listings.sorted { lhs, rhs in
                guard let left = lhs.distanceMeters else { return false }
                guard let right = rhs.distanceMeters else { return true }
                return left < right
            }
        }
    }

    private func updateAvailableTags() {
        let counts = allListings
            .flatMap { $0.tags }
            .reduce(into: [String: Int]()) { partialResult, tag in
                let key = tag.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !key.isEmpty else { return }
                partialResult[key, default: 0] += 1
            }

        availableTags = counts
            .sorted { lhs, rhs in lhs.value == rhs.value ? lhs.key < rhs.key : lhs.value > rhs.value }
            .prefix(8)
            .map(\.key)
    }
}

private enum PriceFilter: String, CaseIterable, Identifiable {
    case all
    case free
    case under50
    case under100
    case under250
    case under500

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "Any price"
        case .free: return "Free"
        case .under50: return "Under $50"
        case .under100: return "Under $100"
        case .under250: return "Under $250"
        case .under500: return "Under $500"
        }
    }

    var range: ClosedRange<Double>? {
        switch self {
        case .all:
            return nil
        case .free:
            return 0...0
        case .under50:
            return 0...50
        case .under100:
            return 0...100
        case .under250:
            return 0...250
        case .under500:
            return 0...500
        }
    }
}

private struct FiltersPanel: View {
    @Environment(\.designSystem) private var designSystem
    @ObservedObject var viewModel: ListingsViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: designSystem.spacing.medium) {
            searchRow
            filterToggles
            tagPicker
            sortRow
            Text(resultSummary)
                .font(designSystem.typography.callout)
                .foregroundStyle(.secondary)
        }
        .padding(designSystem.spacing.large)
        .background(
            RoundedRectangle(cornerRadius: designSystem.corners.large, style: .continuous)
                .fill(designSystem.colors.surface)
                .shadow(color: designSystem.colors.onSurface.opacity(0.06), radius: 20, y: 12)
        )
    }

    private var searchRow: some View {
        VStack(alignment: .leading, spacing: designSystem.spacing.small) {
            HStack(spacing: designSystem.spacing.medium) {
                LabeledField(title: "Search") {
                    TextField("What are you looking for?", text: $viewModel.searchTerm)
                        .textFieldStyle(.roundedBorder)
                        .submitLabel(.search)
                        .onSubmit { Task { await viewModel.refresh(reloading: true) } }
                }

                LabeledField(title: "Location") {
                    TextField("City or zip", text: $viewModel.locationTerm)
                        .textFieldStyle(.roundedBorder)
                        .submitLabel(.search)
                        .onSubmit { Task { await viewModel.refresh(reloading: true) } }
                }
            }

            Button {
                Task { await viewModel.refresh(reloading: true) }
            } label: {
                Label("Apply search", systemImage: "magnifyingglass")
                    .font(designSystem.typography.callout)
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(ListItPrimaryButtonStyle())
        }
    }

    private var filterToggles: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: designSystem.spacing.small) {
                FilterChip(
                    title: "Favorites",
                    systemImage: "heart.fill",
                    isSelected: viewModel.showFavoritesOnly
                ) {
                    viewModel.showFavoritesOnly.toggle()
                }

                FilterChip(
                    title: "Boosted",
                    systemImage: "bolt.fill",
                    isSelected: viewModel.showBoostedOnly
                ) {
                    viewModel.showBoostedOnly.toggle()
                }

                FilterChip(
                    title: "With photos",
                    systemImage: "photo.on.rectangle",
                    isSelected: viewModel.includePhotosOnly
                ) {
                    viewModel.includePhotosOnly.toggle()
                }

                Menu {
                    ForEach(PriceFilter.allCases) { filter in
                        Button {
                            viewModel.selectedPriceFilter = filter
                        } label: {
                            if filter == viewModel.selectedPriceFilter {
                                Label(filter.title, systemImage: "checkmark")
                            } else {
                                Text(filter.title)
                            }
                        }
                    }
                } label: {
                    Label(viewModel.selectedPriceFilter.title, systemImage: "tag")
                        .padding(.vertical, designSystem.spacing.xSmall)
                        .padding(.horizontal, designSystem.spacing.small)
                        .background(
                            Capsule().fill(designSystem.colors.surface.opacity(0.9))
                        )
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var tagPicker: some View {
        Group {
            if viewModel.availableTags.isEmpty {
                EmptyView()
            } else {
                VStack(alignment: .leading, spacing: designSystem.spacing.small) {
                    Text("Popular tags")
                        .font(designSystem.typography.subheadline)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: designSystem.spacing.small) {
                            ForEach(viewModel.availableTags, id: \.self) { tag in
                                FilterChip(
                                    title: tag,
                                    systemImage: "number",
                                    isSelected: viewModel.selectedTags.contains(tag)
                                ) {
                                    viewModel.toggleTag(tag)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private var sortRow: some View {
        VStack(alignment: .leading, spacing: designSystem.spacing.small) {
            Text("Sort by")
                .font(designSystem.typography.subheadline)
            Picker("Sort", selection: $viewModel.selectedSort) {
                ForEach(ListingsSort.allCases, id: \.self) { sort in
                    Text(sort.title).tag(sort)
                }
            }
            .pickerStyle(.segmented)
        }
    }

    private var resultSummary: String {
        let count = viewModel.displayedListings.count
        if count == 0 { return "Showing 0 listings" }
        return "Showing \(count) listing\(count == 1 ? "" : "s")"
    }
}

private struct LabeledField<Content: View>: View {
    @Environment(\.designSystem) private var designSystem
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: designSystem.spacing.xSmall) {
            Text(title)
                .font(designSystem.typography.caption)
                .foregroundStyle(.secondary)
            content
        }
    }
}

private struct FilterChip: View {
    @Environment(\.designSystem) private var designSystem
    let title: String
    let systemImage: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: designSystem.spacing.xSmall) {
                Image(systemName: systemImage)
                    .imageScale(.small)
                Text(title)
                    .font(designSystem.typography.callout)
            }
            .padding(.vertical, designSystem.spacing.xSmall)
            .padding(.horizontal, designSystem.spacing.small)
            .background(
                Capsule()
                    .fill(isSelected ? designSystem.colors.accent.opacity(0.2) : designSystem.colors.surface.opacity(0.92))
            )
            .overlay(
                Capsule()
                    .stroke(isSelected ? designSystem.colors.accent : designSystem.colors.surface.opacity(0.6), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .foregroundStyle(isSelected ? designSystem.colors.accent : designSystem.colors.onSurface)
    }
}

private struct ListingCardView: View {
    @Environment(\.designSystem) private var designSystem
    let listing: ListingSummary
    let onTap: () -> Void
    let onToggleFavorite: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: designSystem.spacing.medium) {
                ZStack(alignment: .topTrailing) {
                    listingImage
                    VStack(alignment: .trailing, spacing: designSystem.spacing.xSmall) {
                        if listing.isBoosted {
                            TagPill(text: "Boosted", tint: designSystem.colors.accent)
                        }
                        favoriteButton
                    }
                    .padding(designSystem.spacing.small)
                }

                VStack(alignment: .leading, spacing: designSystem.spacing.xSmall) {
                    HStack {
                        if let price = listing.priceText {
                            Text(price)
                                .font(designSystem.typography.headline)
                        }
                        if listing.isSold {
                            TagPill(text: "Sold", tint: designSystem.colors.success)
                        }
                    }

                    Text(listing.title)
                        .font(designSystem.typography.title3)
                        .foregroundStyle(designSystem.colors.onSurface)

                    if let location = listing.location, !location.isEmpty {
                        Text(location)
                            .font(designSystem.typography.callout)
                            .foregroundStyle(.secondary)
                    }

                    if let distance = listing.distanceText, !distance.isEmpty {
                        Text(distance)
                            .font(designSystem.typography.caption)
                            .foregroundStyle(designSystem.colors.accent)
                    }

                    if !listing.tags.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: designSystem.spacing.xSmall) {
                    ForEach(listing.tags.prefix(4), id: \.self) { tag in
                        TagPill(text: tag, tint: designSystem.colors.accent)
                        }
                    }
                        }
                    }
                }
            }
            .padding(designSystem.spacing.medium)
            .background(
                RoundedRectangle(cornerRadius: designSystem.corners.large, style: .continuous)
                    .fill(designSystem.colors.surface)
                    .shadow(color: designSystem.colors.onSurface.opacity(0.06), radius: 16, y: 8)
            )
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var listingImage: some View {
        if let url = listing.coverImageURL {
            AsyncImage(url: url) { phase in
                switch phase {
                case .empty:
                    placeholderImage
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFill()
                case .failure:
                    placeholderImage
                @unknown default:
                    placeholderImage
                }
            }
            .frame(height: 180)
            .frame(maxWidth: .infinity)
            .clipped()
            .clipShape(RoundedRectangle(cornerRadius: designSystem.corners.large, style: .continuous))
        } else {
            placeholderImage
                .frame(height: 180)
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: designSystem.corners.large, style: .continuous))
        }
    }

    private var placeholderImage: some View {
        ZStack {
            RoundedRectangle(cornerRadius: designSystem.corners.large, style: .continuous)
                .fill(designSystem.colors.surface.opacity(0.4))
            VStack(spacing: designSystem.spacing.small) {
                Image(systemName: "photo")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(.secondary)
                Text("No cover image")
                    .font(designSystem.typography.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var favoriteButton: some View {
        Button(action: onToggleFavorite) {
            Image(systemName: listing.isFavorite ? "heart.fill" : "heart")
                .imageScale(.medium)
                .foregroundStyle(listing.isFavorite ? designSystem.colors.accent : designSystem.colors.onSurface)
                .padding(8)
                .background(
                    Circle().fill(designSystem.colors.background.opacity(0.85))
                )
        }
        .buttonStyle(.plain)
    }
}

private struct TagPill: View {
    @Environment(\.designSystem) private var designSystem
    let text: String
    let tint: Color

    var body: some View {
        Text(text)
            .font(designSystem.typography.caption)
            .padding(.horizontal, designSystem.spacing.small)
            .padding(.vertical, designSystem.spacing.xSmall)
            .background(
                Capsule().fill(tint.opacity(0.18))
            )
            .foregroundStyle(tint)
    }
}

private struct ListingDetailSheet: View {
    @Environment(\.designSystem) private var designSystem
    @Environment(\.dismiss) private var dismiss
    let listing: ListingSummary
    let onToggleFavorite: () -> Void
    let onSelectCover: (ListingSummary.GalleryImage) -> Void
    let onEdit: () -> Void
    let capabilityEmitter: (String, [String: Any]) -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: designSystem.spacing.large) {
                    gallerySection
                    overviewSection
                    metadataSection
                    actionSection
                }
                    .padding(.horizontal, designSystem.spacing.large)
                    .padding(.bottom, designSystem.spacing.xLarge)
            }
            .background(designSystem.colors.background.ignoresSafeArea())
            .navigationTitle(listing.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        onToggleFavorite()
                    } label: {
                        Image(systemName: listing.isFavorite ? "heart.fill" : "heart")
                            .foregroundStyle(listing.isFavorite ? designSystem.colors.accent : designSystem.colors.onSurface)
                    }
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private var gallerySection: some View {
        VStack(alignment: .leading, spacing: designSystem.spacing.small) {
            if listing.galleryImages.isEmpty, let cover = listing.coverImageURL {
                AsyncImage(url: cover) { phase in
                    switch phase {
                    case .empty:
                        Color.secondary.opacity(0.1)
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFit()
                    case .failure:
                        Color.secondary.opacity(0.1)
                    @unknown default:
                        Color.secondary.opacity(0.1)
                    }
                }
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: designSystem.corners.large, style: .continuous))
            } else if !listing.galleryImages.isEmpty {
                TabView {
                    ForEach(listing.galleryImages, id: \.url) { image in
                        ZStack(alignment: .bottom) {
                            AsyncImage(url: image.url) { phase in
                                switch phase {
                                case .empty:
                                    Color.secondary.opacity(0.1)
                                case .success(let imageView):
                                    imageView
                                        .resizable()
                                        .scaledToFit()
                                case .failure:
                                    Color.secondary.opacity(0.1)
                                @unknown default:
                                    Color.secondary.opacity(0.1)
                                }
                            }
                            .frame(maxWidth: .infinity)

                            Button {
                                capabilityEmitter("haptic", ["style": "impact.light"])
                                onSelectCover(image)
                            } label: {
                                Label("Set as cover", systemImage: "star.fill")
                                    .font(designSystem.typography.caption)
                                    .padding(.horizontal, designSystem.spacing.small)
                                    .padding(.vertical, designSystem.spacing.xSmall)
                                    .background(
                                        Capsule().fill(designSystem.colors.surface.opacity(0.85))
                                    )
                            }
                            .buttonStyle(.plain)
                            .padding(designSystem.spacing.small)
                        }
                        .clipShape(RoundedRectangle(cornerRadius: designSystem.corners.large, style: .continuous))
                        .padding(.vertical, designSystem.spacing.xSmall)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .automatic))
                .frame(height: 260)
            } else {
                Color.secondary.opacity(0.1)
                    .frame(height: 180)
                    .frame(maxWidth: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: designSystem.corners.large, style: .continuous))
                    .overlay(
                        Text("No media available")
                            .font(designSystem.typography.callout)
                            .foregroundStyle(.secondary)
                    )
            }
        }
    }

    private var overviewSection: some View {
        VStack(alignment: .leading, spacing: designSystem.spacing.small) {
            if let price = listing.priceText {
                Text(price)
                    .font(designSystem.typography.largeTitle)
                    .fontWeight(.bold)
            }

            if let location = listing.location {
                Label(location, systemImage: "mappin.and.ellipse")
                    .font(designSystem.typography.body)
                    .foregroundStyle(.secondary)
            }

            if let distance = listing.distanceText, !distance.isEmpty {
                Label(distance, systemImage: "location.north")
                    .font(designSystem.typography.body)
                    .foregroundStyle(designSystem.colors.accent)
            }

            if !listing.description.isEmpty {
                Text(listing.description)
                    .font(designSystem.typography.body)
                    .foregroundStyle(designSystem.colors.onSurface)
                    .padding(.top, designSystem.spacing.small)
            }
        }
    }

    private var metadataSection: some View {
        VStack(alignment: .leading, spacing: designSystem.spacing.small) {
            if let seller = listing.sellerName {
                Label(seller, systemImage: "person.crop.circle")
                    .font(designSystem.typography.callout)
            }

            if let created = listing.createdAt {
                Text("Posted \(formattedDate(created))")
                    .font(designSystem.typography.caption)
                    .foregroundStyle(.secondary)
            }

            if !listing.tags.isEmpty {
                Text("Tags")
                    .font(designSystem.typography.subheadline)
                    .padding(.top, designSystem.spacing.medium)
                WrapLayout(items: listing.tags) { tag in
                    TagPill(text: tag, tint: designSystem.colors.accent)
                }
            }
        }
    }

    private var actionSection: some View {
        VStack(spacing: designSystem.spacing.small) {
            Button {
                dismiss()
                onEdit()
            } label: {
                Label("Edit listing", systemImage: "square.and.pencil")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(ListItSecondaryButtonStyle())

            Button {
                capabilityEmitter("haptic", ["style": "notification.success"])
            } label: {
                Label("Share listing", systemImage: "square.and.arrow.up")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(ListItSecondaryButtonStyle())

            Button {
                capabilityEmitter("haptic", ["style": "impact.medium"])
            } label: {
                Label("Message seller", systemImage: "paperplane.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(ListItPrimaryButtonStyle())
        }
    }

    private func formattedDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        return formatter.string(from: date)
    }
}

private struct WrapLayout<Item: Hashable, Content: View>: View {
    @Environment(\.designSystem) private var designSystem
    let items: [Item]
    let content: (Item) -> Content

    var body: some View {
        GeometryReader { geometry in
            generateContent(in: geometry)
        }
        .frame(minHeight: 0)
    }

    private func generateContent(in geometry: GeometryProxy) -> some View {
        var width: CGFloat = 0
        var height: CGFloat = 0
        let itemSpacing = designSystem.spacing.xSmall

        return ZStack(alignment: .topLeading) {
            ForEach(items, id: \.self) { item in
                content(item)
                    .alignmentGuide(.leading) { dimension in
                        if width + dimension.width > geometry.size.width {
                            width = 0
                            height -= dimension.height + itemSpacing
                        }
                        let result = width
                        width += dimension.width + itemSpacing
                        return result
                    }
                    .alignmentGuide(.top) { dimension in
                        let result = height
                        if item == items.last {
                            width = 0
                            height = 0
                        }
                        return result
                    }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct ListingsHeroBanner: View {
    @Environment(\.designSystem) private var designSystem
    @State private var animateOverlay = false
    let isRefreshing: Bool
    let refreshAction: () -> Void
    private let highlights = [
        "Search & filter across shared-core data",
        "Infinite scroll powered by shared pagination",
        "Detail sheets with gallery & native actions"
    ]

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

            VStack(alignment: .leading, spacing: designSystem.spacing.medium) {
                Text("Native Listings Hub")
                    .font(designSystem.typography.largeTitle)
                    .fontWeight(.bold)
                    .foregroundStyle(designSystem.colors.onPrimary)

                VStack(alignment: .leading, spacing: designSystem.spacing.xSmall) {
                    ForEach(highlights, id: \.self) { highlight in
                        Label(highlight, systemImage: "checkmark.seal.fill")
                            .font(designSystem.typography.callout)
                            .foregroundStyle(designSystem.colors.onPrimary.opacity(0.85))
                    }
                }

                Button(action: refreshAction) {
                    Label(isRefreshing ? "Refreshing…" : "Reload listings", systemImage: "arrow.triangle.2.circlepath")
                        .font(designSystem.typography.callout)
                        .padding(.vertical, designSystem.spacing.xSmall)
                        .padding(.horizontal, designSystem.spacing.medium)
                        .background(
                            Capsule().fill(designSystem.colors.onPrimary.opacity(0.18))
                        )
                        .overlay(
                            Capsule().stroke(designSystem.colors.onPrimary.opacity(0.35), lineWidth: 1)
                        )
                        .foregroundStyle(designSystem.colors.onPrimary)
                }
                .buttonStyle(.plain)
                .disabled(isRefreshing)
                .opacity(isRefreshing ? 0.7 : 1)
            }
            .padding(.vertical, designSystem.spacing.xLarge)
            .padding(.horizontal, designSystem.spacing.xLarge)
        }
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

private extension ListingsViewModel.LoadingState {
    var isLoaded: Bool {
        switch self {
        case .loaded:
            return true
        default:
            return false
        }
    }
}
