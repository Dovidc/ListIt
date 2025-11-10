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

const namedExportMatch = source.match(/export\s*\{([\s\S]*?)\};?/);
if (!namedExportMatch) {
  throw new Error('Unable to locate named exports in core source.');
}

const namedExports = namedExportMatch[1]
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const coreBody = source
  .replace(namedExportMatch[0], '')
  .replace(/export default\s+\{[\s\S]*?\};?/, `var defaultExport = ${defaultBlock};`)
  .trim();

const cjsContent = `${coreBody}\n\nmodule.exports = {\n${namedExports
  .map((name) => `  ${name}: ${name},`)
  .join('\n')}\n  default: defaultExport\n};\n`;
fs.writeFileSync(path.join(distDir, 'index.cjs'), cjsContent);

const indentedBody = coreBody.replace(/^/gm, '  ');
const globalAssignments = namedExports
  .map((name) => `  exports.${name} = ${name};`)
  .concat(['  exports.default = defaultExport;'])
  .join('\n');

const globalContent = `(function (global) {\n  var exports = {};\n${indentedBody}\n\n${globalAssignments}\n  if (global) {\n    global.ListItCore = exports;\n  }\n})(typeof resolveGlobal === 'function' ? resolveGlobal() : (typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this))));\n`;
fs.writeFileSync(path.join(distDir, 'index.global.js'), globalContent);

fs.mkdirSync(browserDir, { recursive: true });
const browserTarget = path.join(browserDir, 'listit-core.js');
fs.copyFileSync(path.join(distDir, 'index.global.js'), browserTarget);

console.log(`Built core library -> ${path.relative(process.cwd(), distDir)}`);
console.log(`Copied browser bundle -> ${path.relative(process.cwd(), browserTarget)}`);
