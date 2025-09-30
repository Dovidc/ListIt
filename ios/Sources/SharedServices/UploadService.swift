import Foundation
import PhotosUI
import SharedCoreBridge

public final class UploadService {
    private let runtime: SharedRuntime

    public init(runtime: SharedRuntime) {
        self.runtime = runtime
    }

    public func uploadPhoto(from item: PhotosPickerItem, progress: @escaping (Double) async -> Void) async throws {
        guard let data = try await item.loadTransferable(type: Data.self) else {
            throw UploadError.assetUnavailable
        }
        let base64 = data.base64EncodedString()
        let response = try runtime.call(function: "upload_photo", with: [base64])
        guard response.toBool() else {
            throw UploadError.failed
        }
        await progress(1.0)
    }
}

public enum UploadError: Error {
    case assetUnavailable
    case failed
}
