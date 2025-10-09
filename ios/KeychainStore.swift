import Foundation
import Security

public protocol KeychainStoring {
    func store(data: Data, for key: String) throws
    func retrieveData(for key: String) throws -> Data?
    func removeData(for key: String) throws
}

public struct KeychainStore: KeychainStoring {
    private let service: String
    
    public init(service: String) {
        self.service = service
    }
    
    public func store(data: Data, for key: String) throws {
        // First try to update existing item
        let updateQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
        
        let updateAttributes: [String: Any] = [
            kSecValueData as String: data
        ]
        
        let updateStatus = SecItemUpdate(updateQuery as CFDictionary, updateAttributes as CFDictionary)
        
        if updateStatus == errSecItemNotFound {
            // Item doesn't exist, create new one
            let addQuery: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: key,
                kSecValueData as String: data,
                kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            ]
            
            let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
            guard addStatus == errSecSuccess else {
                throw KeychainError.storeFailed(status: addStatus)
            }
        } else if updateStatus != errSecSuccess {
            throw KeychainError.storeFailed(status: updateStatus)
        }
    }
    
    public func retrieveData(for key: String) throws -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        
        if status == errSecItemNotFound {
            return nil
        } else if status == errSecSuccess {
            return result as? Data
        } else {
            throw KeychainError.retrieveFailed(status: status)
        }
    }
    
    public func removeData(for key: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
        
        let status = SecItemDelete(query as CFDictionary)
        if status != errSecSuccess && status != errSecItemNotFound {
            throw KeychainError.deleteFailed(status: status)
        }
    }
}

public enum KeychainError: Error, LocalizedError {
    case storeFailed(status: OSStatus)
    case retrieveFailed(status: OSStatus)
    case deleteFailed(status: OSStatus)
    
    public var errorDescription: String? {
        switch self {
        case .storeFailed(let status):
            return "Failed to store keychain item: \(status)"
        case .retrieveFailed(let status):
            return "Failed to retrieve keychain item: \(status)"
        case .deleteFailed(let status):
            return "Failed to delete keychain item: \(status)"
        }
    }
}