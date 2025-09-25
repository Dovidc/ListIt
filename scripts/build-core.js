const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const srcPath = path.join(rootDir, 'packages', 'core', 'src', 'index.js');
const distDir = path.join(rootDir, 'packages', 'core', 'dist');
const browserDir = path.join(rootDir, 'public', 'assets');

fs.mkdirSync(distDir, { recursive: true });
const source = fs.readFileSync(srcPath, 'utf8');

fs.writeFileSync(path.join(distDir, 'index.mjs'), source);

const defaultExportMatch = source.match(/export default\s+(\{[\s\S]*?\});?/);
if (!defaultExportMatch) {
  throw new Error('Unable to locate default export in core source.');
}
const defaultBlock = defaultExportMatch[1];

const coreBody = source
  .replace(/export class ApiError/g, 'class ApiError')
  .replace(/export function createApiClient/g, 'function createApiClient')
  .replace(/export const formatCurrency/g, 'const formatCurrency')
  .replace(/export const formatDistance/g, 'const formatDistance')
  .replace(/export const haversineMeters/g, 'const haversineMeters')
  .replace(/export default\s+\{[\s\S]*?\};?/, `const defaultExport = ${defaultBlock};`);

const cjsContent = `${coreBody}\n\nmodule.exports = {\n  ApiError,\n  createApiClient,\n  formatCurrency,\n  formatDistance,\n  haversineMeters,\n  default: defaultExport\n};\n`;
fs.writeFileSync(path.join(distDir, 'index.cjs'), cjsContent);

const indentedBody = coreBody.replace(/^/gm, '  ');
const globalAssignments = [
  'exports.ApiError = ApiError;',
  'exports.createApiClient = createApiClient;',
  'exports.formatCurrency = formatCurrency;',
  'exports.formatDistance = formatDistance;',
  'exports.haversineMeters = haversineMeters;',
  'exports.default = defaultExport;'
]
  .map((line) => `  ${line}`)
  .join('\n');
const globalContent = `(() => {\n  const exports = {};\n${indentedBody}\n\n${globalAssignments}\n  globalThis.ListItCore = exports;\n})();\n`;
fs.writeFileSync(path.join(distDir, 'index.global.js'), globalContent);

fs.mkdirSync(browserDir, { recursive: true });
const browserTarget = path.join(browserDir, 'listit-core.js');
fs.copyFileSync(path.join(distDir, 'index.global.js'), browserTarget);

console.log(`Built core library -> ${path.relative(process.cwd(), distDir)}`);
console.log(`Copied browser bundle -> ${path.relative(process.cwd(), browserTarget)}`);
