import Foundation

public protocol KeychainStoring {
    func store(data: Data, for key: String) throws
    func retrieveData(for key: String) throws -> Data?
    func removeData(for key: String) throws
}

#if canImport(Security)
import Security

public enum KeychainStoreError: Error {
    case unexpectedStatus(OSStatus)
}

public final class KeychainStore: KeychainStoring {
    private let service: String
    private let accessGroup: String?

    public init(service: String, accessGroup: String? = nil) {
        self.service = service
        self.accessGroup = accessGroup
    }

    public func store(data: Data, for key: String) throws {
        var query = baseQuery(for: key)
        query[kSecValueData as String] = data as CFData

        let status = SecItemCopyMatching(query as CFDictionary, nil)
        if status == errSecSuccess {
            let updateStatus = SecItemUpdate(baseQuery(for: key) as CFDictionary, [kSecValueData: data] as CFDictionary)
            guard updateStatus == errSecSuccess else {
                throw KeychainStoreError.unexpectedStatus(updateStatus)
            }
            return
        }

        if status == errSecItemNotFound {
            let addStatus = SecItemAdd(query as CFDictionary, nil)
            guard addStatus == errSecSuccess else {
                throw KeychainStoreError.unexpectedStatus(addStatus)
            }
            return
        }

        throw KeychainStoreError.unexpectedStatus(status)
    }

    public func retrieveData(for key: String) throws -> Data? {
        var query = baseQuery(for: key)
        query[kSecReturnData as String] = kCFBooleanTrue
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess else {
            throw KeychainStoreError.unexpectedStatus(status)
        }
        return result as? Data
    }

    public func removeData(for key: String) throws {
        let status = SecItemDelete(baseQuery(for: key) as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound {
            return
        }
        throw KeychainStoreError.unexpectedStatus(status)
    }

    private func baseQuery(for key: String) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
        if let accessGroup {
            query[kSecAttrAccessGroup as String] = accessGroup
        }
        return query
    }
}
#else
public enum KeychainStoreError: Error {
    case unavailable
}

public final class KeychainStore: KeychainStoring {
    private var storage: [String: Data] = [:]
    public init(service: String, accessGroup: String? = nil) {}

    public func store(data: Data, for key: String) throws {
        storage[key] = data
    }

    public func retrieveData(for key: String) throws -> Data? {
        storage[key]
    }

    public func removeData(for key: String) throws {
        storage.removeValue(forKey: key)
    }
}
#endif
