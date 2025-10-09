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

    @State private var selectedListing: ListingPresentation?
    @State private var showingSortSheet = false
    @State private var showingLocationSheet = false
    @State private var composerMode: ComposerMode?
    @State private var showingMassComposer = false
    @State private var coverByID: [String: String] = [:]

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
            .sheet(item: $selectedListing) { presentation in
                ListingDetailSheet(listing: presentation.listing, coverURL: presentation.coverURL)
            }
            .sheet(item: $composerMode) { mode in
                NavigationStack {
                    ListingComposerSheet(
                        mode: mode,
                        listingsService: listingsService,
                        capabilityEmitter: capabilityEmitter,
                        onComplete: {
                            Task { await loadListings(reset: true) }
                        }
                    )
                }
                .presentationDetents([.large])
            }
            .sheet(isPresented: $showingMassComposer) {
                NavigationStack {
                    MassListingSheet(
                        listingsService: listingsService,
                        capabilityEmitter: capabilityEmitter,
                        onComplete: {
                            Task { await loadListings(reset: true) }
                        }
                    )
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
                ListItCard {
                    HStack(alignment: .top, spacing: designSystem.spacing.medium) {
                        ListingCoverThumbnail(url: coverURL(for: listing))

                        VStack(alignment: .leading, spacing: designSystem.spacing.xSmall) {
                            Text(listing.title)
                                .font(designSystem.typography.headline)

                            if !listing.subtitle.isEmpty {
                                Text(listing.subtitle)
                                    .font(designSystem.typography.subheadline)
                                    .foregroundStyle(.secondary)
                            }

                            if let formattedPrice = listing.formattedPrice {
                                Label(formattedPrice, systemImage: "tag")
                            }
                            if let location = listing.location, !location.isEmpty {
                                Label(location, systemImage: "mappin.and.ellipse")
                            }

                            Text("Powered by the shared core listings service.")
                                .font(designSystem.typography.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .contentShape(Rectangle())
                .onTapGesture {
                    let cover = coverByID[listing.id]
                    selectedListing = ListingPresentation(listing: listing, coverURL: cover)
                }
                .contextMenu {
                    Button {
                        composerMode = .edit(listing: listing, intent: .manual)
                    } label: {
                        Label("Edit listing", systemImage: "square.and.pencil")
                    }
                    Button {
                        composerMode = .edit(listing: listing, intent: .ai)
                    } label: {
                        Label("Enhance with AI", systemImage: "sparkles")
                    }
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
            Menu {
                Button {
                    composerMode = .create(intent: .manual)
                } label: {
                    Label("New listing", systemImage: "plus")
                }

                Button {
                    composerMode = .create(intent: .ai)
                } label: {
                    Label("AI-assisted draft", systemImage: "sparkles")
                }

                Button {
                    showingMassComposer = true
                } label: {
                    Label("Mass list items", systemImage: "rectangle.stack.badge.plus")
                }
            } label: {
                Label("Compose", systemImage: "square.and.pencil")
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
            let newListings: [Listing]
            if reset {
                listings = mapped
                newListings = mapped
            } else {
                let existingIDs = Set(listings.map { $0.id })
                let appended = mapped.filter { !existingIDs.contains($0.id) }
                if !appended.isEmpty {
                    listings.append(contentsOf: appended)
                }
                newListings = appended
            }
            nextCursor = page.nextCursor
            hasNextPage = page.hasNext
            errorMessage = nil
            await fetchCoversIfNeeded(newListings: newListings, reset: reset)
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

    func fetchCoversIfNeeded(newListings: [Listing], reset: Bool) async {
        let ids: [String]
        if reset {
            ids = Array(newListings.prefix(24).map(\.id))
        } else {
            ids = newListings.map(\.id)
        }
        guard !ids.isEmpty else { return }

        do {
            let covers = try await listingsService.fetchCovers(for: ids)
            if reset {
                coverByID = covers
            } else {
                for (id, cover) in covers {
                    coverByID[id] = cover
                }
            }
        } catch {
            // Swallow cover fetch failures so listings still render.
        }
    }

    func coverURL(for listing: Listing) -> URL? {
        guard let value = coverByID[listing.id]?.trimmingCharacters(in: .whitespacesAndNewlines),
              let url = URL(string: value) else {
            return nil
        }
        return url
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

    struct ListingPresentation: Identifiable, Equatable {
        let listing: Listing
        let coverURL: String?

        var id: String { listing.id }
    }

    enum ComposerIntent: Equatable {
        case manual
        case ai

        fileprivate var identifier: String {
            switch self {
            case .manual: return "manual"
            case .ai: return "ai"
            }
        }
    }

    enum ComposerMode: Identifiable, Equatable {
        case create(intent: ComposerIntent)
        case edit(listing: Listing, intent: ComposerIntent)

        var id: String {
            switch self {
            case .create(let intent):
                return "create-\(intent.identifier)"
            case .edit(let listing, let intent):
                return "edit-\(listing.id)-\(intent.identifier)"
            }
        }

        var intent: ComposerIntent {
            switch self {
            case .create(let intent): return intent
            case .edit(_, let intent): return intent
            }
        }

        var navigationTitle: String {
            switch self {
            case .create:
                return "New listing"
            case .edit:
                return "Edit listing"
            }
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

private struct ListingCoverThumbnail: View {
    @Environment(\.designSystem) private var designSystem
    let url: URL?

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: designSystem.corners.small, style: .continuous)
                .fill(designSystem.colors.surface.opacity(0.85))
                .overlay(
                    RoundedRectangle(cornerRadius: designSystem.corners.small, style: .continuous)
                        .stroke(designSystem.colors.onSurface.opacity(0.08), lineWidth: 1)
                )

            if let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                    case .failure:
                        placeholder
                    case .empty:
                        ProgressView()
                            .progressViewStyle(.circular)
                    @unknown default:
                        placeholder
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: designSystem.corners.small, style: .continuous))
            } else {
                placeholder
            }
        }
        .frame(width: 96, height: 96)
        .clipped()
    }

    private var placeholder: some View {
        VStack(spacing: designSystem.spacing.xSmall) {
            Image(systemName: "photo")
                .font(.system(size: 24))
            Text("No cover")
                .font(designSystem.typography.caption)
        }
        .foregroundStyle(.secondary)
    }
}

private struct ListingDetailSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.designSystem) private var designSystem

    let listing: ListingsFeatureView.Listing
    let coverURL: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: designSystem.spacing.large) {
                if let coverURL, let url = URL(string: coverURL) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image):
                            image
                                .resizable()
                                .scaledToFill()
                        case .failure:
                            placeholder
                        case .empty:
                            ProgressView()
                                .progressViewStyle(.circular)
                        @unknown default:
                            placeholder
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 220)
                    .clipShape(RoundedRectangle(cornerRadius: designSystem.corners.medium, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: designSystem.corners.medium, style: .continuous)
                            .stroke(designSystem.colors.onSurface.opacity(0.05), lineWidth: 1)
                    )
                }

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

    private var placeholder: some View {
        ZStack {
            RoundedRectangle(cornerRadius: designSystem.corners.medium, style: .continuous)
                .fill(designSystem.colors.surface)
            Image(systemName: "photo")
                .font(.system(size: 32))
                .foregroundStyle(.secondary)
        }
    }
}

