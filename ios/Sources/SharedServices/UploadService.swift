import Foundation
import SharedCoreBridge

public final class UploadService {
    private let runtime: SharedRuntime

    public init(runtime: SharedRuntime) {
        self.runtime = runtime
    }
    
    public func uploadPhotoData(_ data: Data, progress: @escaping (Double) async -> Void) async throws {
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
