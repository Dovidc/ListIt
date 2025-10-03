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
    private let keychain: KeychainStoring
    public init(
        runtime: SharedRuntime,
        keychain: KeychainStoring = KeychainStore(service: Constants.keychainService)
    ) {
        self.runtime = runtime
        self.keychain = keychain
    }

    public func signIn(email: String, password: String) async throws -> AuthResult {
        let payload: [String: Any] = [
            "email": email,
            "password": password
        ]
        let response = try await runtime.callAsync(function: "auth_signIn", with: [payload])
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
