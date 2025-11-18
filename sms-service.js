const { createOtpStore } = require('./lib/otp-store');

const otpStore = createOtpStore({
  prefix: 'otp:sms',
  ttlMs: 10 * 60 * 1000,
  allowPlaintext: process.env.NODE_ENV === 'test'
});

async function sendVerificationCode(phoneNumber, code) {
  if (!phoneNumber || !code) return;
  await otpStore.remember(phoneNumber, code, {
    channel: 'sms',
    sentAt: new Date().toISOString()
  });
  if (process.env.NODE_ENV !== 'test') {
    console.log(`[sms] Sent verification code to ${phoneNumber}`);
  }
}

async function getLastCode(phoneNumber) {
  if (!otpStore.peek) return null;
  return await otpStore.peek(phoneNumber);
}

function resetLog() {
  if (typeof otpStore.clear === 'function') {
    const maybe = otpStore.clear();
    if (maybe && typeof maybe.catch === 'function') {
      maybe.catch((err) => {
        console.error('[sms] Failed to reset OTP store:', err);
      });
    }
  }
}

module.exports = {
  sendVerificationCode,
  __getLastCode: getLastCode,
  __reset: resetLog
};
