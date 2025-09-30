import SwiftUI
import SharedServices
import DesignSystem

public struct AuthFeatureView: View {
    @Environment(\.designSystem) private var designSystem
    @State private var state = AuthViewState()
    private let authService: AuthService
    private let capabilityEmitter: (String, [String: Any]) -> Void

    public init(authService: AuthService, capabilityEmitter: @escaping (String, [String: Any]) -> Void = { _, _ in }) {
        self.authService = authService
        self.capabilityEmitter = capabilityEmitter
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: designSystem.spacing.large) {
                    ListItCard(title: "Credentials") {
                        VStack(alignment: .leading, spacing: designSystem.spacing.small) {
                            TextField("Email", text: $state.email)
                                .textContentType(.username)
                                .keyboardType(.emailAddress)
                                .textInputAutocapitalization(.never)
                                .font(designSystem.typography.body)
                                .padding(.vertical, designSystem.spacing.xSmall)
                            Divider()
                            SecureField("Password", text: $state.password)
                                .font(designSystem.typography.body)
                                .padding(.vertical, designSystem.spacing.xSmall)
                        }
                    }

                    Button(action: signIn) {
                        if state.isLoading {
                            ProgressView()
                        } else {
                            Text("Sign In")
                        }
                    }
                    .buttonStyle(ListItPrimaryButtonStyle())
                    .disabled(!state.canSubmit)

                    if let error = state.errorMessage {
                        ListItCard(title: "Error") {
                            Text(error)
                                .font(designSystem.typography.callout)
                                .foregroundStyle(designSystem.colors.danger)
                        }
                    }

                    if let tokens = state.tokens {
                        ListItCard(title: "Active Session") {
                            VStack(alignment: .leading, spacing: designSystem.spacing.small) {
                                TokenRow(label: "Access Token", value: tokens.accessToken)
                                if let refresh = tokens.refreshToken {
                                    TokenRow(label: "Refresh Token", value: refresh)
                                }
                                if let expiry = tokens.expiresAt {
                                    TokenRow(label: "Expires", value: expiry.formatted(date: .numeric, time: .shortened))
                                }
                                Button(role: .destructive, action: signOut) {
                                    Text("Sign Out")
                                }
                                .buttonStyle(ListItSecondaryButtonStyle())
                            }
                        }
                    }
                }
                .padding(designSystem.spacing.large)
                .background(designSystem.colors.background.ignoresSafeArea())
            }
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(designSystem.enablesLargeTitles ? .large : .inline)
            .alert("Signed In", isPresented: $state.isSignedIn) {
                Button("OK", role: .cancel) { }
            }
            .task {
                state.tokens = authService.currentTokens()
            }
        }
    }

    private func signIn() {
        Task {
            state.isLoading = true
            state.errorMessage = nil
            do {
                let result = try await authService.signIn(email: state.email, password: state.password)
                state.isSignedIn = result.isSuccess
                state.tokens = result.tokens ?? authService.currentTokens()
                if result.isSuccess {
                    capabilityEmitter("haptic", ["style": "success"])
                }
            } catch {
                state.errorMessage = error.localizedDescription
                capabilityEmitter("haptic", ["style": "error"])
            }
            state.isLoading = false
        }
    }

    private func signOut() {
        do {
            try authService.signOut()
            state.tokens = nil
            capabilityEmitter("haptic", ["style": "impact.light"])
        } catch {
            state.errorMessage = error.localizedDescription
            capabilityEmitter("haptic", ["style": "error"])
        }
    }
}

private struct AuthViewState {
    var email: String = ""
    var password: String = ""
    var isLoading: Bool = false
    var errorMessage: String?
    var isSignedIn: Bool = false
    var tokens: AuthTokens?

    var canSubmit: Bool {
        !email.isEmpty && !password.isEmpty && !isLoading
    }
}

private struct TokenRow: View {
    @Environment(\.designSystem) private var designSystem
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: designSystem.spacing.xSmall) {
            Text(label)
                .font(designSystem.typography.footnote)
                .foregroundStyle(.secondary)
            Text(value)
                .font(designSystem.typography.callout)
                .textSelection(.enabled)
                .foregroundStyle(designSystem.colors.secondary)
        }
    }
}
