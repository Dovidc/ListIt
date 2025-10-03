import XCTest
@testable import SharedServices
import SharedCoreBridge
import PhotosUI
import JavaScriptCore
import Foundation

final class UploadServiceTests: XCTestCase {
    func testUploadPhotoThrowsWhenPromiseRejects() throws {
        let context = JSContext()!
        let runtime = FakeRuntime(response: .failure(SharedRuntimeError.javascript(message: "Promise rejected")), context: context)
        let service = UploadService(runtime: runtime, dataLoader: { _ in Data("image".utf8) })
        let item = unsafeBitCast(NSObject(), to: PhotosPickerItem.self)
        var didReportProgress = false

        XCTAssertThrowsError(
            try waitFor {
                try await service.uploadPhoto(from: item) { _ in
                    didReportProgress = true
                }
            }
        ) { error in
            guard
                let runtimeError = error as? SharedRuntimeError,
                case .javascript(let message) = runtimeError
            else {
                XCTFail("Expected SharedRuntimeError, got \(error)")
                return
            }
            XCTAssertEqual(message, "Promise rejected")
        }

        XCTAssertFalse(didReportProgress)
    }

    func testUploadPhotoThrowsFailedWhenResolvedFalsy() throws {
        let context = JSContext()!
        let response = JSValue(bool: false, in: context)!
        let runtime = FakeRuntime(response: .success(response), context: context)
        let service = UploadService(runtime: runtime, dataLoader: { _ in Data("image".utf8) })
        let item = unsafeBitCast(NSObject(), to: PhotosPickerItem.self)

        XCTAssertThrowsError(
            try waitFor {
                try await service.uploadPhoto(from: item) { _ in }
            }
        ) { error in
            guard let uploadError = error as? UploadError else {
                XCTFail("Expected UploadError.failed, got \(error)")
                return
            }
            if case .failed = uploadError {
                // expected
            } else {
                XCTFail("Expected UploadError.failed, got \(uploadError)")
            }
        }
    }
}

private final class FakeRuntime: SharedRuntime {
    enum Response {
        case success(JSValue)
        case failure(Error)
    }

    private let response: Response

    init(response: Response, context: JSContext) {
        self.response = response
        super.init(context: context)
    }

    override func call(function name: String, with arguments: [Any]) throws -> JSValue {
        XCTFail("Expected async call for \(name)")
        throw SharedRuntimeError.missingExport(name: name)
    }

    override func callAsync(function name: String, with arguments: [Any]) async throws -> JSValue {
        switch response {
        case .success(let value):
            await Task.yield()
            return value
        case .failure(let error):
            await Task.yield()
            throw error
        }
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
