import Foundation
import SwiftUI
import WebKit
import SharedServices

enum WebShellLauncher {
    static var shouldUseShell: Bool {
        if let override = ProcessInfo.processInfo.environment["LISTIT_USE_WEB_SHELL"], override.isTruthyFlag {
            return true
        }

        #if DEBUG
        if UserDefaults.standard.object(forKey: "LISTIT_USE_WEB_SHELL") != nil {
            return UserDefaults.standard.bool(forKey: "LISTIT_USE_WEB_SHELL")
        }
        #endif

        return false
    }
}

struct WebShellRootView: View {
    @StateObject private var viewModel = WebShellViewModel()

    var body: some View {
        ZStack {
            ShellWebView(viewModel: viewModel)
                .ignoresSafeArea()

            if viewModel.isLoading {
                ProgressView("Loading ListIt…")
                    .padding()
                    .background(.thinMaterial, in: Capsule())
            }
        }
        .task { await viewModel.bootstrap() }
        .alert(
            "Unable to Load ListIt",
            isPresented: Binding(
                get: { viewModel.errorMessage != nil },
                set: { if !$0 { viewModel.errorMessage = nil } }
            ),
            presenting: viewModel.errorMessage
        ) { _ in
            Button("Retry") {
                Task { await viewModel.reloadShell() }
            }
            Button("Cancel", role: .cancel) {
                viewModel.errorMessage = nil
            }
        } message: { message in
            Text(message)
        }
        .overlay(alignment: .topTrailing) {
            if viewModel.showReloadButton {
                Button {
                    Task { await viewModel.reloadShell() }
                } label: {
                    Label("Reload", systemImage: "arrow.clockwise")
                        .labelStyle(.iconOnly)
                        .padding(8)
                        .background(.thinMaterial, in: Circle())
                }
                .padding()
            }
        }
    }
}

@MainActor
final class WebShellViewModel: ObservableObject {
    @Published var shellURL: URL?
    @Published var isLoading: Bool = true
    @Published var errorMessage: String?

    var showReloadButton: Bool { shellURL != nil }

    private let configuration: EnvironmentConfiguration

    init(configuration: EnvironmentConfiguration = EnvironmentConfiguration()) {
        self.configuration = configuration
    }

    func bootstrap() async {
        await loadShell(reloadConfiguration: true)
    }

    func reloadShell() async {
        await loadShell(reloadConfiguration: true)
    }

    func navigationStarted() {
        isLoading = true
    }

    func navigationFinished() {
        isLoading = false
    }

    func navigationFailed(_ error: Error) {
        isLoading = false

        if let urlError = error as? URLError, urlError.code == .cancelled {
            return
        }

        errorMessage = error.localizedDescription
    }

    private func loadShell(reloadConfiguration: Bool) async {
        isLoading = true

        do {
            if reloadConfiguration || configuration.environment.isEmpty {
                try configuration.load()
            }

            shellURL = try resolveShellURL()
            errorMessage = nil
        } catch {
            shellURL = nil
            errorMessage = userFacingMessage(for: error)
        }

        isLoading = false
    }

    private func resolveShellURL() throws -> URL {
        if let override = ProcessInfo.processInfo.environment["LISTIT_SHELL_URL"],
           let overrideURL = Self.url(from: override) {
            return overrideURL
        }

        if let configured = configuration.value(for: "IOS_SHELL_URL") ?? configuration.value(for: "SHELL_URL"),
           !configured.isEmpty {
            guard let url = Self.url(from: configured) else {
                throw WebShellError.invalidURL(configured)
            }
            return url
        }

        if let bundled = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Shell") {
            return bundled
        }

        guard let fallback = URL(string: "https://app.listit.dev") else {
            throw WebShellError.missingShellTarget
        }

        return fallback
    }

    private func userFacingMessage(for error: Error) -> String {
        if let shellError = error as? WebShellError {
            return shellError.localizedDescription
        }

        return error.localizedDescription
    }

    private static func url(from value: String) -> URL? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        if let url = URL(string: trimmed), url.scheme != nil {
            return url
        }

        if trimmed.hasPrefix("/") {
            return URL(fileURLWithPath: trimmed)
        }

        return nil
    }
}

private enum WebShellError: LocalizedError {
    case invalidURL(String)
    case missingShellTarget

    var errorDescription: String? {
        switch self {
        case let .invalidURL(value):
            return "The configured shell URL is invalid: \(value)."
        case .missingShellTarget:
            return "No shell bundle or remote URL could be resolved."
        }
    }
}

private struct ShellWebView: UIViewRepresentable {
    @ObservedObject var viewModel: WebShellViewModel

    func makeCoordinator() -> Coordinator {
        Coordinator(viewModel: viewModel)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = true
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard let url = viewModel.shellURL else { return }
        if context.coordinator.loadedURL == url { return }

        context.coordinator.loadedURL = url

        if url.isFileURL {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        } else {
            var request = URLRequest(url: url)
            request.timeoutInterval = 15
            webView.load(request)
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        private let viewModel: WebShellViewModel
        fileprivate var loadedURL: URL?

        init(viewModel: WebShellViewModel) {
            self.viewModel = viewModel
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            Task { @MainActor in viewModel.navigationStarted() }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            Task { @MainActor in viewModel.navigationFinished() }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            Task { @MainActor in viewModel.navigationFailed(error) }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            Task { @MainActor in viewModel.navigationFailed(error) }
        }
    }
}

private extension String {
    var isTruthyFlag: Bool {
        let normalized = trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return ["1", "true", "yes", "y"].contains(normalized)
    }
}
