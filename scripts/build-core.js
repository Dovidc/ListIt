const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const srcPath = path.join(rootDir, 'packages', 'core', 'src', 'index.js');
const distDir = path.join(rootDir, 'packages', 'core', 'dist');
const browserDir = path.join(rootDir, 'public', 'assets');
const typesSrcPath = path.join(rootDir, 'packages', 'core', 'src', 'index.d.ts');
const typesDistPath = path.join(distDir, 'index.d.ts');
const iosBundlePath = path.join(rootDir, 'ios', 'SharedCoreBridge', 'Resources', 'listit-core.js');

fs.mkdirSync(distDir, { recursive: true });
const source = fs.readFileSync(srcPath, 'utf8');

fs.writeFileSync(path.join(distDir, 'index.mjs'), source);

const defaultExportMatch = source.match(/export default\s+(\{[\s\S]*?\});?/);
if (!defaultExportMatch) {
  throw new Error('Unable to locate default export in core source.');
}
const defaultBlock = defaultExportMatch[1];

const replacements = [
  ['export class ApiError', 'class ApiError'],
  ['export function createApiClient', 'function createApiClient'],
  ['export const formatCurrency', 'const formatCurrency'],
  ['export const formatDistance', 'const formatDistance'],
  ['export const haversineMeters', 'const haversineMeters'],
  ['export const normalizeListingsResponse', 'const normalizeListingsResponse'],
  ['export const asArray', 'const asArray'],
  ['export function createAuthService', 'function createAuthService'],
  ['export function createListingsService', 'function createListingsService'],
  ['export function createUploadsService', 'function createUploadsService'],
  ['export function createCoreEnvironment', 'function createCoreEnvironment'],
  ['export function installNativeBindings', 'function installNativeBindings']
];

let coreBody = source;
for (const [pattern, replacement] of replacements) {
  coreBody = coreBody.replace(new RegExp(pattern, 'g'), replacement);
}
coreBody = coreBody.replace(/export default\s+\{[\s\S]*?\};?/, `const defaultExport = ${defaultBlock};`);

const cjsExports = [
  'ApiError',
  'createApiClient',
  'formatCurrency',
  'formatDistance',
  'haversineMeters',
  'normalizeListingsResponse',
  'asArray',
  'createAuthService',
  'createListingsService',
  'createUploadsService',
  'createCoreEnvironment',
  'installNativeBindings'
];

const cjsContent = `${coreBody}\n\nmodule.exports = {\n${cjsExports.map((name) => `  ${name},`).join('\n')}\n  default: defaultExport\n};\n`;
fs.writeFileSync(path.join(distDir, 'index.cjs'), cjsContent);

const indentedBody = coreBody.replace(/^/gm, '  ');
const globalAssignments = [
  'exports.ApiError = ApiError;',
  'exports.createApiClient = createApiClient;',
  'exports.formatCurrency = formatCurrency;',
  'exports.formatDistance = formatDistance;',
  'exports.haversineMeters = haversineMeters;',
  'exports.normalizeListingsResponse = normalizeListingsResponse;',
  'exports.asArray = asArray;',
  'exports.createAuthService = createAuthService;',
  'exports.createListingsService = createListingsService;',
  'exports.createUploadsService = createUploadsService;',
  'exports.createCoreEnvironment = createCoreEnvironment;',
  'exports.installNativeBindings = installNativeBindings;',
  'exports.default = defaultExport;'
]
  .map((line) => `  ${line}`)
  .join('\n');
const globalContent = `(() => {\n  const exports = {};\n${indentedBody}\n\n${globalAssignments}\n  globalThis.ListItCore = exports;\n  if (typeof NativeBridge !== 'undefined' && typeof exports.installNativeBindings === 'function') {\n    try {\n      exports.installNativeBindings();\n    } catch (error) {\n      if (NativeBridge && typeof NativeBridge.log === 'function') {\n        NativeBridge.log(\`Failed to install native bindings: \${error?.message || error}\`);\n      }\n    }\n  }\n})();\n`;
fs.writeFileSync(path.join(distDir, 'index.global.js'), globalContent);

fs.mkdirSync(browserDir, { recursive: true });
const browserTarget = path.join(browserDir, 'listit-core.js');
fs.copyFileSync(path.join(distDir, 'index.global.js'), browserTarget);

if (fs.existsSync(typesSrcPath)) {
  fs.copyFileSync(typesSrcPath, typesDistPath);
}

fs.copyFileSync(path.join(distDir, 'index.global.js'), iosBundlePath);

console.log(`Built core library -> ${path.relative(process.cwd(), distDir)}`);
console.log(`Copied browser bundle -> ${path.relative(process.cwd(), browserTarget)}`);
console.log(`Updated native bundle -> ${path.relative(process.cwd(), iosBundlePath)}`);
