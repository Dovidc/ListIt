import SwiftUI
import PhotosUI
import SharedServices
import DesignSystem
import UIKit

struct ListingComposerView: View {
    enum Mode: Identifiable, Equatable {
        case create
        case edit(ListingSummary)

        var id: String {
            switch self {
            case .create:
                return "create"
            case .edit(let listing):
                return "edit-\(listing.id)"
            }
        }

        var title: String {
            switch self {
            case .create:
                return "Create listing"
            case .edit:
                return "Edit listing"
            }
        }

        var existingListing: ListingSummary? {
            if case .edit(let listing) = self { return listing }
            return nil
        }
    }

    @Environment(\.designSystem) private var designSystem
    @Environment(\.dismiss) private var dismiss

    private let mode: Mode
    private let listingsService: ListingsService
    private let uploadService: UploadService
    private let onComplete: (ListingSummary) -> Void

    @State private var title: String
    @State private var descriptionText: String
    @State private var locationText: String
    @State private var priceText: String
    @State private var tagsText: String
    @State private var enableNearby: Bool
    @State private var inquiryEnabled: Bool
    @State private var markSold: Bool
    @State private var photoSelections: [PhotosPickerItem] = []
    @State private var uploadedAssets: [UploadedAsset] = []
    @State private var existingImageURLs: [URL]
    @State private var isSaving = false
    @State private var isGeneratingAI = false
    @State private var errorMessage: String?
    @State private var aiHint: String

