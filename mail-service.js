const FROM_ADDRESS = process.env.SENDGRID_FROM_EMAIL || 'no-reply@listit.example';

const ONE_HOUR_MS = 60 * 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const MAX_CACHE_SIZE = 1024;
const IS_TEST = process.env.NODE_ENV === 'test';

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

function createEphemeralStore(ttlMs, { maxEntries = MAX_CACHE_SIZE } = {}) {
  const entries = new Map();
  const timers = new Map();

  function clearTimer(key) {
    const timer = timers.get(key);
    if (timer) {
      clearTimeout(timer);
      timers.delete(key);
    }
  }

  function prune(key) {
    const now = Date.now();
    if (typeof key === 'string') {
      const entry = entries.get(key);
      if (entry && entry.expiresAt <= now) {
        entries.delete(key);
        clearTimer(key);
      }
      return;
    }

    for (const [candidateKey, entry] of entries) {
      if (entry.expiresAt <= now) {
        entries.delete(candidateKey);
        clearTimer(candidateKey);
      }
    }
  }

  function scheduleExpiry(key) {
    clearTimer(key);
    const timeout = setTimeout(() => prune(key), ttlMs);
    if (typeof timeout.unref === 'function') timeout.unref();
    timers.set(key, timeout);
  }

  function remember(key, rawValue) {
    if (!key || rawValue === undefined || rawValue === null) return;

    prune();

    if (maxEntries && entries.size >= maxEntries) {
      const oldestKey = entries.keys().next().value;
      if (oldestKey !== undefined) {
        entries.delete(oldestKey);
        clearTimer(oldestKey);
      }
    }

    const entry = { expiresAt: Date.now() + ttlMs };
    if (IS_TEST) entry.raw = rawValue;
    entries.set(key, entry);
    scheduleExpiry(key);
  }

  function read(key) {
    prune(key);
    const entry = entries.get(key);
    if (!entry) return null;
    return entry.raw ?? null;
  }

  function clear() {
    for (const key of entries.keys()) {
      clearTimer(key);
    }
    entries.clear();
  }

  return { remember, read, clear };
}

const resetTokens = createEphemeralStore(ONE_HOUR_MS);
const verificationCodes = createEphemeralStore(THIRTY_MINUTES_MS);

async function sendPasswordResetEmail(email, token) {
  if (!email || !token) return;

  resetTokens.remember(email, token);

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
  return resetTokens.read(email);
}

function resetLog() {
  resetTokens.clear();
  verificationCodes.clear();
}

async function sendVerificationEmail(email, code) {
  if (!email || !code) return;

  verificationCodes.remember(email, code);

  if (process.env.NODE_ENV === 'test') return;

  const apiKey = process.env.SENDGRID_API_KEY;

  if (!apiKey) {
    console.warn('[mail] SENDGRID_API_KEY is not set; unable to send verification email.');
    return;
  }

  const message = {
    to: email,
    from: FROM_ADDRESS,
    subject: 'Verify your Trovelr account',
    text: `Enter this 6-digit code to verify your Trovelr account: ${code}`,
    html: `
      <p>Greetings,</p>
      <p>Use the following 6-digit code to verify your Trovelr account:</p>
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
  return verificationCodes.read(email);
}

module.exports = {
  sendPasswordResetEmail,
  sendVerificationEmail,
  __getLastToken: getLastToken,
  __getLastVerificationCode: getLastVerificationCode,
  __reset: resetLog
};
