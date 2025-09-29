const SUPPORTED_VERSIONS = ['2024-06-01', '2024-04-15'];
const LATEST_VERSION = SUPPORTED_VERSIONS[0];

function normalizeVersion(input) {
  if (!input) return null;
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  return trimmed || null;
}

function resolveVersion(requested) {
  if (!requested) return LATEST_VERSION;
  const normalized = normalizeVersion(requested);
  if (!normalized) return LATEST_VERSION;
  if (SUPPORTED_VERSIONS.includes(normalized)) return normalized;
  return null;
}

const FEATURE_GATES = {
  structuredListings: '2024-04-15',
  richConversations: '2024-06-01'
};

function compareVersions(a, b) {
  return normalizeVersion(a)?.localeCompare(normalizeVersion(b) || '', undefined, { numeric: true }) || 0;
}

function resolveFeatureFlags(version) {
  const resolved = {};
  const activeVersion = normalizeVersion(version) || LATEST_VERSION;
  for (const [flag, gate] of Object.entries(FEATURE_GATES)) {
    resolved[flag] = compareVersions(activeVersion, gate) >= 0;
  }
  return resolved;
}

function versionMiddleware(req, res, next) {
  if (req.method === 'OPTIONS') {
    res.setHeader('X-API-Version', LATEST_VERSION);
    res.setHeader('X-API-Latest', LATEST_VERSION);
    req.apiVersion = LATEST_VERSION;
    req.featureFlags = resolveFeatureFlags(LATEST_VERSION);
    return next();
  }

  const requested = req.get('x-api-version')
    || req.get('x-client-version')
    || req.query.apiVersion
    || req.headers['x-app-version'];

  const version = resolveVersion(requested);

  res.setHeader('X-API-Latest', LATEST_VERSION);

  if (!version) {
    return res.status(412).json({
      error: 'unsupported_version',
      latest: LATEST_VERSION,
      supported: SUPPORTED_VERSIONS
    });
  }

  req.apiVersion = version;
  req.featureFlags = resolveFeatureFlags(version);
  res.setHeader('X-API-Version', version);
  return next();
}

module.exports = {
  API_VERSIONS: {
    latest: LATEST_VERSION,
    supported: SUPPORTED_VERSIONS
  },
  FEATURE_GATES,
  resolveFeatureFlags,
  resolveVersion,
  versionMiddleware
};

