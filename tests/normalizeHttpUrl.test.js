const app = require('../server');

describe('normalizeHttpUrl utility', () => {
  const normalizeHttpUrl = app._normalizeHttpUrl;

  it('strips trailing punctuation from valid URLs', () => {
    const base = 'https://listit-prod-uploads.s3.us-east-1.amazonaws.com/public/uploads/2025-11-02/b0e2861bebc7affba2f98f65e7a39123.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=AKIASHUHEFVI3H7GIGPP%2F20251102%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20251102T004334Z&X-Amz-Expires=900&X-Amz-Signature=27c5d880e3eb51b0a68dd60c821218cc3567a228b4787b9433d51ba708569bc5&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject';
    const messy = `${base}',`;
    expect(normalizeHttpUrl(messy)).toBe(base);
  });

  it('still supports allowEmpty option', () => {
    expect(normalizeHttpUrl('', { allowEmpty: true })).toBe('');
  });
});