private struct ListingComposerSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.designSystem) private var designSystem

    let mode: ListingsFeatureView.ComposerMode
    let listingsService: ListingsService
    let capabilityEmitter: (String, [String: Any]) -> Void
    let onComplete: () -> Void

    @State private var title: String
    @State private var description: String
    @State private var location: String
    @State private var priceText: String
    @State private var tagsText: String
    @State private var enableNearby: Bool
    @State private var latitudeText: String
    @State private var longitudeText: String
    @State private var showAISection: Bool

    @State private var aiImageSources: String = ""
    @State private var aiHint: String = ""
    @State private var isAIRunning = false
    @State private var lastAIAnalysis: ListingAIAnalysis?
    @State private var aiError: String?

    @State private var isSaving = false
    @State private var saveError: String?

    @State private var existingImages: [String] = []
    @State private var markedForDeletion: Set<String> = []
    @State private var isLoadingImages = false

    init(mode: ListingsFeatureView.ComposerMode,
         listingsService: ListingsService,
         capabilityEmitter: @escaping (String, [String: Any]) -> Void,
         onComplete: @escaping () -> Void) {
        self.mode = mode
        self.listingsService = listingsService
        self.capabilityEmitter = capabilityEmitter
        self.onComplete = onComplete

        switch mode {
        case .create(let intent):
            _title = State(initialValue: "")
            _description = State(initialValue: "")
            _location = State(initialValue: "")
            _priceText = State(initialValue: "")
            _tagsText = State(initialValue: "")
            _enableNearby = State(initialValue: false)
            _latitudeText = State(initialValue: "")
            _longitudeText = State(initialValue: "")
            _showAISection = State(initialValue: intent == .ai)
        case .edit(let listing, let intent):
            _title = State(initialValue: listing.title)
            _description = State(initialValue: listing.subtitle)
            _location = State(initialValue: listing.location ?? "")
            let priceString: String
            if let price = listing.price {
                priceString = String(format: "%.2f", price)
            } else {
                priceString = ""
            }
            _priceText = State(initialValue: priceString)
            _tagsText = State(initialValue: "")
            _enableNearby = State(initialValue: false)
            _latitudeText = State(initialValue: "")
            _longitudeText = State(initialValue: "")
            _showAISection = State(initialValue: intent == .ai)
        }
    }

    var body: some View {
        Form {
            detailsSection
            aiSection
            imagesSection
            if let saveError {
                Section {
                    Text(saveError)
                        .foregroundStyle(designSystem.colors.danger)
                }
            }
        }
        .navigationTitle(mode.navigationTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button(isSaving ? "Saving…" : "Save") {
                    save()
                }
                .disabled(isSaving)
            }
        }
        .disabled(isSaving)
        .task {
            await loadExistingImagesIfNeeded()
        }
    }

    private var detailsSection: some View {
        Section("Details") {
            TextField("Title", text: $title)
                .textInputAutocapitalization(.sentences)

            VStack(alignment: .leading, spacing: designSystem.spacing.xSmall) {
                Text("Description")
                    .font(designSystem.typography.caption)
                    .foregroundStyle(.secondary)
                TextEditor(text: $description)
                    .frame(minHeight: 140)
                    .padding(4)
                    .background(
                        RoundedRectangle(cornerRadius: designSystem.corners.small, style: .continuous)
                            .fill(designSystem.colors.surface)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: designSystem.corners.small, style: .continuous)
                            .stroke(designSystem.colors.onSurface.opacity(0.08), lineWidth: 1)
                    )
            }

            TextField("Location", text: $location)
                .textInputAutocapitalization(.words)

            TextField("Price", text: $priceText)
                .keyboardType(.decimalPad)

            TextField("Tags (comma separated)", text: $tagsText)

            Toggle("Enable Nearby exposure", isOn: $enableNearby)

            if enableNearby {
                TextField("Latitude", text: $latitudeText)
                    .keyboardType(.decimalPad)
                TextField("Longitude", text: $longitudeText)
                    .keyboardType(.decimalPad)
            }
        }
    }

    private var aiSection: some View {
        Section {
            DisclosureGroup(isExpanded: $showAISection) {
                Text("Paste image URLs (comma or newline separated). The shared core AI helpers will suggest copy, pricing, and tags.")
                    .font(designSystem.typography.caption)
                    .foregroundStyle(.secondary)

                TextEditor(text: $aiImageSources)
                    .frame(minHeight: 80)
                    .padding(4)
                    .background(
                        RoundedRectangle(cornerRadius: designSystem.corners.small, style: .continuous)
                            .fill(designSystem.colors.surface)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: designSystem.corners.small, style: .continuous)
                            .stroke(designSystem.colors.onSurface.opacity(0.08), lineWidth: 1)
                    )

                TextField("Optional hint for the AI model", text: $aiHint)

                Button {
                    generateWithAI()
                } label: {
                    Label(isAIRunning ? "Generating…" : "Generate with AI", systemImage: "wand.and.stars")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(ListItPrimaryButtonStyle())
                .disabled(isAIRunning || sanitizedImageSources().isEmpty)

                if isAIRunning {
                    ProgressView()
                        .progressViewStyle(.circular)
                }

                if let analysis = lastAIAnalysis {
                    VStack(alignment: .leading, spacing: designSystem.spacing.xSmall) {
                        Text("AI suggestions applied")
                            .font(designSystem.typography.subheadline)
                        if !analysis.title.isEmpty {
                            Label(analysis.title, systemImage: "textformat")
                                .font(designSystem.typography.caption)
                        }
                        if let price = analysis.suggestedPrice {
                            let formatted = ListingsFeatureView.priceFormatter.string(from: NSNumber(value: price)) ?? String(format: "%.2f", price)
                            Label(formatted, systemImage: "tag")
                                .font(designSystem.typography.caption)
                        }
                        if !analysis.tags.isEmpty {
                            Label(analysis.tags.joined(separator: ", "), systemImage: "number")
                                .font(designSystem.typography.caption)
                        }
                    }
                    .padding(designSystem.spacing.small)
                    .background(
                        RoundedRectangle(cornerRadius: designSystem.corners.small, style: .continuous)
                            .fill(designSystem.colors.surface)
                    )
                }

                if let aiError {
                    Text(aiError)
                        .font(designSystem.typography.caption)
                        .foregroundStyle(designSystem.colors.danger)
                }
            } label: {
                Label("AI assist", systemImage: "sparkles")
            }
        }
    }

    @ViewBuilder
    private var imagesSection: some View {
        Section("Images & cover") {
            switch mode {
            case .create:
                Text("Upload images via the Upload tab to obtain tokens, then attach them through mass listing or by editing after creation. The first stored image becomes the cover.")
                    .font(designSystem.typography.caption)
                    .foregroundStyle(.secondary)
            case .edit:
                if isLoadingImages {
                    ProgressView("Loading images…")
                } else if existingImages.isEmpty {
                    Text("No images found for this listing yet.")
                        .foregroundStyle(.secondary)
                } else {
                    Text("The first remaining image will be promoted to the cover when you save.")
                        .font(designSystem.typography.caption)
                        .foregroundStyle(.secondary)

                    ForEach(existingImages, id: \\.self) { image in
                        ListingImageRow(
                            urlString: image,
                            isMarked: markedForDeletion.contains(image),
                            action: { toggleDeletion(for: image) }
                        )
                    }
                }
            }
        }
    }

    @MainActor
    private func loadExistingImagesIfNeeded() async {
        guard case .edit(let listing, _) = mode else { return }
        guard existingImages.isEmpty else { return }
        isLoadingImages = true
        defer { isLoadingImages = false }
        do {
            let images = try await listingsService.fetchListingImages(id: listing.id)
            existingImages = images
        } catch {
            // Ignore failures so editing can continue.
        }
    }

    private func sanitizedImageSources() -> [URL] {
        aiImageSources
            .split(whereSeparator: { $0 == "," || $0.isNewline })
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .compactMap { URL(string: $0) }
    }

    private func generateWithAI() {
        let sources = sanitizedImageSources()
        guard !sources.isEmpty else {
            aiError = "Provide at least one image URL."
            capabilityEmitter("haptic", ["style": "error"])
            return
        }

        aiError = nil
        isAIRunning = true

        Task {
            do {
                let analysis = try await listingsService.analyze(images: sources, hint: aiHint.trimmingCharacters(in: .whitespacesAndNewlines))
                await MainActor.run {
                    applyAnalysis(analysis)
                    lastAIAnalysis = analysis
                    isAIRunning = false
                    capabilityEmitter("haptic", ["style": "success"])
                }
            } catch {
                await MainActor.run {
                    aiError = error.localizedDescription
                    isAIRunning = false
                    capabilityEmitter("haptic", ["style": "error"])
                }
            }
        }
    }

    @MainActor
    private func applyAnalysis(_ analysis: ListingAIAnalysis) {
        if title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !analysis.title.isEmpty {
            title = analysis.title
        }
        if description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !analysis.description.isEmpty {
            description = analysis.description
        }
        if let price = analysis.suggestedPrice {
            priceText = String(format: "%.2f", price)
        }
        if !analysis.tags.isEmpty {
            let combined = Set(csvStrings(from: tagsText) + analysis.tags)
            tagsText = combined.sorted().joined(separator: ", ")
        }
    }

    private func toggleDeletion(for image: String) {
        if markedForDeletion.contains(image) {
            markedForDeletion.remove(image)
        } else {
            markedForDeletion.insert(image)
        }
    }

    private func save() {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty else {
            saveError = "Title is required."
            capabilityEmitter("haptic", ["style": "error"])
            return
        }

        isSaving = true
        saveError = nil

        let draft = ListingDraft(
            title: trimmedTitle,
            description: description.trimmingCharacters(in: .whitespacesAndNewlines),
            location: location.trimmingCharacters(in: .whitespacesAndNewlines),
            price: parseDouble(priceText),
            tags: csvStrings(from: tagsText),
            enableNearby: enableNearby,
            latitude: enableNearby ? parseDouble(latitudeText) : nil,
            longitude: enableNearby ? parseDouble(longitudeText) : nil,
            uploadTokens: [],
            deletedImages: Array(markedForDeletion)
        )

        Task {
            do {
                _ = try await performSave(with: draft)
                await MainActor.run {
                    isSaving = false
                    capabilityEmitter("haptic", ["style": "success"])
                    onComplete()
                    dismiss()
                }
            } catch {
                await MainActor.run {
                    isSaving = false
                    saveError = error.localizedDescription
                    capabilityEmitter("haptic", ["style": "error"])
                }
            }
        }
    }

    private func performSave(with draft: ListingDraft) async throws -> ListingDetail {
        switch mode {
        case .create:
            return try await listingsService.createListing(from: draft)
        case .edit(let listing, _):
            return try await listingsService.updateListing(id: listing.id, with: draft)
        }
    }

    private func parseDouble(_ string: String) -> Double? {
        let filtered = string.filter { "0123456789.,-".contains($0) }
        let normalized = filtered.replacingOccurrences(of: ",", with: ".")
        return Double(normalized)
    }

    private func csvStrings(from text: String) -> [String] {
        text.split(whereSeparator: { $0 == "," || $0 == ";" })
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }
}

