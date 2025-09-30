import Foundation
import SharedCoreBridge

public struct AuthResult {
    public let isSuccess: Bool
}

public final class AuthService {
    private let runtime: SharedRuntime

    public init(runtime: SharedRuntime) {
        self.runtime = runtime
    }

    public func signIn(email: String, password: String) async throws -> AuthResult {
        let payload: [String: Any] = [
            "email": email,
            "password": password
        ]
        let response = try runtime.call(function: "auth_signIn", with: [payload])
        return AuthResult(isSuccess: response.toBool())
    }
}
