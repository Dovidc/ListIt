import Foundation
import JavaScriptCore
import Dispatch

open class SharedRuntime {
    private let context: JSContext
    private let runtimeQueue: DispatchQueue
    private let promiseTimeout: DispatchTimeInterval = .seconds(30)
    private let queueSpecificKey = DispatchSpecificKey<Void>()

    public init(
        context: JSContext = JSContext()!,
        queue: DispatchQueue = DispatchQueue(label: "com.listit.sharedruntime", qos: .userInitiated)
    ) {
        self.context = context
        self.runtimeQueue = queue
        self.runtimeQueue.setSpecific(key: queueSpecificKey, value: ())
        self.context.exceptionHandler = { _, exception in
            if let exception {
                print("[SharedRuntime] JS Exception: \(exception)")
            }
        }
    }

    open func evaluate(_ script: String) throws {
        var thrownError: Error?
        executeOnRuntimeQueue {
            self.context.evaluateScript(script)
            if let exception = self.context.exception {
                thrownError = SharedRuntimeError.javascript(message: exception.toString())
            }
        }

        if let thrownError {
            throw thrownError
        }
    }

    open func call(function name: String, with arguments: [Any]) throws -> JSValue {
        let semaphore = DispatchSemaphore(value: 0)
        var capturedResult: Result<JSValue, Error>?

        runtimeQueue.async {
            self.invoke(function: name, arguments: arguments) { result in
                capturedResult = result
                semaphore.signal()
            }
        }

        semaphore.wait()

        guard let capturedResult else {
            throw SharedRuntimeError.javascript(message: "Unable to evaluate function \(name)")
        }

        switch capturedResult {
        case .success(let value):
            return value
        case .failure(let error):
            throw error
        }
    }

    open func installNativeBridge(_ bridge: SharedCoreNativeBridge) {
        executeOnRuntimeQueue {
            self.context.setObject(bridge, forKeyedSubscript: "NativeBridge" as (NSCopying & NSObjectProtocol))
        }
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
    func executeOnRuntimeQueue(_ work: () -> Void) {
        if DispatchQueue.getSpecific(key: queueSpecificKey) != nil {
            work()
        } else {
            runtimeQueue.sync(execute: work)
        }
    }
}

private extension SharedRuntime {
    func invoke(
        function name: String,
        arguments: [Any],
        completion: @escaping (Result<JSValue, Error>) -> Void
    ) {
        guard let function = context.objectForKeyedSubscript(name) else {
            completion(.failure(SharedRuntimeError.missingExport(name: name)))
            return
        }

        let result = function.call(withArguments: arguments)
        if let exception = context.exception {
            completion(.failure(SharedRuntimeError.javascript(message: exception.toString())))
            return
        }

        do {
            if let evaluatedResult = try resolveIfNeeded(result, functionName: name, completion: completion) {
                completion(.success(evaluatedResult))
            }
        } catch {
            completion(.failure(error))
        }
    }

    func resolveIfNeeded(
        _ value: JSValue?,
        functionName: String,
        completion: @escaping (Result<JSValue, Error>) -> Void
    ) throws -> JSValue? {
        guard let value else { return JSValue(nullIn: context) }

        if value.isNull || value.isUndefined {
            return JSValue(nullIn: context)
        }

        if value.hasProperty("then"), value.forProperty("then")?.isObject == true {
            resolvePromise(value, functionName: functionName, completion: completion)
            return nil
        }

        return value
    }

    func resolvePromise(
        _ promise: JSValue,
        functionName: String,
        completion: @escaping (Result<JSValue, Error>) -> Void
    ) {
        var isCompleted = false
        let timeoutWorkItem = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            guard !isCompleted else { return }
            isCompleted = true
            completion(.failure(SharedRuntimeError.promiseTimedOut(name: functionName)))
        }

        runtimeQueue.asyncAfter(deadline: .now() + promiseTimeout, execute: timeoutWorkItem)

        let fulfill: @convention(block) (JSValue?) -> Void = { [weak self] result in
            guard let self = self else { return }
            guard !isCompleted else { return }
            isCompleted = true
            timeoutWorkItem.cancel()
            completion(.success(self.normalize(result)))
        }

        let reject: @convention(block) (JSValue?) -> Void = { [weak self] error in
            guard let self = self else { return }
            guard !isCompleted else { return }
            isCompleted = true
            timeoutWorkItem.cancel()
            let message = error?.toString() ?? "Unknown error"
            completion(.failure(SharedRuntimeError.javascript(message: message)))
        }

        promise.invokeMethod("then", withArguments: [fulfill, reject])
    }

    func normalize(_ value: JSValue?) -> JSValue {
        guard let value else { return JSValue(nullIn: context) }
        if value.isNull || value.isUndefined {
            return JSValue(nullIn: context)
        }
        return value
    }
}