private struct ListingImageRow: View {
    @Environment(\.designSystem) private var designSystem
    let urlString: String
    let isMarked: Bool
    let action: () -> Void

    var body: some View {
        HStack(spacing: designSystem.spacing.small) {
            if let url = URL(string: urlString) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                    case .failure:
                        placeholder
                    case .empty:
                        ProgressView()
                            .progressViewStyle(.circular)
                    @unknown default:
                        placeholder
                    }
                }
                .frame(width: 60, height: 60)
                .clipShape(RoundedRectangle(cornerRadius: designSystem.corners.small, style: .continuous))
            } else {
                placeholder
                    .frame(width: 60, height: 60)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(urlString)
                    .font(designSystem.typography.caption)
                    .lineLimit(2)
                if isMarked {
                    Text("Marked for deletion")
                        .font(designSystem.typography.caption)
                        .foregroundStyle(designSystem.colors.danger)
                }
            }

            Spacer()

            Button(isMarked ? "Keep" : "Remove", action: action)
                .buttonStyle(.bordered)
                .tint(isMarked ? designSystem.colors.accent : designSystem.colors.danger)
        }
    }

    private var placeholder: some View {
        RoundedRectangle(cornerRadius: designSystem.corners.small, style: .continuous)
            .fill(designSystem.colors.surface.opacity(0.8))
            .overlay(
                Image(systemName: "photo")
                    .font(.system(size: 18))
                    .foregroundStyle(.secondary)
            )
    }
}

