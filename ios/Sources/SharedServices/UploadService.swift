import Foundation
import PhotosUI
import SharedCoreBridge

public final class UploadService {
    private let runtime: SharedRuntime
    private let dataLoader: (PhotosPickerItem) async throws -> Data?

    public init(runtime: SharedRuntime, dataLoader: @escaping (PhotosPickerItem) async throws -> Data? = { try await $0.loadTransferable(type: Data.self) }) {
        self.runtime = runtime
        self.dataLoader = dataLoader
    }

    public func uploadPhoto(from item: PhotosPickerItem, progress: @escaping (Double) async -> Void) async throws {
        guard let data = try await dataLoader(item) else {
            throw UploadError.assetUnavailable
        }
        let base64 = data.base64EncodedString()
        let response = try await runtime.callAsync(function: "upload_photo", with: [base64])
        guard response.toBool() == true else {
            throw UploadError.failed
        }
        await progress(1.0)
    }
}

public enum UploadError: Error {
    case assetUnavailable
    case failed
}
