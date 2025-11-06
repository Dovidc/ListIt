import SwiftUI
import PhotosUI
import SharedServices

public struct UploadFeatureView: View {
    @State private var selection: PhotosPickerItem?
    @State private var progress: Double = 0
    @State private var statusMessage: String?
    private let uploadService: UploadService

    public init(uploadService: UploadService) {
        self.uploadService = uploadService
    }

    public var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                PhotosPicker(selection: $selection, matching: .images) {
                    Label("Choose Photo", systemImage: "photo")
                }
                .onChange(of: selection, perform: handleSelection)

                ProgressView(value: progress)
                    .padding(.horizontal)

                if let statusMessage {
                    Text(statusMessage)
                        .foregroundStyle(.secondary)
                }

                Spacer()
            }
            .padding()
            .navigationTitle("Upload")
        }
    }

    private func handleSelection(_ item: PhotosPickerItem?) {
        guard let item else { return }
        Task {
            do {
                progress = 0
                statusMessage = nil
                try await uploadService.uploadPhoto(from: item, progress: { value in
                    await MainActor.run { progress = value }
                })
                statusMessage = "Upload complete"
            } catch {
                statusMessage = error.localizedDescription
            }
        }
    }
}
