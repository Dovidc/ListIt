import Combine
import SwiftUI
import ListingsFeature
import SharedServices
import SharedCoreBridge
import DesignSystem
import PlatformCapabilities
import ProfileFeature
import NearbyFeature
import MessagesFeature
import AdminFeature

@main
struct ListItApp: App {
    init() {
        AppearanceConfigurator.configure()
    }

    var body: some Scene {
        WindowGroup {
            if WebShellLauncher.shouldUseShell {
                WebShellRootView()
            } else {
                NativeRootView()
            }
        }
    }
}

struct NativeRootView: View {
    @StateObject private var appEnvironment = AppEnvironment()

    var body: some View {
        DesignSystemProvider(theme: appEnvironment.theme) {
            RootTabView(environment: appEnvironment)
        }
        .task { await appEnvironment.bootstrap() }
    }
}

struct RootTabView: View {
    @ObservedObject var environment: AppEnvironment

    var body: some View {
        TabView {
            ListingsFeatureView(listingsService: environment.listingsService) { name, payload in
                environment.emitCapabilityEvent(name, payload: payload)
            }
                .tabItem {
                    Label("Listings", systemImage: "list.bullet")
                }

            NearbyFeatureView(nearbyService: environment.nearbyService) { name, payload in
                environment.emitCapabilityEvent(name, payload: payload)
            }
                .tabItem {
                    Label("Nearby", systemImage: "location.circle")
                }

            MessagesFeatureView(messagesService: environment.messagesService) { name, payload in
                environment.emitCapabilityEvent(name, payload: payload)
            }
                .tabItem {
                    Label("Messages", systemImage: "bubble.left.and.bubble.right")
                }

            ProfileFeatureView(preferencesService: environment.preferencesService) { name, payload in
                environment.emitCapabilityEvent(name, payload: payload)
            }
                .tabItem {
                    Label("Profile", systemImage: "person.crop.circle")
                }

            AdminFeatureView(
                authService: environment.authService,
                uploadService: environment.uploadService
            ) { name, payload in
                environment.emitCapabilityEvent(name, payload: payload)
            }
                .tabItem {
                    Label("Admin", systemImage: "gearshape.2")
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
    let nearbyService: NearbyService
    let uploadService: UploadService
    let messagesService: MessagesService
    let preferencesService: PreferencesService
    private let capabilityRouter: CapabilityRouting
    private var cancellables: Set<AnyCancellable> = []

    init(
        sharedRuntime: SharedRuntime = SharedRuntime(),
        configuration: EnvironmentConfiguration = EnvironmentConfiguration(),
        capabilityRouter: CapabilityRouting = CapabilityRouter(),
        preferencesService: PreferencesService = PreferencesService()
    ) {
        self.configuration = configuration
        self.theme = DesignSystemTheme()
        self.capabilityRouter = capabilityRouter
        self.preferencesService = preferencesService

        configuration.setCapabilityEventHandler { [capabilityRouter] name, payload in
            capabilityRouter.handle(event: CapabilityEvent(name: name, payload: payload))
        }

        SharedRuntimeRegistry.shared.register(runtime: sharedRuntime)
        self.authService = AuthService(runtime: sharedRuntime)
        self.listingsService = ListingsService(runtime: sharedRuntime)
        self.nearbyService = NearbyService(runtime: sharedRuntime)
        self.uploadService = UploadService(runtime: sharedRuntime)
        self.messagesService = MessagesService(runtime: sharedRuntime)

        bind(to: configuration)
    }

    @MainActor
    func bootstrap() async {
        do {
            print("🚀 Starting app bootstrap...")
            
            // Load environment configuration
            print("📝 Loading environment configuration...")
            try configuration.load()
            print("✅ Environment configuration loaded successfully")
            
            // Load shared core bundle
            print("📦 Loading shared core bundle...")
            try await SharedCoreBridgeBootstrap.shared.ensureBundleLoaded(using: configuration)
            print("✅ Shared core bundle loaded successfully")
            
            print("🎉 App bootstrap completed successfully")
        } catch {
            print("❌ Bootstrap failed: \(error)")
            if let environmentError = error as? EnvironmentError {
                switch environmentError {
                case .missingConfiguration:
                    print("💡 Tip: Make sure you have environment configuration files")
                case .invalidEncoding:
                    print("💡 Tip: Check that your .env files are UTF-8 encoded")
                }
            }
            if let bootstrapError = error as? BootstrapError {
                switch bootstrapError {
                case .bundleNotFound(let name):
                    print("💡 Tip: Make sure '\(name).js' is included in your app bundle")
                case .invalidEncoding:
                    print("💡 Tip: Check that your JavaScript bundle is UTF-8 encoded")
                }
            }
            // Instead of assertion failure, let's continue with default configuration
            print("⚠️ Continuing with minimal configuration...")
        }
    }

    func emitCapabilityEvent(_ name: String, payload: [String: Any] = [:]) {
        capabilityRouter.handle(event: CapabilityEvent(name: name, payload: payload))
    }

    private func bind(to configuration: EnvironmentConfiguration) {
        configuration.$environment
            .receive(on: DispatchQueue.main)
            .sink { [weak self] environment in
                guard let self else { return }
                let resolvedTheme = DesignSystemTheme.fromEnvironment(environment)
                theme = resolvedTheme
                AppearanceConfigurator.apply(theme: resolvedTheme)
                let capabilityConfiguration = CapabilityConfiguration.from(environment: environment)
                capabilityRouter.updateConfiguration(capabilityConfiguration)
            }
            .store(in: &cancellables)
    }
}
