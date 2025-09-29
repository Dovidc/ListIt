function issue(path, message, code = 'invalid') {
  return { path, message, code };
}

function coerceString(value) {
  if (value == null) return '';
  return String(value);
}

function coerceTrimmed(value) {
  return coerceString(value).trim();
}

function coerceNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.NaN;
}

function coerceBoolean(value) {
  if (value === true || value === false) return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return Boolean(value);
}

function sanitizeTags(tags) {
  if (tags == null) return undefined;
  const arr = Array.isArray(tags)
    ? tags
    : coerceString(tags).split(',');
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const value = coerceTrimmed(raw).toLowerCase();
    if (!value) continue;
    const clean = value.replace(/[^a-z0-9 \-]/g, '');
    if (!clean || clean.length > 32) continue;
    if (seen.has(clean)) continue;
    out.push(clean);
    seen.add(clean);
    if (out.length >= 20) break;
  }
  if (!out.length) return undefined;
  return out;
}

function normalizeUploadTokens(rawValue) {
  const list = [];
  if (rawValue == null) return list;
  const source = Array.isArray(rawValue) ? rawValue : [rawValue];
  for (const candidate of source) {
    const token = coerceTrimmed(candidate);
    if (!token) continue;
    if (list.includes(token)) continue;
    list.push(token);
    if (list.length >= 12) break;
  }
  return list;
}

function normalizeImageList(rawImages) {
  if (rawImages == null) return [];
  const source = Array.isArray(rawImages) ? rawImages : [rawImages];
  const out = [];
  for (const candidate of source) {
    if (typeof candidate !== 'string') continue;
    const value = candidate.trim();
    if (!value) continue;
    out.push(value);
    if (out.length >= 10) break;
  }
  return out;
}

function normalizeDeletedImages(raw) {
  if (raw == null) return [];
  const source = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (const candidate of source) {
    if (typeof candidate !== 'string') continue;
    const value = candidate.trim();
    if (!value) continue;
    if (out.includes(value)) continue;
    out.push(value);
    if (out.length >= 20) break;
  }
  return out;
}

function success(data) {
  return { ok: true, data };
}

