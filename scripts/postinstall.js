const { execSync } = require('node:child_process');

const platform = process.platform;
const forceRebuild = process.env.LISTIT_FORCE_REBUILD === '1';
const shouldRebuild = forceRebuild || platform === 'linux';

if (!shouldRebuild) {
  console.log(
    `Skipping better-sqlite3 rebuild on ${platform}. ` +
      'Set LISTIT_FORCE_REBUILD=1 to force a rebuild.'
  );
  return;
}

try {
  console.log('Rebuilding better-sqlite3 from source...');
  execSync('npm rebuild better-sqlite3 --build-from-source', {
    stdio: 'inherit',
  });
} catch (err) {
  console.warn('better-sqlite3 rebuild failed:', err?.message || err);
  console.warn('Continuing without a manual rebuild.');
}
