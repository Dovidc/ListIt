const SUPPORTER_BADGE_CODE = process.env.SUPPORTER_BADGE_CODE || 'trovelr_gold';
const SUPPORTER_BADGE_CODE_PREMIUM = process.env.SUPPORTER_BADGE_CODE_PREMIUM || 'trovelr_platinum';
const SUPPORTER_DONATION_AMOUNT = (() => {
  const raw = Number(process.env.SUPPORTER_DONATION_AMOUNT || 300);
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 300;
})();
const SUPPORTER_PREMIUM_AMOUNT = (() => {
  const raw = Number(process.env.SUPPORTER_PREMIUM_AMOUNT || 199);
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 199;
})();
const SUPPORTER_DONATION_CURRENCY = (process.env.SUPPORTER_DONATION_CURRENCY || 'usd').toLowerCase();
const SUPPORTER_SUCCESS_PATH = process.env.SUPPORTER_SUCCESS_PATH || '/?supporter=thanks&session_id={CHECKOUT_SESSION_ID}';
const SUPPORTER_CANCEL_PATH = process.env.SUPPORTER_CANCEL_PATH || '/?supporter=remind-me-later';

module.exports = {
  SUPPORTER_BADGE_CODE,
  SUPPORTER_BADGE_CODE_PREMIUM,
  SUPPORTER_DONATION_AMOUNT,
  SUPPORTER_PREMIUM_AMOUNT,
  SUPPORTER_DONATION_CURRENCY,
  SUPPORTER_SUCCESS_PATH,
  SUPPORTER_CANCEL_PATH
};
