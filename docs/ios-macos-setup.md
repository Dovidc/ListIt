# macOS Simulator Setup for ListIt iOS

This guide walks through preparing a macOS development machine to run the native ListIt iOS app inside the Xcode Simulator. The steps assume you are starting from a clean clone of the repository.

## 1. Install Platform Tooling

1. **Update macOS and Xcode**
   - Install the latest Xcode 15.x release from the Mac App Store (ListIt targets iOS 17 SDKs).
   - Launch Xcode once so it can finish installing required components.
   - If prompted, install the Command Line Tools or run `xcode-select --install` from Terminal.

2. **Install Homebrew (optional but recommended)**
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```
   Add Homebrew to your shell profile if the installer prompts you to do so.

3. **Install Node.js 18.20.8**
   The repository pins Node.js 18.20.8. If you use `nvm`, run:
   ```bash
   nvm install 18.20.8
   nvm use 18.20.8
   ```
   Otherwise download the macOS installer from <https://nodejs.org/en/download>.

   > Tip: If your Node.js binary lives outside the standard system paths,
   > export `LISTIT_NODE_BINARY=/full/path/to/node` (or `NODE_BINARY`) before
   > running Xcode. The build plugin also inspects `NVM_BIN` and
   > `~/.nvm/versions/node/*/bin` so `nvm` installations are picked up
   > automatically.

4. **Install Bundler** (needed for Fastlane gems):
   ```bash
   sudo gem install bundler
   ```

## 2. Clone the Repository and Install Dependencies

```bash
git clone https://github.com/your-org/ListIt.git
cd ListIt
npm install
npm run build:core
```

The `npm run build:core` command generates the JavaScript bundle consumed by the iOS bridge.

## 3. Configure Environment Files

1. Duplicate the workspace templates so you can supply local secrets and overrides:
   ```bash
   cp ios/.env.example ios/.env
   cp ios/.env.example.production ios/.env.production
   ```
2. Adjust values inside `ios/.env` (and optionally `ios/.env.production`) to point at your backend, S3 bucket, and other environment-specific settings.

## 4. Generate the Xcode Workspace

1. Install XcodeGen (choose one of the following):
   - Via Homebrew:
     ```bash
     brew install xcodegen
     ```
   - Or using the repository helper script if Homebrew fails (common on older macOS releases):
     ```bash
     npm run ios:ensure-xcodegen
     ```

2. Generate the projects:
   ```bash
   cd ios
   xcodegen generate
   ```

3. Install the required Ruby gems for Fastlane (from inside `ios/FastlaneSupport`):
   ```bash
   cd FastlaneSupport
   bundle install
   cd ..
   ```

## 5. Open and Run in Xcode

1. Open the generated workspace:
   ```bash
   open ListIt.xcworkspace
   ```
2. In Xcode, select the **ListItApp** scheme and choose an iOS 17 simulator device.
3. Press **⌘R** (Run) to build and launch the app in the simulator.

## 6. Keeping Tooling Up to Date

- Re-run `npm run build:core` whenever the shared JavaScript packages change.
- If Xcode reports missing Swift package artifacts, regenerate the workspace with `xcodegen generate`.
- Run `bundle update` periodically inside `ios/FastlaneSupport` to stay current with Fastlane patches.

Following these steps results in a working native ListIt workspace ready to run inside the Xcode Simulator on macOS.