private struct MassListingSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.designSystem) private var designSystem

    let listingsService: ListingsService
    let capabilityEmitter: (String, [String: Any]) -> Void
    let onComplete: () -> Void

    @State private var bulkInput: String = ""
    @State private var isProcessing = false
    @State private var progress: Double = 0
    @State private var statusMessage: String?
    @State private var errors: [String] = []

    var body: some View {
        Form {
            Section("Instructions") {
                Text("Enter one listing per line using the format:")
                    .font(designSystem.typography.caption)
                Text("Title | Description | Price | Location | Tags | Upload tokens | Enable nearby | Latitude | Longitude")
                    .font(designSystem.typography.caption)
                    .foregroundStyle(.secondary)
                Text("Upload tokens are optional but required when attaching new images. Leave trailing fields blank if they are not needed.")
                    .font(designSystem.typography.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Bulk entries") {
                TextEditor(text: $bulkInput)
                    .frame(minHeight: 200)
                    .padding(4)
                    .background(
                        RoundedRectangle(cornerRadius: designSystem.corners.small, style: .continuous)
                            .fill(designSystem.colors.surface)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: designSystem.corners.small, style: .continuous)
                            .stroke(designSystem.colors.onSurface.opacity(0.08), lineWidth: 1)
                    )
            }

            if isProcessing {
                Section {
                    ProgressView(value: progress)
                    if let statusMessage {
                        Text(statusMessage)
                    }
                }
            } else if let statusMessage {
                Section {
                    Text(statusMessage)
                }
            }

            if !errors.isEmpty {
                Section("Errors") {
                    ForEach(errors, id: \\.self) { error in
                        Text(error)
                            .font(designSystem.typography.caption)
                            .foregroundStyle(designSystem.colors.danger)
                    }
                }
            }
        }
        .navigationTitle("Mass list items")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button(isProcessing ? "Processing…" : "Start") {
                    process()
                }
                .disabled(isProcessing || bulkInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
    }

    private func process() {
        let lines = bulkInput
            .split(whereSeparator: { $0.isNewline })
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        guard !lines.isEmpty else {
            statusMessage = "Add at least one entry before starting."
            capabilityEmitter("haptic", ["style": "error"])
            return
        }

        isProcessing = true
        progress = 0
        statusMessage = nil
        errors = []

        Task {
            var successes = 0
            var failures: [String] = []

            for (index, line) in lines.enumerated() {
                let components = line
                    .split(separator: "|", omittingEmptySubsequences: false)
                    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }

                let title = components[safe: 0]
                let description = components[safe: 1] ?? ""
                let priceString = components[safe: 2] ?? ""
                let location = components[safe: 3] ?? ""
                let tags = csvStrings(from: components[safe: 4] ?? "")
                let tokens = csvStrings(from: components[safe: 5] ?? "")
                let enableNearby = parseBool(components[safe: 6] ?? "")
                let latitude = enableNearby ? parseDouble(components[safe: 7] ?? "") : nil
                let longitude = enableNearby ? parseDouble(components[safe: 8] ?? "") : nil

                if let title, !title.isEmpty {
                    let draft = ListingDraft(
                        title: title,
                        description: description,
                        location: location,
                        price: parseDouble(priceString),
                        tags: tags,
                        enableNearby: enableNearby,
                        latitude: latitude,
                        longitude: longitude,
                        uploadTokens: tokens
                    )
                    do {
                        _ = try await listingsService.createListing(from: draft)
                        successes += 1
                    } catch {
                        failures.append("Line \(index + 1): \(error.localizedDescription)")
                    }
                } else {
                    failures.append("Line \(index + 1): missing title")
                }

                await MainActor.run {
                    progress = Double(index + 1) / Double(lines.count)
                }
            }

            await MainActor.run {
                isProcessing = false
                statusMessage = "Created \(successes) of \(lines.count) listings"
                errors = failures
                if successes > 0 {
                    capabilityEmitter("haptic", ["style": "success"])
                    onComplete()
                    if failures.isEmpty {
                        dismiss()
                    }
                } else {
                    capabilityEmitter("haptic", ["style": "error"])
                }
            }
        }
    }

    private func csvStrings(from text: String) -> [String] {
        text.split(whereSeparator: { $0 == "," || $0 == ";" })
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    private func parseDouble(_ text: String) -> Double? {
        let filtered = text.filter { "0123456789.,-".contains($0) }
        let normalized = filtered.replacingOccurrences(of: ",", with: ".")
        return Double(normalized)
    }

    private func parseBool(_ text: String) -> Bool {
        let normalized = text.lowercased()
        return ["true", "yes", "y", "1"].contains(normalized)
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        guard indices.contains(index) else { return nil }
        return self[index]
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
