#!/usr/bin/env node
const {
  accessSync,
  constants,
  copyFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  unlinkSync,
} = require('fs');
const { tmpdir, homedir } = require('os');
const { join, resolve } = require('path');
const { execFileSync } = require('child_process');
const https = require('https');

const MIN_VERSION = process.env.LISTIT_XCODEGEN_MIN_VERSION || '2.37.0';
const TARGET_VERSION = process.env.LISTIT_XCODEGEN_VERSION || '2.38.0';
const DEFAULT_URL_TEMPLATE = 'https://github.com/yonaskolb/XcodeGen/releases/download/{version}/xcodegen.zip';
const DOWNLOAD_URL = process.env.LISTIT_XCODEGEN_URL || DEFAULT_URL_TEMPLATE.replace('{version}', TARGET_VERSION);

function compareSemver(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

function resolveCurrentVersion() {
  try {
    const out = execFileSync('xcodegen', ['--version'], { encoding: 'utf8' }).trim();
    const match = out.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
  } catch (_) {
    return null;
  }
}

function ensureDirectoryWritable(dir) {
  try {
    accessSync(dir, constants.W_OK);
    return dir;
  } catch (_) {
    return null;
  }
}

function resolveInstallDirectory() {
  if (process.env.LISTIT_XCODEGEN_INSTALL_DIR) {
    const dir = resolve(process.env.LISTIT_XCODEGEN_INSTALL_DIR);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  const preferred = ['/usr/local/bin', '/opt/homebrew/bin'];
  for (const candidate of preferred) {
    const writable = ensureDirectoryWritable(candidate);
    if (writable) return writable;
  }

  const homeBin = join(process.env.HOME || homedir(), '.local', 'bin');
  mkdirSync(homeBin, { recursive: true });
  return homeBin;
}

function downloadFile(url, destination) {
  return new Promise((resolvePromise, rejectPromise) => {
    const file = require('fs').createWriteStream(destination);
    const handleResponse = (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        https.get(res.headers.location, handleResponse).on('error', rejectPromise);
        return;
      }
      if (res.statusCode !== 200) {
        rejectPromise(new Error(`Download failed with status ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolvePromise));
    };

    https.get(url, handleResponse).on('error', rejectPromise);
  });
}

async function installXcodeGen() {
  const currentVersion = resolveCurrentVersion();
  if (currentVersion && compareSemver(currentVersion, MIN_VERSION) >= 0) {
    const matchesTarget = TARGET_VERSION && compareSemver(currentVersion, TARGET_VERSION) === 0;
    if (!TARGET_VERSION || matchesTarget) {
      const targetInfo = TARGET_VERSION ? ` and matches requested ${TARGET_VERSION}` : '';
      console.log(`XcodeGen ${currentVersion} already satisfies minimum ${MIN_VERSION}${targetInfo}.`);
      return;
    }
    console.log(
      `XcodeGen ${currentVersion} meets minimum ${MIN_VERSION} but differs from requested ${TARGET_VERSION}, reinstalling...`,
    );
  }

  const workDir = mkdtempSync(join(tmpdir(), 'listit-xcodegen-'));
  const zipPath = join(workDir, 'xcodegen.zip');
  console.log(`Downloading XcodeGen from ${DOWNLOAD_URL} ...`);
  await downloadFile(DOWNLOAD_URL, zipPath);

  console.log('Extracting archive...');
  execFileSync('unzip', ['-o', zipPath, '-d', workDir], { stdio: 'inherit' });

  const binaryPath = join(workDir, 'xcodegen', 'bin', 'xcodegen');
  if (!existsSync(binaryPath)) {
    throw new Error('Failed to locate xcodegen binary in the extracted archive.');
  }

  const supportRoot = join(workDir, 'xcodegen');

  const copyDirectory = (source, destination) => {
    mkdirSync(destination, { recursive: true });
    const entries = readdirSync(source, { withFileTypes: true });
    for (const entry of entries) {
      const sourcePath = join(source, entry.name);
      const destPath = join(destination, entry.name);
      if (entry.isDirectory()) {
        copyDirectory(sourcePath, destPath);
      } else {
        copyFileSync(sourcePath, destPath);
      }
    }
  };

  const copySupportFiles = (source, destination) => {
    const entries = readdirSync(source, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'bin') continue;
      const sourcePath = join(source, entry.name);
      const destPath = join(destination, entry.name);
      rmSync(destPath, { recursive: true, force: true });
      if (entry.isDirectory()) {
        copyDirectory(sourcePath, destPath);
      } else {
        copyFileSync(sourcePath, destPath);
      }
    }
  };

  const installDir = resolveInstallDirectory();
  const targetPath = join(installDir, 'xcodegen');
  copyFileSync(binaryPath, targetPath);
  chmodSync(targetPath, 0o755);

  try {
    copySupportFiles(supportRoot, installDir);
  } catch (err) {
    console.warn('Unable to copy XcodeGen support files:', err.message || err);
  }
  try {
    unlinkSync(zipPath);
  } catch (_) {}

  console.log(`Installed XcodeGen ${TARGET_VERSION} to ${targetPath}`);
  const pathEntries = (process.env.PATH || '').split(':');
  if (!pathEntries.includes(installDir)) {
    console.log('\nAdd the directory to your PATH if needed:');
    console.log(`  export PATH="${installDir}:$PATH"`);
  }
}

installXcodeGen().catch((err) => {
  console.error('Failed to install XcodeGen:', err.message || err);
  process.exitCode = 1;
});
