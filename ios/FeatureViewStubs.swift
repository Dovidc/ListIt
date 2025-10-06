import SwiftUI
import SharedCoreBridge

public struct AuthFeatureView: View {
    let authService: AuthService
    let eventHandler: (String, [String: Any]) -> Void
    
    public init(authService: AuthService, eventHandler: @escaping (String, [String: Any]) -> Void) {
        self.authService = authService
        self.eventHandler = eventHandler
    }
    
    public var body: some View {
        VStack {
            Text("Authentication Feature")
            // Add your auth UI here
        }
        .padding()
    }
}

public struct ListingsFeatureView: View {
    let listingsService: ListingsService
    let uploadService: UploadService
    let eventHandler: (String, [String: Any]) -> Void

    public init(listingsService: ListingsService, uploadService: UploadService, eventHandler: @escaping (String, [String: Any]) -> Void) {
        self.listingsService = listingsService
        self.uploadService = uploadService
        self.eventHandler = eventHandler
    }
    
    public var body: some View {
        VStack {
            Text("Listings Feature")
            // Add your listings UI here
        }
        .padding()
    }
}

public struct UploadFeatureView: View {
    let uploadService: UploadService
    let eventHandler: (String, [String: Any]) -> Void
    
    public init(uploadService: UploadService, eventHandler: @escaping (String, [String: Any]) -> Void) {
        self.uploadService = uploadService
        self.eventHandler = eventHandler
    }
    
    public var body: some View {
        VStack {
            Text("Upload Feature")
            // Add your upload UI here
        }
        .padding()
    }
}