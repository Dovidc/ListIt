import Foundation
import SharedCoreBridge

public struct UploadResult: Equatable {
    public let uploadToken: String
    public let url: URL?
    public let width: Double?
    public let height: Double?
    public let bytes: Double?

    public init(uploadToken: String, url: URL?, width: Double?, height: Double?, bytes: Double?) {
        self.uploadToken = uploadToken
        self.url = url
        self.width = width
        self.height = height
        self.bytes = bytes
    }
}

public final class UploadService {
    private let runtime: SharedRuntime

    public init(runtime: SharedRuntime) {
        self.runtime = runtime
    }
    
    public func uploadPhotoData(_ data: Data, progress: @escaping (Double) async -> Void) async throws -> UploadResult {
        let base64 = data.base64EncodedString()
        let response = try runtime.call(function: "upload_photo", with: [base64])
        guard let dictionary = response.toDictionary() else {
            throw UploadError.failed
        }

        if let errorMessage = dictionary["error"] as? String {
            throw UploadError.message(errorMessage)
        }

        guard let ok = dictionary["ok"] as? Bool, ok == true else {
            throw UploadError.failed
        }

        guard let tokenValue = dictionary["uploadToken"] as? String, !tokenValue.isEmpty else {
            throw UploadError.failed
        }

        let url: URL?
        if let urlString = dictionary["url"] as? String, !urlString.isEmpty {
            url = URL(string: urlString)
        } else {
            url = nil
        }

        let width = dictionary["width"] as? Double ?? (dictionary["width"] as? NSNumber)?.doubleValue
        let height = dictionary["height"] as? Double ?? (dictionary["height"] as? NSNumber)?.doubleValue
        let bytes = dictionary["bytes"] as? Double ?? (dictionary["bytes"] as? NSNumber)?.doubleValue

        await progress(1.0)

        return UploadResult(
            uploadToken: tokenValue,
            url: url,
            width: width,
            height: height,
            bytes: bytes
        )
    }
}

public enum UploadError: Error {
    case assetUnavailable
    case failed
    case message(String)
}

extension UploadError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .assetUnavailable:
            return "The selected asset is no longer available."
        case .failed:
            return "Upload failed. Please try again."
        case .message(let message):
            return message
        }
    }
}
