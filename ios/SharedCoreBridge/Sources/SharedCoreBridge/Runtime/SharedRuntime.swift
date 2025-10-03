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
        guard let function = context.objectForKeyedSubscript(name) else {
            throw SharedRuntimeError.missingExport(name: name)
        }
        let result = function.call(withArguments: arguments)
        if let exception = context.exception {
            throw SharedRuntimeError.javascript(message: exception.toString())
        }
        guard let resolvedResult = result ?? JSValue(nullIn: context) else {
            throw SharedRuntimeError.javascript(message: "Unable to evaluate function \(name)")
        }
        return resolvedResult
    }

    open func callAsync(function name: String, with arguments: [Any]) async throws -> JSValue {
        let result = try call(function: name, with: arguments)
        return try await resolveIfPromise(result)
    }

    private func resolveIfPromise(_ value: JSValue) async throws -> JSValue {
        guard value.isObject, let then = value.forProperty("then"), then.isObject else {
            return value
        }

        return try await withCheckedThrowingContinuation { continuation in
            var isResolved = false
            let context = self.context

            let fulfillBlock: @convention(block) (JSValue?) -> Void = { resolved in
                guard !isResolved else { return }
                isResolved = true
                let resultValue = resolved ?? JSValue(nullIn: context)
                if let resultValue {
                    continuation.resume(returning: resultValue)
                } else {
                    continuation.resume(throwing: SharedRuntimeError.javascript(message: "Promise resolved with invalid value"))
                }
            }

            let rejectBlock: @convention(block) (JSValue?) -> Void = { error in
                guard !isResolved else { return }
                isResolved = true
                let message = error?.toString() ?? "Promise rejected"
                continuation.resume(throwing: SharedRuntimeError.javascript(message: message))
            }

            guard
                let fulfill = JSValue(object: fulfillBlock, in: context),
                let reject = JSValue(object: rejectBlock, in: context)
            else {
                isResolved = true
                continuation.resume(throwing: SharedRuntimeError.javascript(message: "Unable to create promise handlers"))
                return
            }

            self.context.exception = nil
            _ = value.invokeMethod("then", withArguments: [fulfill, reject])
            if let exception = self.context.exception, !isResolved {
                isResolved = true
                continuation.resume(throwing: SharedRuntimeError.javascript(message: exception.toString()))
            }
        }
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
