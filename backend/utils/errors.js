// Field-level error responses for the public API.
//
// The careers portal's own form validates before it submits, so a single
// message was enough for it. A partner site posting from its own form needs to
// know *which* input failed and *why* in a form it can branch on, without
// parsing English. Every failure therefore carries a machine-readable `code`
// and the `field` it belongs to.
//
// `error` is still the first message, so the existing frontend - and any
// integration written against the old shape - keeps working unchanged.

// Stable codes. Partners are told to branch on these, never on the message
// text, which is free to be reworded.
const CODES = {
  REQUIRED: 'required',
  INVALID: 'invalid',
  TOO_LONG: 'too_long',
  TOO_SHORT: 'too_short',
  OUT_OF_RANGE: 'out_of_range',
  UNSUPPORTED_TYPE: 'unsupported_type',
  NOT_FOUND: 'not_found',
  DUPLICATE: 'duplicate',
  FORBIDDEN: 'forbidden',
  UNAUTHORIZED: 'unauthorized',
  RATE_LIMITED: 'rate_limited',
  UPSTREAM: 'upstream_failed',
};

// Collects failures so one response can report every problem at once, rather
// than making a partner fix them one round trip at a time
class FieldErrors {
  constructor() {
    this.items = [];
  }

  add(field, code, message) {
    this.items.push({ field, code, message });
    return this;
  }

  // Only records the first failure per field: later rules on the same input
  // are usually consequences of the first, and reporting both reads as noise
  check(condition, field, code, message) {
    if (!condition && !this.items.some((e) => e.field === field)) {
      this.add(field, code, message);
    }
    return this;
  }

  get any() {
    return this.items.length > 0;
  }
}

// One response shape for every failure the public API returns
function fail(res, status, errors) {
  const items = Array.isArray(errors) ? errors : [errors];
  return res.status(status).json({
    success: false,
    error: items[0].message,
    errors: items,
  });
}

const oneError = (field, code, message) => ({ field, code, message });

module.exports = { CODES, FieldErrors, fail, oneError };