    init(mode: Mode,
         listingsService: ListingsService,
         uploadService: UploadService,
         onComplete: @escaping (ListingSummary) -> Void) {
        self.mode = mode
        self.listingsService = listingsService
        self.uploadService = uploadService
        self.onComplete = onComplete

        if let listing = mode.existingListing {
            _title = State(initialValue: listing.title)
            _descriptionText = State(initialValue: listing.description)
            _locationText = State(initialValue: listing.location ?? "")
            if let price = listing.price {
                _priceText = State(initialValue: String(format: "%.2f", price))
            } else {
                _priceText = State(initialValue: "")
            }
            _tagsText = State(initialValue: listing.tags.joined(separator: ", "))
            _enableNearby = State(initialValue: false)
            _inquiryEnabled = State(initialValue: false)
            _markSold = State(initialValue: listing.isSold)
            let gallery = listing.galleryImages.map(\.url)
            let cover = listing.coverImageURL
            let combined = ([cover] + gallery).compactMap { $0 }
            let unique = combined.reduce(into: [URL]()) { partial, url in
                if !partial.contains(url) {
                    partial.append(url)
                }
            }
            _existingImageURLs = State(initialValue: unique)
            _aiHint = State(initialValue: listing.title)
        } else {
            _title = State(initialValue: "")
            _descriptionText = State(initialValue: "")
            _locationText = State(initialValue: "")
            _priceText = State(initialValue: "")
            _tagsText = State(initialValue: "")
            _enableNearby = State(initialValue: false)
            _inquiryEnabled = State(initialValue: false)
            _markSold = State(initialValue: false)
            _existingImageURLs = State(initialValue: [])
            _aiHint = State(initialValue: "")
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                photosSection
                detailsSection
                aiSection
                metadataSection
                if let errorMessage {
                    Section("Status") {
                        Text(errorMessage)
                            .font(designSystem.typography.caption)
                            .foregroundStyle(.red)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(designSystem.colors.background)
            .navigationTitle(mode.title)
            .toolbar { toolbar }
            .disabled(isSaving)
            .onChange(of: photoSelections) { _, newValue in
                guard !newValue.isEmpty else { return }
                handleSelections(newValue)
            }
        }
    }

    private var photosSection: some View {
        Section("Photos") {
            if mode == .create {
                PhotosPicker(selection: $photoSelections, maxSelectionCount: 12, matching: .images) {
                    Label("Add photos", systemImage: "photo.on.rectangle")
                }
                if uploadedAssets.isEmpty {
                    Text("Add at least one photo to publish your listing.")
                        .font(designSystem.typography.footnote)
                        .foregroundStyle(.secondary)
                }
                if !uploadedAssets.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: designSystem.spacing.small) {
                            ForEach(uploadedAssets) { asset in
                                ZStack(alignment: .topTrailing) {
                                    asset.image
                                        .resizable()
                                        .scaledToFill()
                                        .frame(width: 96, height: 96)
                                        .clipShape(RoundedRectangle(cornerRadius: designSystem.corners.medium, style: .continuous))
                                        .overlay(
                                            RoundedRectangle(cornerRadius: designSystem.corners.medium, style: .continuous)
                                                .stroke(designSystem.colors.surface, lineWidth: 1)
                                        )
                                    Button {
                                        removeAsset(asset)
                                    } label: {
                                        Image(systemName: "xmark.circle.fill")
                                            .foregroundStyle(.white.opacity(0.9))
                                            .background(Circle().fill(Color.black.opacity(0.5)))
                                    }
                                    .buttonStyle(.plain)
                                    .offset(x: -4, y: 4)
                                }
                            }
                        }
                        .padding(.vertical, designSystem.spacing.xSmall)
                    }
                }
            } else {
                if existingImageURLs.isEmpty {
                    Text("Images are currently read-only from this preview.")
                        .font(designSystem.typography.footnote)
                        .foregroundStyle(.secondary)
                } else {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: designSystem.spacing.small) {
                            ForEach(existingImageURLs, id: \.self) { url in
                                AsyncImage(url: url) { image in
                                    image
                                        .resizable()
                                        .scaledToFill()
                                } placeholder: {
                                    Color.secondary.opacity(0.1)
                                }
                                .frame(width: 96, height: 96)
                                .clipShape(RoundedRectangle(cornerRadius: designSystem.corners.medium, style: .continuous))
                            }
                        }
                        .padding(.vertical, designSystem.spacing.xSmall)
                    }
                }
            }
        }
    }

    private var detailsSection: some View {
        Section("Details") {
            TextField("Title", text: $title)
            TextField("Location", text: $locationText)
            TextField("Price", text: $priceText)
                .keyboardType(.decimalPad)
            TextField("Tags", text: $tagsText, prompt: Text("Comma separated"))
            TextEditor(text: $descriptionText)
                .frame(minHeight: 120)
        }
    }

    private var aiSection: some View {
        Section("AI Assistance") {
            TextField("Hint for AI (optional)", text: $aiHint)
            Button {
                Task { await generateWithAI() }
            } label: {
                if isGeneratingAI {
                    ProgressView()
                } else {
                    Label("Generate description", systemImage: "sparkles")
                }
            }
            .disabled(isGeneratingAI || availableImageURLs.isEmpty)
            if availableImageURLs.isEmpty {
                Text("Add photos to enable AI suggestions.")
                    .font(designSystem.typography.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var metadataSection: some View {
        Section("Options") {
            if mode == .create {
                Toggle("Enable Nearby", isOn: $enableNearby)
                Toggle("Allow inquiries", isOn: $inquiryEnabled)
            }
            if case .edit = mode {
                Toggle("Mark as sold", isOn: $markSold)
            }
        }
    }

    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .confirmationAction) {
            Button(action: save) {
                if isSaving {
                    ProgressView()
                } else {
                    Text(mode == .create ? "Publish" : "Save")
                }
            }
            .disabled(isSaving)
        }
        ToolbarItem(placement: .cancellationAction) {
            Button("Cancel") { dismiss() }
        }
    }

    private var availableImageURLs: [URL] {
        let uploads = uploadedAssets.compactMap { $0.url }
        if !uploads.isEmpty { return uploads }
        return existingImageURLs
    }

    private func removeAsset(_ asset: UploadedAsset) {
        uploadedAssets.removeAll { $0.id == asset.id }
    }

    private func handleSelections(_ items: [PhotosPickerItem]) {
        Task {
            defer { photoSelections = [] }
            for item in items {
                guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
                await MainActor.run { isGeneratingAI = false }
                do {
                    let result = try await uploadService.uploadPhotoData(data) { progress in
                        await MainActor.run {
                            // no-op placeholder for future progress reporting
                        }
                    }
                    let image = UIImage(data: data).map { Image(uiImage: $0) } ?? Image(systemName: "photo")
                    await MainActor.run {
                        uploadedAssets.append(UploadedAsset(uploadToken: result.uploadToken, url: result.url, image: image))
                    }
                } catch {
                    await MainActor.run {
                        errorMessage = error.localizedDescription
                    }
                }
            }
        }
    }

    private func generateWithAI() async {
        guard !availableImageURLs.isEmpty else { return }
        isGeneratingAI = true
        errorMessage = nil
        do {
            let analysis = try await listingsService.analyzeListing(images: availableImageURLs, hint: aiHint)
            await MainActor.run {
                title = analysis.title
                if !analysis.description.isEmpty {
                    descriptionText = analysis.description
                }
                if !analysis.tags.isEmpty {
                    tagsText = analysis.tags.joined(separator: ", ")
                }
                if let price = analysis.suggestedPrice {
                    priceText = String(format: "%.2f", price)
                }
            }
        } catch {
            await MainActor.run {
                errorMessage = error.localizedDescription
            }
        }
        isGeneratingAI = false
    }

    private func save() {
        Task {
            await MainActor.run {
                isSaving = true
                errorMessage = nil
            }
            do {
                let listing: ListingSummary
                switch mode {
                case .create:
                    let tokens = uploadedAssets.map(\.uploadToken)
                    if tokens.isEmpty {
                        throw ComposerError.requiresPhoto
                    }
                    let draft = ListingDraft(
                        title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                        description: descriptionText.trimmingCharacters(in: .whitespacesAndNewlines),
                        location: locationText.trimmingCharacters(in: .whitespacesAndNewlines),
                        price: Double(priceText),
                        tags: tagsText.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty },
                        enableNearby: enableNearby,
                        inquiryEnabled: inquiryEnabled,
                        latitude: nil,
                        longitude: nil,
                        uploadTokens: tokens
                    )
                    listing = try await listingsService.createListing(from: draft)
                case .edit(let existing):
                    let update = ListingUpdate(
                        title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                        description: descriptionText.trimmingCharacters(in: .whitespacesAndNewlines),
                        location: locationText.trimmingCharacters(in: .whitespacesAndNewlines),
                        price: Double(priceText),
                        tags: tagsText.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty },
                        sold: markSold
                    )
                    listing = try await listingsService.updateListing(id: existing.id, with: update)
                }
                await MainActor.run {
                    onComplete(listing)
                    dismiss()
                }
            } catch {
                await MainActor.run {
                    if let composerError = error as? ComposerError {
                        errorMessage = composerError.errorDescription
                    } else {
                        errorMessage = error.localizedDescription
                    }
                }
            }
            await MainActor.run {
                isSaving = false
            }
        }
    }

    private struct UploadedAsset: Identifiable, Equatable {
        let id = UUID()
        let uploadToken: String
        let url: URL?
        let image: Image
    }

    private enum ComposerError: LocalizedError {
        case requiresPhoto

        var errorDescription: String? {
            switch self {
            case .requiresPhoto:
                return "Add at least one photo before publishing."
            }
        }
    }
}
