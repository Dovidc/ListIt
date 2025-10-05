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
