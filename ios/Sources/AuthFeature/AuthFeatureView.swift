import SwiftUI
import SharedServices

public struct AuthFeatureView: View {
    @State private var state = AuthViewState()
    private let authService: AuthService

    public init(authService: AuthService) {
        self.authService = authService
    }

    public var body: some View {
        NavigationStack {
            Form {
                Section("Credentials") {
                    TextField("Email", text: $state.email)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                    SecureField("Password", text: $state.password)
                }

                Section {
                    Button(action: signIn) {
                        if state.isLoading {
                            ProgressView()
                        } else {
                            Text("Sign In")
                        }
                    }
                    .disabled(!state.canSubmit)
                }

                if let error = state.errorMessage {
                    Section {
                        Text(error)
                            .foregroundStyle(.red)
                    }
                }

                if let tokens = state.tokens {
                    Section("Active Session") {
                        LabeledContent("Access Token") {
                            Text(tokens.accessToken)
                                .textSelection(.enabled)
                                .font(.footnote)
                        }

                        if let refresh = tokens.refreshToken {
                            LabeledContent("Refresh Token") {
                                Text(refresh)
                                    .textSelection(.enabled)
                                    .font(.footnote)
                            }
                        }

                        if let expiry = tokens.expiresAt {
                            LabeledContent("Expires") {
                                Text(expiry.formatted(date: .numeric, time: .shortened))
                            }
                        }

                        Button(role: .destructive, action: signOut) {
                            Text("Sign Out")
                        }
                        .buttonStyle(.borderless)
                    }
                }
            }
            .navigationTitle("Account")
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
            } catch {
                state.errorMessage = error.localizedDescription
            }
            state.isLoading = false
        }
    }

    private func signOut() {
        do {
            try authService.signOut()
            state.tokens = nil
        } catch {
            state.errorMessage = error.localizedDescription
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
