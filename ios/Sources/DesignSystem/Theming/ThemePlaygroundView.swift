import SwiftUI

public struct ThemePlaygroundView: View {
    @State private var theme: DesignSystemTheme

    public init(theme: DesignSystemTheme = DesignSystemTheme()) {
        _theme = State(initialValue: theme)
    }

    public var body: some View {
        DesignSystemProvider(theme: theme) {
            List {
                Section("Brand Colors") {
                    colorEditor(label: "Primary", keyPath: \DesignSystemTheme.palette.primary)
                    colorEditor(label: "Secondary", keyPath: \DesignSystemTheme.palette.secondary)
                    colorEditor(label: "Accent", keyPath: \DesignSystemTheme.palette.accent)
                    colorEditor(label: "Background", keyPath: \DesignSystemTheme.palette.background)
                }

                Section("Interaction") {
                    Toggle("Large Navigation Titles", isOn: $theme.enablesLargeTitles)
                    Toggle("Swipe Actions", isOn: $theme.supportsSwipeActions)
                }

                Section("Preview") {
                    VStack(spacing: theme.spacing.large) {
                        Text("ListIt")
                            .font(theme.typography.largeTitle)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        ListItCard(title: "Curated Listing", subtitle: "Native preview") {
                            Text("Give designers and engineers playgrounds to explore themes without touching production builds.")
                        }
                        Button("Primary Action") {}
                            .buttonStyle(ListItPrimaryButtonStyle())
                    }
                    .padding(theme.spacing.large)
                    .listRowBackground(Color.clear)
                }
            }
            .background(theme.palette.background)
            .navigationTitle("Theme Playground")
        }
    }

    private func colorEditor(label: String, keyPath: WritableKeyPath<DesignSystemTheme, Color>) -> some View {
        VStack(alignment: .leading) {
            Text(label)
                .font(.footnote)
                .foregroundStyle(.secondary)
            ColorPicker(label, selection: Binding(
                get: { theme[keyPath: keyPath] },
                set: { theme[keyPath: keyPath] = $0 }
            ))
            .labelsHidden()
        }
    }
}

#if DEBUG
struct ThemePlaygroundView_Previews: PreviewProvider {
    static var previews: some View {
        NavigationStack {
            ThemePlaygroundView()
        }
    }
}
#endif