function failure(issues) {
  return { ok: false, issues };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

function validateRegisterRequest(raw = {}) {
  const issues = [];
  const username = coerceTrimmed(raw.username) || coerceTrimmed(raw.name);
  const email = coerceTrimmed(raw.email).toLowerCase();
  const password = typeof raw.password === 'string' ? raw.password : '';

  if (!username) {
    issues.push(issue('username', 'Username is required', 'required'));
  } else if (username.length < 3) {
    issues.push(issue('username', 'Username must be at least 3 characters', 'too_short'));
  } else if (username.length > 32) {
    issues.push(issue('username', 'Username must be 3-32 characters', 'too_long'));
  }

  if (!email) {
    issues.push(issue('email', 'Email is required', 'required'));
  } else if (!EMAIL_RE.test(email)) {
    issues.push(issue('email', 'Email must be valid', 'invalid_email'));
  }

  if (!password) {
    issues.push(issue('password', 'Password is required', 'required'));
  } else if (password.length < 6) {
    issues.push(issue('password', 'Password must be at least 6 characters', 'too_short'));
  } else if (password.length > 128) {
    issues.push(issue('password', 'Password must be 128 characters or less', 'too_long'));
  }

  if (issues.length) return failure(issues);

  return success({
    username,
    email,
    password
  });
}

function validateLoginRequest(raw = {}) {
  const issues = [];
  const email = coerceTrimmed(raw.email).toLowerCase();
  const password = typeof raw.password === 'string' ? raw.password : '';

  if (!email) {
    issues.push(issue('email', 'Email is required', 'required'));
  } else if (!EMAIL_RE.test(email)) {
    issues.push(issue('email', 'Email must be valid', 'invalid_email'));
  }

  if (!password) {
    issues.push(issue('password', 'Password is required', 'required'));
  }

  if (issues.length) return failure(issues);

  return success({ email, password });
}

function validateCreateListingRequest(raw = {}) {
  const issues = [];
  const sanitized = {};

  const title = coerceTrimmed(raw.title);
  const description = coerceString(raw.description ?? '').slice(0, 400);
  const location = coerceTrimmed(raw.location);
  const priceRaw = raw.price;
  const tags = sanitizeTags(raw.tags);
  const enableNearby = coerceBoolean(raw.enable_nearby);
  const lat = coerceNumber(raw.lat);
  const lon = coerceNumber(raw.lon);

  if (!title) {
    issues.push(issue('title', 'Title is required', 'required'));
  } else if (title.length > 80) {
    issues.push(issue('title', 'Title must be 80 characters or less', 'too_long'));
  }

  if (!location) {
    issues.push(issue('location', 'Location is required', 'required'));
  } else if (location.length > 80) {
    issues.push(issue('location', 'Location must be 80 characters or less', 'too_long'));
  }

  let price = coerceNumber(priceRaw);
  if (!Number.isFinite(price) || price < 0) {
    issues.push(issue('price', 'Price must be a non-negative number', 'invalid_number'));
    price = 0;
  }

  const uploadTokens = normalizeUploadTokens(raw.upload_tokens ?? raw.uploadTokens);
  if (!uploadTokens.length) {
    issues.push(issue('upload_tokens', 'At least one uploaded image is required', 'required'));
  }

  if (issues.length) return failure(issues);

  sanitized.title = title;
  sanitized.description = description;
  sanitized.location = location;
  sanitized.price = Number(price);
  if (tags) sanitized.tags = tags;
  sanitized.enable_nearby = Boolean(enableNearby);
  sanitized.lat = Number.isFinite(lat) ? Number(lat) : undefined;
  sanitized.lon = Number.isFinite(lon) ? Number(lon) : undefined;
  sanitized.upload_tokens = uploadTokens;
  sanitized.uploadTokens = uploadTokens;

  for (const key of Object.keys(raw)) {
    if (!(key in sanitized)) {
      sanitized[key] = raw[key];
    }
  }

  return success(sanitized);
}

function validateUpdateListingRequest(raw = {}) {
  const issues = [];
  const sanitized = {};
  let hasKnownField = false;

  if (raw.title !== undefined) {
    const title = coerceTrimmed(raw.title);
    if (!title) {
      issues.push(issue('title', 'Title cannot be empty', 'too_short'));
    } else if (title.length > 80) {
      issues.push(issue('title', 'Title must be 80 characters or less', 'too_long'));
    } else {
      sanitized.title = title;
      hasKnownField = true;
    }
  }

  if (raw.description !== undefined) {
    const description = coerceString(raw.description).slice(0, 400);
    sanitized.description = description;
    hasKnownField = true;
  }

  if (raw.location !== undefined) {
    const location = coerceTrimmed(raw.location);
    if (!location) {
      issues.push(issue('location', 'Location cannot be empty', 'too_short'));
    } else if (location.length > 80) {
      issues.push(issue('location', 'Location must be 80 characters or less', 'too_long'));
    } else {
      sanitized.location = location;
      hasKnownField = true;
    }
  }

  if (raw.price !== undefined) {
    const price = coerceNumber(raw.price);
    if (!Number.isFinite(price) || price < 0) {
      issues.push(issue('price', 'Price must be a non-negative number', 'invalid_number'));
    } else {
      sanitized.price = Number(price);
      hasKnownField = true;
    }
  }

  if (raw.tags !== undefined) {
    const tags = sanitizeTags(raw.tags);
    sanitized.tags = tags;
    hasKnownField = true;
  }

  if (raw.enable_nearby !== undefined) {
    sanitized.enable_nearby = coerceBoolean(raw.enable_nearby);
    hasKnownField = true;
  }

  if (raw.sold !== undefined) {
    sanitized.sold = coerceBoolean(raw.sold);
    hasKnownField = true;
  }

  if (raw.lat !== undefined) {
    const lat = coerceNumber(raw.lat);
    sanitized.lat = Number.isFinite(lat) ? Number(lat) : undefined;
    hasKnownField = true;
  }

  if (raw.lon !== undefined) {
    const lon = coerceNumber(raw.lon);
    sanitized.lon = Number.isFinite(lon) ? Number(lon) : undefined;
    hasKnownField = true;
  }

  if (raw.deletedImages !== undefined) {
    sanitized.deletedImages = normalizeDeletedImages(raw.deletedImages);
    hasKnownField = true;
  }

  for (const key of Object.keys(raw)) {
    if (!(key in sanitized)) {
      sanitized[key] = raw[key];
    }
  }

  if (!hasKnownField) {
    issues.push(issue('body', 'At least one field must be provided', 'empty'));
  }

  if (issues.length) return failure(issues);
  return success(sanitized);
}

function validateSendMessageRequest(raw = {}) {
  const issues = [];
  const sanitized = {};

  const body = coerceTrimmed(raw.body || '');
  const images = normalizeImageList(raw.images);

  if (!body && images.length === 0) {
    issues.push(issue('body', 'Message body or at least one image is required', 'required'));
  }

  if (body) {
    if (body.length > 2000) {
      issues.push(issue('body', 'Messages must be 2000 characters or less', 'too_long'));
    } else {
      sanitized.body = body;
    }
  }

  if (images.length) {
    sanitized.images = images;
  }

  for (const key of Object.keys(raw)) {
    if (!(key in sanitized)) {
      sanitized[key] = raw[key];
    }
  }

  if (issues.length) return failure(issues);
  return success(sanitized);
}

function validateAuthResponse(payload = {}) {
  const issues = [];
  const data = { ...payload };

  const id = Number(payload.id);
  const token = typeof payload.token === 'string' ? payload.token : '';
  const pushMeta = payload.push_meta;

  if (!Number.isFinite(id)) {
    issues.push(issue('id', 'id must be a number', 'invalid_number'));
  }

  if (!token) {
    issues.push(issue('token', 'token must be provided', 'required'));
  }

  if (pushMeta && typeof pushMeta === 'object') {
    data.push_meta = {
      available: Boolean(pushMeta.available),
      vapid_public_key: pushMeta.vapid_public_key ?? null
    };
  }

  if (issues.length) return failure(issues);
  data.id = id;
  return success(data);
}

function validateListingResponse(payload = {}) {
  const issues = [];
  const id = Number(payload.id);
  const userId = Number(payload.user_id ?? payload.userId);
  const title = coerceTrimmed(payload.title);
  const price = Number(payload.price);

  if (!Number.isFinite(id)) {
    issues.push(issue('id', 'id must be a number', 'invalid_number'));
  }
  if (!Number.isFinite(userId)) {
    issues.push(issue('user_id', 'user_id must be a number', 'invalid_number'));
  }
  if (!title) {
    issues.push(issue('title', 'title is required', 'required'));
  }
  if (!Number.isFinite(price)) {
    issues.push(issue('price', 'price must be numeric', 'invalid_number'));
  }

  if (issues.length) return failure(issues);
  return success(payload);
}

function validateMessageEnvelopeResponse(payload = {}) {
  const issues = [];
  const message = payload.message;

  if (!message || typeof message !== 'object') {
    issues.push(issue('message', 'message payload missing', 'required'));
  } else {
    const id = Number(message.id);
    const conversationId = Number(message.conversation_id ?? message.conversationId);
    const senderId = Number(message.sender_id ?? message.senderId);
    if (!Number.isFinite(id)) issues.push(issue('message.id', 'message.id must be numeric', 'invalid_number'));
    if (!Number.isFinite(conversationId)) issues.push(issue('message.conversation_id', 'message.conversation_id must be numeric', 'invalid_number'));
    if (!Number.isFinite(senderId)) issues.push(issue('message.sender_id', 'message.sender_id must be numeric', 'invalid_number'));
    if (!Array.isArray(message.images)) {
      issues.push(issue('message.images', 'message.images must be an array', 'invalid_type'));
    }
  }

  if (typeof payload.other_user_deleted !== 'boolean') {
    issues.push(issue('other_user_deleted', 'other_user_deleted must be boolean', 'invalid_type'));
  }

  if (issues.length) return failure(issues);
  return success(payload);
}

module.exports = {
  validateRegisterRequest,
  validateLoginRequest,
  validateCreateListingRequest,
  validateUpdateListingRequest,
  validateSendMessageRequest,
  validateAuthResponse,
  validateListingResponse,
  validateMessageEnvelopeResponse
};

