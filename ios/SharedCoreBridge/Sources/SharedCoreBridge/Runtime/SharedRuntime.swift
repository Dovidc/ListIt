import Foundation
import JavaScriptCore

open class SharedRuntime {
    private let context: JSContext
    public init(context: JSContext = JSContext()!) {
        self.context = context
        self.context.exceptionHandler = { _, exception in
            if let exception {
                print("[SharedRuntime] JS Exception: \(exception)")
            }
        }
    }

    open func evaluate(_ script: String) throws {
        context.evaluateScript(script)
        if let exception = context.exception {
            throw SharedRuntimeError.javascript(message: exception.toString())
        }
    }

    open func call(function name: String, with arguments: [Any]) throws -> JSValue {
        let result: JSValue?

        if name.contains(".") {
            let path = name.split(separator: ".").map(String.init)
            guard let methodName = path.last else {
                throw SharedRuntimeError.missingExport(name: name)
            }

            // Resolve the parent object for the method
            let parentPath = path.dropLast()
            var target: JSValue? = context.globalObject
            for component in parentPath {
                target = target?.forProperty(component)
            }

            guard let resolvedTarget = target, !resolvedTarget.isUndefined else {
                throw SharedRuntimeError.missingExport(name: name)
            }

            result = resolvedTarget.invokeMethod(methodName, withArguments: arguments)
        } else {
            guard let function = context.objectForKeyedSubscript(name) else {
                throw SharedRuntimeError.missingExport(name: name)
            }
            result = function.call(withArguments: arguments)
        }

        if let exception = context.exception {
            throw SharedRuntimeError.javascript(message: exception.toString())
        }
        guard let resolvedResult = result ?? JSValue(nullIn: context) else {
            throw SharedRuntimeError.javascript(message: "Unable to evaluate function \(name)")
        }
        return resolvedResult
    }

    open func installNativeBridge(_ bridge: SharedCoreNativeBridge) {
        context.setObject(bridge, forKeyedSubscript: "NativeBridge" as (NSCopying & NSObjectProtocol))
    }
}

public enum SharedRuntimeError: Error, LocalizedError {
    case javascript(message: String)
    case missingExport(name: String)

    public var errorDescription: String? {
        switch self {
        case .javascript(let message):
            return message
        case .missingExport(let name):
            return "Missing export: \(name)"
        }
    }
}
