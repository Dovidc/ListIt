import SwiftUI
import AuthFeature
import ListingsFeature
import UploadFeature
import SharedServices
import SharedCoreBridge
import DesignSystem
import PlatformCapabilities

@main
struct ListItApp: App {
    @StateObject private var appEnvironment = AppEnvironment()

    init() {
        AppearanceConfigurator.configure()
    }

    var body: some Scene {
        WindowGroup {
            DesignSystemProvider(theme: appEnvironment.theme) {
                RootTabView(environment: appEnvironment)
            }
            .task { await appEnvironment.bootstrap() }
        }
    }
}

struct RootTabView: View {
    @ObservedObject var environment: AppEnvironment

    var body: some View {
        TabView {
            AuthFeatureView(authService: environment.authService) { name, payload in
                environment.emitCapabilityEvent(name, payload: payload)
            }
                .tabItem {
                    Label("Account", systemImage: "person")
                }

            ListingsFeatureView(listingsService: environment.listingsService) { name, payload in
                environment.emitCapabilityEvent(name, payload: payload)
            }
                .tabItem {
                    Label("Listings", systemImage: "list.bullet")
                }

            UploadFeatureView(uploadService: environment.uploadService) { name, payload in
                environment.emitCapabilityEvent(name, payload: payload)
            }
                .tabItem {
                    Label("Uploads", systemImage: "icloud.and.arrow.up")
                }
        }
        .environmentObject(environment.configuration)
    }
}

final class AppEnvironment: ObservableObject {
    @Published var configuration: EnvironmentConfiguration
    @Published var theme: DesignSystemTheme
    let authService: AuthService
    let listingsService: ListingsService
    let uploadService: UploadService
    private let capabilityRouter: CapabilityRouting

    init(
        sharedRuntime: SharedRuntime = SharedRuntime(),
        configuration: EnvironmentConfiguration = EnvironmentConfiguration(),
        capabilityRouter: CapabilityRouting = CapabilityRouter()
    ) {
        self.configuration = configuration
        self.theme = DesignSystemTheme()
        self.capabilityRouter = capabilityRouter

        configuration.setCapabilityEventHandler { [capabilityRouter] name, payload in
            capabilityRouter.handle(event: CapabilityEvent(name: name, payload: payload))
        }

        SharedRuntimeRegistry.shared.register(runtime: sharedRuntime)
        self.authService = AuthService(runtime: sharedRuntime)
        self.listingsService = ListingsService(runtime: sharedRuntime)
        self.uploadService = UploadService(runtime: sharedRuntime)
    }

    @MainActor
    func bootstrap() async {
        do {
            try configuration.load()
            theme = configuration.designSystemTheme()
            capabilityRouter.updateConfiguration(configuration.capabilityConfiguration())
            try await SharedCoreBridgeBootstrap.shared.ensureBundleLoaded(using: configuration)
        } catch {
            assertionFailure("Failed to bootstrap shared core: \(error)")
        }
    }

    func emitCapabilityEvent(_ name: String, payload: [String: Any] = [:]) {
        capabilityRouter.handle(event: CapabilityEvent(name: name, payload: payload))
    }
}
