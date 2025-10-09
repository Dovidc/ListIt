import SwiftUI
import PhotosUI
import SharedServices
import DesignSystem
import UIKit

struct MassListOutcome: Equatable {
    let total: Int
    let created: Int
    let failed: Int
}

struct MassListView: View {
    @Environment(\.designSystem) private var designSystem
    @Environment(\.dismiss) private var dismiss

    private let listingsService: ListingsService
    private let uploadService: UploadService
    private let onComplete: (MassListOutcome) -> Void

    @State private var selection: [PhotosPickerItem] = []
    @State private var photos: [PickedPhoto] = []
    @State private var isProcessing = false
    @State private var processedCount = 0
    @State private var failedCount = 0
    @State private var errorMessage: String?
    @State private var aiHint: String = ""
    @State private var useAIContent = true
    @State private var enableInquiry = false
    @State private var sharedLocation: String = ""

    init(listingsService: ListingsService,
         uploadService: UploadService,
         onComplete: @escaping (MassListOutcome) -> Void) {
        self.listingsService = listingsService
        self.uploadService = uploadService
        self.onComplete = onComplete
    }

    var body: some View {
        NavigationStack {
            Form {
                photosSection
                optionsSection
                progressSection
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
            .navigationTitle("Mass list")
            .toolbar { toolbar }
            .disabled(isProcessing)
            .onChange(of: selection) { _, newValue in
                guard !newValue.isEmpty else { return }
                addPhotos(from: newValue)
            }
        }
    }

    private var photosSection: some View {
        Section("Photos") {
            PhotosPicker(selection: $selection, matching: .images) {
                Label("Select photos", systemImage: "photo")
            }
            if photos.isEmpty {
                Text("Choose one or more photos. We'll publish one listing per photo.")
                    .font(designSystem.typography.footnote)
                    .foregroundStyle(.secondary)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: designSystem.spacing.small) {
                        ForEach(photos) { photo in
                            ZStack(alignment: .topTrailing) {
                                photo.image
                                    .resizable()
                                    .scaledToFill()
                                    .frame(width: 96, height: 96)
                                    .clipShape(RoundedRectangle(cornerRadius: designSystem.corners.medium, style: .continuous))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: designSystem.corners.medium, style: .continuous)
                                            .stroke(designSystem.colors.surface, lineWidth: 1)
                                    )
                                Button {
                                    remove(photo)
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
        }
    }

    private var optionsSection: some View {
        Section("Options") {
            Toggle("Use AI descriptions", isOn: $useAIContent)
            Toggle("Enable inquiries", isOn: $enableInquiry)
            TextField("Location (optional)", text: $sharedLocation)
            TextField("Hint for AI", text: $aiHint)
            Button(action: runMassList) {
                if isProcessing {
                    ProgressView()
                } else {
                    Label("Start mass list", systemImage: "play.fill")
                }
            }
            .disabled(isProcessing || photos.isEmpty)
        }
    }

    private var progressSection: some View {
        Group {
            if isProcessing {
                Section("Progress") {
                    ProgressView(value: Double(processedCount), total: Double(max(photos.count, 1)))
                    Text("Processed \(processedCount) of \(photos.count)")
                        .font(designSystem.typography.caption)
                    if failedCount > 0 {
                        Text("Failed: \(failedCount)")
                            .font(designSystem.typography.caption)
                            .foregroundStyle(.red)
                    }
                }
            }
        }
    }

    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            Button("Close") { dismiss() }
        }
    }

    private func addPhotos(from items: [PhotosPickerItem]) {
        Task {
            defer { selection = [] }
            for item in items {
                guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
                let image = UIImage(data: data).map { Image(uiImage: $0) } ?? Image(systemName: "photo")
                await MainActor.run {
                    photos.append(PickedPhoto(data: data, image: image))
                }
            }
        }
    }

    private func remove(_ photo: PickedPhoto) {
        photos.removeAll { $0.id == photo.id }
    }

    private func runMassList() {
        Task {
            guard !photos.isEmpty else { return }
            await MainActor.run {
                isProcessing = true
                processedCount = 0
                failedCount = 0
                errorMessage = nil
            }
            var created = 0
            var failed = 0
            for photo in photos {
                do {
                    let result = try await uploadService.uploadPhotoData(photo.data) { _ in await MainActor.run { } }
                    let urls: [URL]
                    if let url = result.url {
                        urls = [url]
                    } else {
                        urls = []
                    }

                    let analysis: ListingAIAnalysis?
                    if useAIContent, !urls.isEmpty {
                        analysis = try? await listingsService.analyzeListing(images: urls, hint: aiHint)
                    } else {
                        analysis = nil
                    }

                    let title = analysis?.title ?? "Item for sale"
                    let description = analysis?.description ?? "No description provided."
                    let tags = analysis?.tags ?? []
                    let price = analysis?.suggestedPrice

                    let draft = ListingDraft(
                        title: title,
                        description: description,
                        location: sharedLocation,
                        price: price,
                        tags: tags,
                        enableNearby: false,
                        inquiryEnabled: enableInquiry,
                        latitude: nil,
                        longitude: nil,
                        uploadTokens: [result.uploadToken]
                    )

                    _ = try await listingsService.createListing(from: draft)
                    created += 1
                } catch {
                    failed += 1
                    await MainActor.run {
                        errorMessage = error.localizedDescription
                    }
                }
                await MainActor.run {
                    processedCount = created + failed
                    failedCount = failed
                }
            }
            await MainActor.run {
                isProcessing = false
                onComplete(MassListOutcome(total: photos.count, created: created, failed: failed))
                dismiss()
            }
        }
    }

    private struct PickedPhoto: Identifiable, Equatable {
        let id = UUID()
        let data: Data
        let image: Image
    }
}
