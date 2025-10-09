import SwiftUI

public struct ThemePlaygroundView: View {
    @State private var theme: DesignSystemTheme
    @State private var typographyPreset: TypographyPreset

    public init(theme: DesignSystemTheme = DesignSystemTheme(), typographyPreset: TypographyPreset = .default) {
        _theme = State(initialValue: theme)
        _typographyPreset = State(initialValue: typographyPreset)
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

                Section("Surface & Text Colors") {
                    colorEditor(label: "Surface", keyPath: \DesignSystemTheme.palette.surface)
                    colorEditor(label: "On Surface", keyPath: \DesignSystemTheme.palette.onSurface)
                    colorEditor(label: "On Background", keyPath: \DesignSystemTheme.palette.onBackground)
                    colorEditor(label: "On Primary", keyPath: \DesignSystemTheme.palette.onPrimary)
                    colorEditor(label: "On Secondary", keyPath: \DesignSystemTheme.palette.onSecondary)
                }

                Section("Status Colors") {
                    colorEditor(label: "Success", keyPath: \DesignSystemTheme.palette.success)
                    colorEditor(label: "Warning", keyPath: \DesignSystemTheme.palette.warning)
                    colorEditor(label: "Danger", keyPath: \DesignSystemTheme.palette.danger)
                }

                Section("Spacing & Corners") {
                    spacingControl(label: "Extra Small", keyPath: \DesignSystemTheme.spacing.xSmall, range: 0...32)
                    spacingControl(label: "Small", keyPath: \DesignSystemTheme.spacing.small, range: 0...48)
                    spacingControl(label: "Medium", keyPath: \DesignSystemTheme.spacing.medium, range: 8...72)
                    spacingControl(label: "Large", keyPath: \DesignSystemTheme.spacing.large, range: 16...96)
                    spacingControl(label: "Extra Large", keyPath: \DesignSystemTheme.spacing.xLarge, range: 24...128)
                    cornerControl(label: "Small Corner", keyPath: \DesignSystemTheme.corners.small)
                    cornerControl(label: "Medium Corner", keyPath: \DesignSystemTheme.corners.medium)
                    cornerControl(label: "Large Corner", keyPath: \DesignSystemTheme.corners.large)
                }

                Section("Typography") {
                    Picker("Preset", selection: $typographyPreset) {
                        ForEach(TypographyPreset.allCases, id: \.self) { preset in
                            Text(preset.displayName).tag(preset)
                        }
                    }
                    .pickerStyle(.segmented)

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Large Title")
                            .font(theme.typography.largeTitle)
                        Text("Headline & body copy scale dynamically based on preset choice.")
                            .font(theme.typography.body)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, theme.spacing.small)
                }

                Section("Interaction") {
                    Toggle("Large Navigation Titles", isOn: $theme.enablesLargeTitles)
                    Toggle("Swipe Actions", isOn: $theme.supportsSwipeActions)
                }

                Section("Preview") {
                    VStack(spacing: theme.spacing.large) {
                        ListItBrandHeader(
                            title: "ListIt Nearby",
                            eyebrow: "Discover",
                            subtitle: "Good things are around the corner",
                            description: "Gradient hero treatment that mirrors the marketing shell and creates space for feature-specific art.",
                            action: {
                                Button("Browse nearby deals") {}
                                    .buttonStyle(ListItPrimaryButtonStyle())
                            }
                        )

                        ListItCard(title: "Curated Listing", subtitle: "Native preview") {
                            Text("Give designers and engineers playgrounds to explore themes without touching production builds.")
                        }
                    }
                    .padding(theme.spacing.large)
                    .listRowBackground(Color.clear)
                }
            }
            .background(theme.palette.background)
            .navigationTitle("Theme Playground")
        }
        .onChange(of: typographyPreset) { _, newValue in
            theme.typography = TypographyScale.preset(newValue)
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

    private func spacingControl(label: String,
                                 keyPath: WritableKeyPath<DesignSystemTheme, CGFloat>,
                                 range: ClosedRange<Double>,
                                 step: Double = 1) -> some View {
        Stepper(value: Binding<Double>(
            get: { Double(theme[keyPath: keyPath]) },
            set: { theme[keyPath: keyPath] = CGFloat($0) }
        ), in: range, step: step) {
            Text("\(label): \(points(theme[keyPath: keyPath]))")
                .font(.footnote)
        }
    }

    private func cornerControl(label: String,
                                keyPath: WritableKeyPath<DesignSystemTheme, CGFloat>,
                                range: ClosedRange<Double> = 0...64,
                                step: Double = 1) -> some View {
        Stepper(value: Binding<Double>(
            get: { Double(theme[keyPath: keyPath]) },
            set: { theme[keyPath: keyPath] = CGFloat($0) }
        ), in: range, step: step) {
            Text("\(label): \(points(theme[keyPath: keyPath]))")
                .font(.footnote)
        }
    }

    private func points(_ value: CGFloat) -> String {
        "\(Int(round(value))) pt"
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
