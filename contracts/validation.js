const { API_VERSIONS } = require('./versioning');

function formatIssues(issues = []) {
  return issues.map((item) => ({
    path: item.path || 'unknown',
    message: item.message || 'Invalid value',
    code: item.code || 'invalid'
  }));
}

function validateBody(validator) {
  return (req, res, next) => {
    const result = validator(req.body || {});
    if (!result || result.ok) {
      if (result && result.data) {
        req.validated = req.validated || {};
        req.validated.body = result.data;
        req.body = result.data;
      }
      return next();
    }

    const payload = {
      error: 'invalid_request',
      issues: formatIssues(result.issues),
      latest: API_VERSIONS.latest,
      version: req.apiVersion || API_VERSIONS.latest
    };

    return res.status(400).json(payload);
  };
}

function sendSchema(res, validator, payload, options = {}) {
  const result = validator(payload);
  if (!result || result.ok) {
    if (options.status) {
      res.status(options.status);
    }
    return res.json(result ? result.data : payload);
  }

  const issues = formatIssues(result.issues);
  // eslint-disable-next-line no-console
  console.error('[contracts] Response validation failed', issues);
  if (!res.headersSent) {
    return res.status(500).json({ error: 'response_validation_failed', issues });
  }
  return undefined;
}

module.exports = {
  formatIssues,
  sendSchema,
  validateBody
};

