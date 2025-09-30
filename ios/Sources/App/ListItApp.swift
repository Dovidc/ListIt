import SwiftUI
import AuthFeature
import ListingsFeature
import UploadFeature
import SharedServices
import SharedCoreBridge

@main
struct ListItApp: App {
    @StateObject private var appEnvironment = AppEnvironment()

    var body: some Scene {
        WindowGroup {
            RootTabView(environment: appEnvironment)
                .task { await appEnvironment.bootstrap() }
        }
    }
}

struct RootTabView: View {
    @ObservedObject var environment: AppEnvironment

    var body: some View {
        TabView {
            AuthFeatureView(authService: environment.authService)
                .tabItem {
                    Label("Account", systemImage: "person")
                }

            ListingsFeatureView(listingsService: environment.listingsService)
                .tabItem {
                    Label("Listings", systemImage: "list.bullet")
                }

            UploadFeatureView(uploadService: environment.uploadService)
                .tabItem {
                    Label("Uploads", systemImage: "icloud.and.arrow.up")
                }
        }
        .environmentObject(environment.configuration)
    }
}

final class AppEnvironment: ObservableObject {
    @Published var configuration = EnvironmentConfiguration()
    let authService: AuthService
    let listingsService: ListingsService
    let uploadService: UploadService

    init(sharedRuntime: SharedRuntime = SharedRuntime()) {
        self.authService = AuthService(runtime: sharedRuntime)
        self.listingsService = ListingsService(runtime: sharedRuntime)
        self.uploadService = UploadService(runtime: sharedRuntime)
    }

    @MainActor
    func bootstrap() async {
        do {
            try configuration.load()
            try await SharedCoreBridgeBootstrap.shared.ensureBundleLoaded(using: configuration)
        } catch {
            assertionFailure("Failed to bootstrap shared core: \(error)")
        }
    }
}
