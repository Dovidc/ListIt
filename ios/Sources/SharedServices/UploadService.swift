import Foundation
import SharedCoreBridge

public final class UploadService {
    private let runtime: SharedRuntime
    private let client: SharedCoreClient

    public init(runtime: SharedRuntime) {
        self.runtime = runtime
        self.client = SharedCoreClient(runtime: runtime)
    }

    @discardableResult
    public func uploadPhotoData(_ data: Data, options: [String: Any] = [:], progress: @escaping (Double) async -> Void) async throws -> Bool {
        let base64 = data.base64EncodedString()
        let didUpload = try await uploadBase64Image(base64, options: options)
        if didUpload {
            await progress(1.0)
        }
        return didUpload
    }

    @discardableResult
    public func uploadBase64Image(_ base64: String, options: [String: Any] = [:]) async throws -> Bool {
        let response = try client.call("uploads.uploadBase64Image", arguments: [base64, options])
        guard response.toBool() else {
            throw UploadError.failed
        }
        return true
    }

    public func signUpload(filename: String, contentType: String, bytes: Int, meta: SharedCoreRequestMeta? = nil) async throws -> [String: Any]? {
        let payload: [String: Any] = [
            "filename": filename,
            "contentType": contentType,
            "bytes": bytes
        ]
        var arguments: [Any] = [payload]
        if let dictionary = meta?.toDictionary(), !dictionary.isEmpty {
            arguments.append(dictionary)
        }
        let value = try client.call("api.signUpload", arguments: arguments)
        return value.toDictionary() as? [String: Any]
    }

    public func finalizeUpload(payload: [String: Any], meta: SharedCoreRequestMeta? = nil) async throws -> [String: Any]? {
        var arguments: [Any] = [payload]
        if let dictionary = meta?.toDictionary(), !dictionary.isEmpty {
            arguments.append(dictionary)
        }
        let value = try client.call("api.finalizeUpload", arguments: arguments)
        return value.toDictionary() as? [String: Any]
    }
}

public enum UploadError: Error {
    case assetUnavailable
    case failed
}
