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
    private let showsNavigationChrome: Bool

    public init(
        uploadService: UploadService,
        capabilityEmitter: @escaping (String, [String: Any]) -> Void = { _, _ in },
        showsNavigationChrome: Bool = true
    ) {
        self.uploadService = uploadService
        self.capabilityEmitter = capabilityEmitter
        self.showsNavigationChrome = showsNavigationChrome
    }

    public var body: some View {
        content
            .applyNavigationChrome(
                if: showsNavigationChrome,
                title: "Upload",
                displayMode: designSystem.enablesLargeTitles ? .large : .inline
            )
    }

    private var content: some View {
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
            .onChange(of: selection) {
                handleSelection(selection)
            }

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
    }

    private func handleSelection(_ item: PhotosPickerItem?) {
        guard let item else { return }
        Task {
            do {
                progress = 0
                statusMessage = nil
                
                // Load the data from PhotosPickerItem
                guard let data = try await item.loadTransferable(type: Data.self) else {
                    statusMessage = "Failed to load photo"
                    capabilityEmitter("haptic", ["style": "error"])
                    return
                }
                
                // Use the new uploadPhotoData method
                try await uploadService.uploadPhotoData(data, progress: { value in
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

private extension View {
    @ViewBuilder
    func applyNavigationChrome(
        if showsNavigationChrome: Bool,
        title: String,
        displayMode: NavigationBarItem.TitleDisplayMode
    ) -> some View {
        if showsNavigationChrome {
            NavigationStack {
                self
                    .navigationTitle(title)
                    .navigationBarTitleDisplayMode(displayMode)
            }
        } else {
            self
        }
    }
}
