import Foundation
import JavaScriptCore
import Dispatch

open class SharedRuntime {
    private let context: JSContext
    public var jsContext: JSContext { context }
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
            let message = exception.toString() ?? "Unknown JavaScript error"
            throw SharedRuntimeError.javascript(message: message)
        }
    }

    open func call(function name: String, with arguments: [Any]) throws -> JSValue {
        guard let function = context.objectForKeyedSubscript(name) else {
            throw SharedRuntimeError.missingExport(name: name)
        }
        let result = function.call(withArguments: arguments)
        if let exception = context.exception {
            let message = exception.toString() ?? "Unknown JavaScript error"
            throw SharedRuntimeError.javascript(message: message)
        }

        guard let evaluatedResult = try resolveIfNeeded(result, functionName: name) else {
            throw SharedRuntimeError.javascript(message: "Unable to evaluate function \(name)")
        }
        return evaluatedResult
    }

    open func installNativeBridge(_ bridge: SharedCoreNativeBridge) {
        context.setObject(bridge, forKeyedSubscript: "NativeBridge" as (NSCopying & NSObjectProtocol))
    }
}

public enum SharedRuntimeError: Error, LocalizedError {
    case javascript(message: String)
    case missingExport(name: String)
    case promiseTimedOut(name: String)

    public var errorDescription: String? {
        switch self {
        case .javascript(let message):
            return message
        case .missingExport(let name):
            return "Missing export: \(name)"
        case .promiseTimedOut(let name):
            return "Promise timed out for \(name)"
        }
    }
}

private extension SharedRuntime {
    func resolveIfNeeded(_ value: JSValue?, functionName: String) throws -> JSValue? {
        guard let value else { return JSValue(nullIn: context) }

        if value.isNull || value.isUndefined {
            return JSValue(nullIn: context)
        }

        if value.hasProperty("then"), value.forProperty("then")?.isObject == true {
            return try resolvePromise(value, functionName: functionName)
        }

        return value
    }

    func resolvePromise(_ promise: JSValue, functionName: String) throws -> JSValue? {
        let semaphore = DispatchSemaphore(value: 0)
        var resolved: JSValue?
        var rejected: JSValue?

        let fulfill: @convention(block) (JSValue?) -> Void = { result in
            resolved = result
            semaphore.signal()
        }

        let reject: @convention(block) (JSValue?) -> Void = { error in
            rejected = error
            semaphore.signal()
        }

        promise.invokeMethod("then", withArguments: [fulfill, reject])

        let timeout = DispatchTime.now() + .seconds(30)
        let runLoop = RunLoop.current

        while resolved == nil && rejected == nil {
            let waitResult = semaphore.wait(timeout: .now() + .milliseconds(10))
            switch waitResult {
            case .success:
                break
            case .timedOut:
                if DispatchTime.now() >= timeout {
                    throw SharedRuntimeError.promiseTimedOut(name: functionName)
                }
                runLoop.run(mode: .default, before: Date(timeIntervalSinceNow: 0.001))
            }
        }

        if let rejection = rejected {
            let message = rejection.toString() ?? "Unknown JavaScript error"
            throw SharedRuntimeError.javascript(message: message)
        }

        if let resolved {
            if resolved.isNull || resolved.isUndefined {
                return JSValue(nullIn: context)
            }
            return resolved
        }

        if DispatchTime.now() >= timeout {
            throw SharedRuntimeError.promiseTimedOut(name: functionName)
        }

        return JSValue(nullIn: context)
    }
}
