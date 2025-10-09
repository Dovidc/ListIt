import XCTest
import SharedCoreBridge
import JavaScriptCore
@testable import SharedServices

final class MessagesServiceTests: XCTestCase {
    func testFetchConversationsParsesPayload() throws {
        let runtime = FakeRuntime()
        let context = JSContext()!
        let payload: [[String: Any]] = [[
            "id": 42,
            "other_user_id": 7,
            "other_user_username": "Alex",
            "listing_title": "Vintage Camera",
            "listing_id": 101,
            "listing_owner_id": 3,
            "image_data": "https://example.com/cover.jpg",
            "last_message_id": 9,
            "last_message_body": "See you soon",
            "last_message_at": "2024-06-01T12:00:00Z",
            "last_message_sender_id": 7,
            "last_message_is_admin": false,
            "other_user_deleted": 0
        ]]
        runtime.stubbedResult = JSValue(object: payload, in: context)

        let service = MessagesService(runtime: runtime)
        let conversations = try waitFor { try await service.fetchConversations() }

        XCTAssertEqual(conversations.count, 1)
        let first = try XCTUnwrap(conversations.first)
        XCTAssertEqual(first.id, "42")
        XCTAssertEqual(first.otherUserID, "7")
        XCTAssertEqual(first.otherUserName, "Alex")
        XCTAssertEqual(first.listingTitle, "Vintage Camera")
        XCTAssertEqual(first.listingID, "101")
        XCTAssertEqual(first.listingOwnerID, "3")
        XCTAssertEqual(first.coverImage, "https://example.com/cover.jpg")
        XCTAssertEqual(first.lastMessageID, "9")
        XCTAssertEqual(first.lastMessageBody, "See you soon")
        XCTAssertNotNil(first.lastMessageDate)
        XCTAssertEqual(first.lastMessageSenderID, "7")
        XCTAssertTrue(first.isUnread)
        XCTAssertFalse(first.otherUserDeleted)
    }

    func testFetchMessagesMapsValues() throws {
        let runtime = FakeRuntime()
        let context = JSContext()!
        let payload: [[String: Any]] = [[
            "id": 5,
            "sender_id": 7,
            "sender_username": "Alex",
            "body": "Interested in the listing",
            "created_at": 1_700_000_000,
            "images": ["https://example.com/photo.jpg"],
            "sender_is_admin": false
        ]]
        runtime.stubbedResult = JSValue(object: payload, in: context)

        let service = MessagesService(runtime: runtime)
        let messages = try waitFor { try await service.fetchMessages(conversationID: "42") }

        XCTAssertEqual(messages.count, 1)
        let first = try XCTUnwrap(messages.first)
        XCTAssertEqual(first.id, "5")
        XCTAssertEqual(first.senderID, "7")
        XCTAssertEqual(first.senderName, "Alex")
        XCTAssertEqual(first.body, "Interested in the listing")
        XCTAssertEqual(first.images, ["https://example.com/photo.jpg"])
        XCTAssertFalse(first.isFromAdmin)
        XCTAssertNotNil(first.sentAt)
    }

    func testSendMessageTrimsBodyAndParsesResponse() throws {
        let runtime = FakeRuntime()
        let context = JSContext()!
        runtime.stubbedResult = JSValue(object: [
            "message": [
                "id": 11,
                "sender_id": 1,
                "body": "Hello!",
                "created_at": "2024-06-01T12:15:00Z",
                "images": []
            ],
            "other_user_deleted": true
        ], in: context)

        let service = MessagesService(runtime: runtime)
        let result = try waitFor { try await service.sendMessage(conversationID: "42", body: "  Hello!  ") }

        XCTAssertEqual(runtime.capturedFunction, "ListItCore.api.sendMessage")
        let arguments = runtime.capturedArguments ?? []
        XCTAssertEqual(arguments.count, 3)
        XCTAssertEqual(arguments[0] as? Int, 42)
        XCTAssertEqual(arguments[1] as? String, "Hello!")
        let message = result.message
        XCTAssertEqual(message.id, "11")
        XCTAssertEqual(message.senderID, "1")
        XCTAssertEqual(message.body, "Hello!")
        XCTAssertTrue(result.otherUserDeleted)
    }

    func testDeleteConversationCoercesIdentifier() throws {
        let runtime = FakeRuntime()
        let context = JSContext()!
        runtime.stubbedResult = JSValue(nullIn: context)

        let service = MessagesService(runtime: runtime)
        _ = try waitFor { try await service.deleteConversation(conversationID: "0099") }

        XCTAssertEqual(runtime.capturedFunction, "ListItCore.api.deleteConversation")
        XCTAssertEqual(runtime.capturedArguments?.first as? Int, 99)
    }
}

private final class FakeRuntime: SharedRuntime {
    let context = JSContext()!
    var stubbedResult: JSValue?
    var capturedArguments: [Any]?
    var capturedFunction: String?
    var stubbedError: Error?

    override func call(function name: String, with arguments: [Any]) throws -> JSValue {
        capturedFunction = name
        capturedArguments = arguments
        if let stubbedError {
            throw stubbedError
        }
        return stubbedResult ?? JSValue(nullIn: context)
    }
}

@discardableResult
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
