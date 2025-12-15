const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'public', 'assets', 'listit-core.js');
let content = fs.readFileSync(filePath, 'utf8');

// Check if already patched
if (content.includes('adminGetKarmaTop')) {
  console.log('Already patched');
  process.exit(0);
}

// Add karma API functions after adminSetPaymentsStatus
const karmaFunctions = `
    const adminGetKarmaTop = ({ limit } = {}, meta) => {
      const params = new URLSearchParams();
      if (limit) params.set('limit', limit);
      const qs = params.toString();
      return request('/api/admin/karma/top' + (qs ? '?' + qs : ''), { method: 'GET' }, meta);
    };

    const adminGetKarmaChanges = ({ days, limit } = {}, meta) => {
      const params = new URLSearchParams();
      if (days) params.set('days', days);
      if (limit) params.set('limit', limit);
      const qs = params.toString();
      return request('/api/admin/karma/changes' + (qs ? '?' + qs : ''), { method: 'GET' }, meta);
    };

`;

// Insert before signUpload
content = content.replace(
  /(\s+const signUpload = \(\{ filename)/,
  karmaFunctions + '$1'
);

// Add exports
content = content.replace(
  /(adminSetPaymentsStatus,\s+)(signUpload,)/,
  '$1adminGetKarmaTop,\n      adminGetKarmaChanges,\n      $2'
);

fs.writeFileSync(filePath, content);
console.log('Patched karma API functions successfully');
