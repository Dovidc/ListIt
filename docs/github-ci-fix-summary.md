# GitHub CI Fix Summary

The iOS CI workflow now ensures the Homebrew core tap is fully fetched before installing dependencies. Specifically, the workflow runs:

```
git -C /usr/local/Homebrew/Library/Taps/homebrew/homebrew-core fetch --unshallow
brew install xcodegen
```

Fetching the tap with `--unshallow` prevents installation failures when the GitHub Actions macOS runner checks out Homebrew with a shallow clone. This change restores the `brew install xcodegen` step that had been failing on GitHub.
