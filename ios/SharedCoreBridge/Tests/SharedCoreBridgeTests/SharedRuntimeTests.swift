import XCTest
import SharedCoreBridge

final class SharedRuntimeTests: XCTestCase {
    func testEvaluatesScript() throws {
        let runtime = SharedRuntime()
        XCTAssertNoThrow(try runtime.evaluate("var value = 42"))
        let result = try runtime.call(function: "eval", with: ["value"])
        XCTAssertEqual(result.toInt32(), 42)
    }

    func testCallsNestedFunctionUsingDotNotation() throws {
        let runtime = SharedRuntime()
        try runtime.evaluate("var ListItCore = { api: { greet: function(name) { return 'Hello, ' + name; } } };")

        let result = try runtime.call(function: "ListItCore.api.greet", with: ["World"])

        XCTAssertEqual(result.toString(), "Hello, World")
    }

    func testCallResolvesPromiseResult() throws {
        let runtime = SharedRuntime()
        try runtime.evaluate("""
            var ListItCore = {
                api: {
                    fetchValue: function() {
                        return Promise.resolve(['one', 'two']);
                    }
                }
            };
            """)

        let result = try runtime.call(function: "ListItCore.api.fetchValue", with: [])
        let array = result.toArray() as? [String]

        XCTAssertEqual(array, ["one", "two"])
    }

    func testCallThrowsForRejectedPromise() throws {
        let runtime = SharedRuntime()
        try runtime.evaluate("""
            var ListItCore = {
                api: {
                    explode: function() {
                        return Promise.reject(new Error('boom'));
                    }
                }
            };
            """)

        XCTAssertThrowsError(try runtime.call(function: "ListItCore.api.explode", with: [])) { error in
            guard case SharedRuntimeError.javascript(let message) = error else {
                return XCTFail("Expected javascript error")
            }

            XCTAssertTrue(message.contains("boom"))
        }
    }

    func testThrowsMissingExportForMissingNestedFunction() throws {
        let runtime = SharedRuntime()
        try runtime.evaluate("var ListItCore = { api: {} };")

        XCTAssertThrowsError(try runtime.call(function: "ListItCore.api.greet", with: [])) { error in
            guard case SharedRuntimeError.missingExport(let name) = error else {
                return XCTFail("Expected missingExport error")
            }

            XCTAssertEqual(name, "ListItCore.api.greet")
        }
    }
}
