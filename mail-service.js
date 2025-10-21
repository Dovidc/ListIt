const resetTokens = new Map();

async function sendPasswordResetEmail(email, token) {
  if (!email || !token) return;
  resetTokens.set(email, { token, sentAt: new Date() });
  if (process.env.NODE_ENV !== 'test') {
    console.log(`[mail] Sent password reset email to ${email}`);
  }
}

function getLastToken(email) {
  const entry = resetTokens.get(email);
  return entry ? entry.token : null;
}

function resetLog() {
  resetTokens.clear();
}

module.exports = {
  sendPasswordResetEmail,
  __getLastToken: getLastToken,
  __reset: resetLog
};
