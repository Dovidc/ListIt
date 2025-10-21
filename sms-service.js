const sentCodes = new Map();

async function sendVerificationCode(phoneNumber, code) {
  if (!phoneNumber || !code) return;
  sentCodes.set(phoneNumber, { code, sentAt: new Date() });
  if (process.env.NODE_ENV !== 'test') {
    console.log(`[sms] Sent verification code to ${phoneNumber}`);
  }
}

function getLastCode(phoneNumber) {
  const entry = sentCodes.get(phoneNumber);
  return entry ? entry.code : null;
}

function resetLog() {
  sentCodes.clear();
}

module.exports = {
  sendVerificationCode,
  __getLastCode: getLastCode,
  __reset: resetLog
};
