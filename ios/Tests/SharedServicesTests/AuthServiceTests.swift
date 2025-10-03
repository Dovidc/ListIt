import XCTest
@testable import SharedServices
import SharedCoreBridge
import JavaScriptCore

final class AuthServiceTests: XCTestCase {
    func testSignInPersistsTokens() throws {
        let runtime = FakeRuntime()
        let context = JSContext()!
        runtime.stubbedResponse = JSValue(object: ["token": "abc", "refreshToken": "def", "expiresAt": 1_700_000_000], in: context)
        let keychain = InMemoryKeychainStore()
        let service = AuthService(runtime: runtime, keychain: keychain)

        let result = try waitFor {
            try await service.signIn(email: "user@example.com", password: "password")
        }

        XCTAssertTrue(result.isSuccess)
        XCTAssertEqual(result.tokens?.accessToken, "abc")
        XCTAssertEqual(service.currentTokens(), AuthTokens(accessToken: "abc", refreshToken: "def", expiresAt: Date(timeIntervalSince1970: 1_700_000_000)))
        XCTAssertEqual(runtime.invokedFunctions, ["auth_signIn"])
    }

    func testSignOutClearsTokens() throws {
        let runtime = FakeRuntime()
        let context = JSContext()!
        runtime.stubbedResponse = JSValue(object: ["token": "abc"], in: context)
        let keychain = InMemoryKeychainStore()
        let service = AuthService(runtime: runtime, keychain: keychain)

        _ = try waitFor {
            try await service.signIn(email: "user@example.com", password: "password")
        }

        try service.signOut()
        XCTAssertNil(service.currentTokens())
    }
}

private final class InMemoryKeychainStore: KeychainStoring {
    private var storage: [String: Data] = [:]

    func store(data: Data, for key: String) throws {
        storage[key] = data
    }

    func retrieveData(for key: String) throws -> Data? {
        storage[key]
    }

    func removeData(for key: String) throws {
        storage.removeValue(forKey: key)
    }
}

private final class FakeRuntime: SharedRuntime {
    var stubbedResponse: JSValue?
    private(set) var invokedFunctions: [String] = []

    override func call(function name: String, with arguments: [Any]) throws -> JSValue {
        XCTFail("Expected async call for \(name)")
        throw SharedRuntimeError.missingExport(name: name)
    }

    override func callAsync(function name: String, with arguments: [Any]) async throws -> JSValue {
        invokedFunctions.append(name)
        guard let stubbedResponse else { throw SharedRuntimeError.missingExport(name: name) }
        await Task.yield()
        return stubbedResponse
    }
}

private func waitFor<T>(_ closure: @escaping () async throws -> T) rethrows -> T {
    let expectation = XCTestExpectation(description: "async")
    var result: Result<T, Error>!
    Task {
        do {
            result = .success(try await closure())
        } catch {
            result = .failure(error)
        }
        expectation.fulfill()
    }
    XCTWaiter().wait(for: [expectation], timeout: 1)
    return try result.get()
}
