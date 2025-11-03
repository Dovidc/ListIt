const FROM_ADDRESS = process.env.SENDGRID_FROM_EMAIL || 'no-reply@listit.example';

let sgMailClient = null;
let configuredApiKey = null;

function getSendgridClient(apiKey) {
  if (!sgMailClient) {
    sgMailClient = require('@sendgrid/mail');
  }

  if (configuredApiKey !== apiKey) {
    sgMailClient.setApiKey(apiKey);
    configuredApiKey = apiKey;
  }

  return sgMailClient;
}

const resetTokens = new Map();
const verificationCodes = new Map();

async function sendPasswordResetEmail(email, token) {
  if (!email || !token) return;

  resetTokens.set(email, { token, sentAt: new Date() });

  if (process.env.NODE_ENV === 'test') return;

  const apiKey = process.env.SENDGRID_API_KEY;

  if (!apiKey) {
    console.warn('[mail] SENDGRID_API_KEY is not set; unable to send password reset email.');
    return;
  }

  const message = {
    to: email,
    from: FROM_ADDRESS,
    subject: 'Reset your ListIt password',
    text: `Use the following token to reset your password: ${token}`,
    html: `
      <p>Hello,</p>
      <p>Use the following token to reset your password:</p>
      <p><strong>${token}</strong></p>
      <p>If you did not request this, you can ignore this email.</p>
    `
  };

  try {
    await getSendgridClient(apiKey).send(message);
    console.log(`[mail] Sent password reset email to ${email}`);
  } catch (error) {
    console.error('[mail] Failed to send password reset email', error);
    throw error;
  }
}

function getLastToken(email) {
  const entry = resetTokens.get(email);
  return entry ? entry.token : null;
}

function resetLog() {
  resetTokens.clear();
  verificationCodes.clear();
}

async function sendVerificationEmail(email, code) {
  if (!email || !code) return;

  verificationCodes.set(email, { code, sentAt: new Date() });

  if (process.env.NODE_ENV === 'test') return;

  const apiKey = process.env.SENDGRID_API_KEY;

  if (!apiKey) {
    console.warn('[mail] SENDGRID_API_KEY is not set; unable to send verification email.');
    return;
  }

  const message = {
    to: email,
    from: FROM_ADDRESS,
    subject: 'Verify your ListIt account',
    text: `Enter this 6-digit code to verify your ListIt account: ${code}`,
    html: `
      <p>Hello,</p>
      <p>Use the following 6-digit code to verify your ListIt account:</p>
      <p><strong>${code}</strong></p>
      <p>If you did not request this, you can ignore this email.</p>
    `
  };

  try {
    await getSendgridClient(apiKey).send(message);
    console.log(`[mail] Sent verification email to ${email}`);
  } catch (error) {
    console.error('[mail] Failed to send verification email', error);
    throw error;
  }
}

function getLastVerificationCode(email) {
  const entry = verificationCodes.get(email);
  return entry ? entry.code : null;
}

module.exports = {
  sendPasswordResetEmail,
  sendVerificationEmail,
  __getLastToken: getLastToken,
  __getLastVerificationCode: getLastVerificationCode,
  __reset: resetLog
};
