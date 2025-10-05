import Foundation
import SharedCoreBridge
import JavaScriptCore

public struct AuthResult {
    public let isSuccess: Bool
    public let tokens: AuthTokens?
}

public struct AuthTokens: Codable, Equatable {
    public let accessToken: String
    public let refreshToken: String?
    public let expiresAt: Date?
}

public final class AuthService {
    private enum Constants {
        static let keychainKey = "com.listit.app.auth.tokens"
        static let keychainService = "com.listit.app.auth"
    }

    private let runtime: SharedRuntime
    private let client: SharedCoreClient
    private let keychain: KeychainStoring

    public init(runtime: SharedRuntime, keychain: KeychainStoring? = nil) {
        self.runtime = runtime
        self.client = SharedCoreClient(runtime: runtime)
        self.keychain = keychain ?? KeychainStore(service: Constants.keychainService)
    }

    public func signIn(email: String, password: String) async throws -> AuthResult {
        let payload: [String: Any] = [
            "email": email,
            "password": password
        ]
        let response = try client.call("auth.signIn", arguments: [payload])
        let tokens = try extractTokens(from: response)
        if let tokens {
            try persist(tokens: tokens)
            return AuthResult(isSuccess: true, tokens: tokens)
        }
        let success = response.toBool()
        if !success {
            try keychain.removeData(for: Constants.keychainKey)
        }
        return AuthResult(isSuccess: success, tokens: nil)
    }

    public func currentTokens() -> AuthTokens? {
        guard let data = try? keychain.retrieveData(for: Constants.keychainKey) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        return try? decoder.decode(AuthTokens.self, from: data)
    }

    public func signOut() throws {
        try keychain.removeData(for: Constants.keychainKey)
    }

    public func remoteSignOut(meta: SharedCoreRequestMeta? = nil) async throws {
        var arguments: [Any] = []
        if let metaDictionary = meta?.toDictionary(), !metaDictionary.isEmpty {
            arguments.append(metaDictionary)
        }
        _ = try client.call("api.logout", arguments: arguments)
        try signOut()
    }

    public func fetchProfile(meta: SharedCoreRequestMeta? = nil) async throws -> [String: Any]? {
        var arguments: [Any] = []
        if let metaDictionary = meta?.toDictionary(), !metaDictionary.isEmpty {
            arguments.append(metaDictionary)
        }
        let value = try client.call("api.me", arguments: arguments)
        return value.toDictionary() as? [String: Any]
    }

    public func register(payload: [String: Any], meta: SharedCoreRequestMeta? = nil) async throws -> [String: Any]? {
        var arguments: [Any] = [payload]
        if let metaDictionary = meta?.toDictionary(), !metaDictionary.isEmpty {
            arguments.append(metaDictionary)
        }
        let value = try client.call("api.register", arguments: arguments)
        return value.toDictionary() as? [String: Any]
    }

    public func pushSubscribe(subscription: Any?, meta: SharedCoreRequestMeta? = nil) async throws -> Any? {
        var arguments: [Any] = []
        if let subscription { arguments.append(subscription) }
        if let metaDictionary = meta?.toDictionary(), !metaDictionary.isEmpty {
            arguments.append(metaDictionary)
        }
        return try client.callObject("api.pushSubscribe", arguments: arguments)
    }

    public func pushUnsubscribe(subscription: Any?, meta: SharedCoreRequestMeta? = nil) async throws -> Any? {
        var arguments: [Any] = []
        if let subscription { arguments.append(subscription) }
        if let metaDictionary = meta?.toDictionary(), !metaDictionary.isEmpty {
            arguments.append(metaDictionary)
        }
        return try client.callObject("api.pushUnsubscribe", arguments: arguments)
    }

    public func updatePaypalEmail(_ email: String, meta: SharedCoreRequestMeta? = nil) async throws -> [String: Any]? {
        var arguments: [Any] = [email]
        if let metaDictionary = meta?.toDictionary(), !metaDictionary.isEmpty {
            arguments.append(metaDictionary)
        }
        let value = try client.call("api.updatePaypalEmail", arguments: arguments)
        return value.toDictionary() as? [String: Any]
    }

    private func extractTokens(from value: JSValue) throws -> AuthTokens? {
        guard let dictionary = value.toDictionary() as? [String: Any] else {
            return nil
        }
        guard let accessToken = dictionary["token"] as? String ?? dictionary["accessToken"] as? String else {
            return nil
        }
        let refreshToken = dictionary["refreshToken"] as? String
        let expiresAt: Date?
        if let expiresValue = dictionary["expiresAt"] {
            if let timestamp = expiresValue as? TimeInterval {
                expiresAt = Date(timeIntervalSince1970: timestamp)
            } else if let stringValue = expiresValue as? String, let interval = TimeInterval(stringValue) {
                expiresAt = Date(timeIntervalSince1970: interval)
            } else {
                expiresAt = nil
            }
        } else {
            expiresAt = nil
        }

        return AuthTokens(accessToken: accessToken, refreshToken: refreshToken, expiresAt: expiresAt)
    }

    private func persist(tokens: AuthTokens) throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970
        let data = try encoder.encode(tokens)
        try keychain.store(data: data, for: Constants.keychainKey)
    }
}
