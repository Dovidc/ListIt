import XCTest
import SharedCoreBridge

final class SharedRuntimeTests: XCTestCase {
    func testEvaluatesScript() throws {
        let runtime = SharedRuntime()
        XCTAssertNoThrow(try runtime.evaluate("var value = 42"))
        let result = try runtime.call(function: "eval", with: ["value"])
        XCTAssertEqual(result.toInt32(), 42)
    }
}
