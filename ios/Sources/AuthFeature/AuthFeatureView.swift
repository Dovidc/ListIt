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
            }
            .navigationTitle("Account")
            .alert("Signed In", isPresented: $state.isSignedIn) {
                Button("OK", role: .cancel) { }
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
            } catch {
                state.errorMessage = error.localizedDescription
            }
            state.isLoading = false
        }
    }
}

private struct AuthViewState {
    var email: String = ""
    var password: String = ""
    var isLoading: Bool = false
    var errorMessage: String?
    var isSignedIn: Bool = false

    var canSubmit: Bool {
        !email.isEmpty && !password.isEmpty && !isLoading
    }
}
