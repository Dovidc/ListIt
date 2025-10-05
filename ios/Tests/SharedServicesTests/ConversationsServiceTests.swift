import XCTest
@testable import SharedServices
import SharedCoreBridge
import JavaScriptCore

final class ConversationsServiceTests: XCTestCase {
    func testFetchConversationsParsesSummary() throws {
        let runtime = FakeRuntime()
        let context = JSContext()!
        let rawConversation: [String: Any] = [
            "id": 42,
            "listing_title": "Handmade Table",
            "last_message_preview": "Is this still available?",
            "last_message_at": "2024-01-01T12:00:00Z",
            "unread_count": 2
        ]

        runtime.stubbedResponses["api.listConversations"] = JSValue(object: [rawConversation], in: context)
        runtime.stubbedResponses["helpers.asArray"] = JSValue(object: [rawConversation], in: context)

        let service = ConversationsService(runtime: runtime)
        let summaries = try waitFor { try await service.fetchConversations() }

        XCTAssertEqual(summaries.first?.id, "42")
        XCTAssertEqual(summaries.first?.title, "Handmade Table")
        XCTAssertEqual(summaries.first?.unreadCount, 2)
    }

    func testFetchMessagesParsesMessage() throws {
        let runtime = FakeRuntime()
        let context = JSContext()!
        let rawMessage: [String: Any] = [
            "id": "m-1",
            "body": "Hello!",
            "sender_display_name": "Alex",
            "created_at": "2024-01-01T12:00:00Z",
            "images": ["https://example.com/image.jpg"]
        ]

        runtime.stubbedResponses["api.getMessages"] = JSValue(object: [rawMessage], in: context)
        runtime.stubbedResponses["helpers.asArray"] = JSValue(object: [rawMessage], in: context)

        let service = ConversationsService(runtime: runtime)
        let messages = try waitFor { try await service.fetchMessages(id: "convo-1") }

        XCTAssertEqual(messages.first?.id, "m-1")
        XCTAssertEqual(messages.first?.senderName, "Alex")
        XCTAssertEqual(messages.first?.attachmentURLs.first?.absoluteString, "https://example.com/image.jpg")
    }

    func testSendMessageReturnsConversationMessage() throws {
        let runtime = FakeRuntime()
        let context = JSContext()!
        let response: [String: Any] = [
            "id": "m-2",
            "body": "Thanks!",
            "sender_display_name": "Jordan",
            "created_at": "2024-01-02T09:30:00Z"
        ]

        runtime.stubbedResponses["api.sendMessage"] = JSValue(object: response, in: context)

        let service = ConversationsService(runtime: runtime)
        let message = try waitFor { try await service.sendMessage(id: "convo-1", body: "Thanks!") }

        XCTAssertEqual(message?.id, "m-2")
        XCTAssertEqual(message?.senderName, "Jordan")
    }
}

private final class FakeRuntime: SharedRuntime {
    var stubbedResponses: [String: JSValue] = [:]
    var stubbedError: Error?

    override func call(function name: String, with arguments: [Any]) throws -> JSValue {
        if let stubbedError { throw stubbedError }
        guard name == "shared_core_call",
              let method = arguments.first as? String,
              let response = stubbedResponses[method]
        else {
            throw SharedRuntimeError.missingExport(name: name)
        }
        return response
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
