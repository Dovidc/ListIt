import Foundation
import SharedCoreBridge
import JavaScriptCore

public final class SharedCoreClient {
    private let runtime: SharedRuntime

    public init(runtime: SharedRuntime) {
        self.runtime = runtime
    }

    @discardableResult
    public func call(_ method: String, arguments: [Any] = []) throws -> JSValue {
        try runtime.call(function: "shared_core_call", with: [method, arguments])
    }

    public func callObject(_ method: String, arguments: [Any] = []) throws -> Any? {
        let value = try call(method, arguments: arguments)
        if value.isUndefined || value.isNull {
            return nil
        }
        return value.toObject()
    }

    public func callDictionary(_ method: String, arguments: [Any] = []) throws -> [String: Any] {
        guard let dictionary = try callObject(method, arguments: arguments) as? [String: Any] else {
            return [:]
        }
        return dictionary
    }

    public func callArray(_ method: String, arguments: [Any] = []) throws -> [Any] {
        guard let array = try callObject(method, arguments: arguments) as? [Any] else {
            return []
        }
        return array
    }

    public func callBool(_ method: String, arguments: [Any] = []) throws -> Bool {
        try call(method, arguments: arguments).toBool()
    }

    public func callString(_ method: String, arguments: [Any] = []) throws -> String {
        let value = try call(method, arguments: arguments)
        return value.toString() ?? ""
    }
}
