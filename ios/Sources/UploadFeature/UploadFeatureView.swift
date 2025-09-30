import SwiftUI
import PhotosUI
import SharedServices
import DesignSystem

public struct UploadFeatureView: View {
    @Environment(\.designSystem) private var designSystem
    @State private var selection: PhotosPickerItem?
    @State private var progress: Double = 0
    @State private var statusMessage: String?
    private let uploadService: UploadService
    private let capabilityEmitter: (String, [String: Any]) -> Void

    public init(uploadService: UploadService, capabilityEmitter: @escaping (String, [String: Any]) -> Void = { _, _ in }) {
        self.uploadService = uploadService
        self.capabilityEmitter = capabilityEmitter
    }

    public var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                ListItCard(title: "Upload a photo", subtitle: "Send media to the shared upload service") {
                    Text("Large file support, resumable transfers, and background uploads remain encapsulated in the shared core, while the UI stays fully native.")
                        .font(designSystem.typography.callout)
                        .foregroundStyle(.secondary)
                }

                PhotosPicker(selection: $selection, matching: .images) {
                    Label("Choose Photo", systemImage: "photo")
                        .font(designSystem.typography.headline)
                }
                .buttonStyle(ListItPrimaryButtonStyle())
                .onChange(of: selection, perform: handleSelection)

                ProgressView(value: progress)
                    .tint(designSystem.colors.accent)
                    .padding(.horizontal)

                if let statusMessage {
                    Text(statusMessage)
                        .font(designSystem.typography.callout)
                        .foregroundStyle(statusMessage.contains("complete") ? designSystem.colors.success : designSystem.colors.secondary)
                }

                Spacer()
            }
            .padding()
            .navigationTitle("Upload")
            .navigationBarTitleDisplayMode(designSystem.enablesLargeTitles ? .large : .inline)
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
                capabilityEmitter("haptic", ["style": "success"])
            } catch {
                statusMessage = error.localizedDescription
                capabilityEmitter("haptic", ["style": "error"])
            }
        }
    }
}
