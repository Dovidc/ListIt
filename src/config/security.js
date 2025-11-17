const DEFAULT_JWT_SECRET = 'dev_jwt_change_me';

function getJwtSecret() {
  return process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
}

module.exports = { getJwtSecret, DEFAULT_JWT_SECRET };
