import Foundation
import JavaScriptCore
import Dispatch

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

            guard let method = resolvedTarget.forProperty(methodName), !method.isUndefined else {
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
        if SharedRuntime.isPromise(resolvedResult) {
            return try resolvePromise(resolvedResult, functionName: name)
        }
        return resolvedResult
    }

    open func installNativeBridge(_ bridge: SharedCoreNativeBridge) {
        context.setObject(bridge, forKeyedSubscript: "NativeBridge" as (NSCopying & NSObjectProtocol))
    }
}

private extension SharedRuntime {
    static func isPromise(_ value: JSValue) -> Bool {
        guard value.isObject else { return false }
        return value.hasProperty("then")
    }

    func resolvePromise(_ value: JSValue, functionName: String, timeout: TimeInterval = 30) throws -> JSValue {
        let semaphore = DispatchSemaphore(value: 0)
        var resolved: JSValue?
        var rejection: JSValue?

        typealias PromiseHandler = @convention(block) (JSValue?) -> Void
        let fulfill: PromiseHandler = { result in
            resolved = result
            semaphore.signal()
        }
        let reject: PromiseHandler = { error in
            rejection = error
            semaphore.signal()
        }

        value.invokeMethod("then", withArguments: [fulfill, reject])

        let deadline = Date().addingTimeInterval(timeout)
        while semaphore.wait(timeout: .now()) == .timedOut {
            if Date() > deadline {
                throw SharedRuntimeError.javascript(message: "Timed out waiting for Promise from \(functionName)")
            }
            context.virtualMachine?.performMicrotaskCheckpoint()
            Thread.sleep(forTimeInterval: 0.001)
        }

        if let rejection, !rejection.isUndefined {
            throw SharedRuntimeError.javascript(message: rejection.toString())
        }

        guard let resolvedValue = resolved ?? JSValue(nullIn: context) else {
            throw SharedRuntimeError.javascript(message: "Promise from \(functionName) resolved with no value")
        }
        if SharedRuntime.isPromise(resolvedValue) {
            return try resolvePromise(resolvedValue, functionName: functionName, timeout: timeout)
        }
        return resolvedValue
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
