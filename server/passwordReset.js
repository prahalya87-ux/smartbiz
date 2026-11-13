const { createHmac, randomInt, timingSafeEqual } = require('node:crypto');

const PASSWORD_RESET_CODE_TTL_MS = 10 * 60 * 1000;
const PASSWORD_RESET_MAX_ATTEMPTS = 5;

function createPasswordResetCode(secret) {
  const code = String(randomInt(0, 1000000)).padStart(6, '0');
  return {
    code,
    hash: createHmac('sha256', secret).update(code).digest('hex'),
  };
}

function hashPasswordResetCode(code, secret) {
  return createHmac('sha256', secret).update(code).digest('hex');
}

function passwordResetCodeMatches(code, expectedHash, secret) {
  const actual = Buffer.from(hashPasswordResetCode(code, secret), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

module.exports = {
  PASSWORD_RESET_CODE_TTL_MS,
  PASSWORD_RESET_MAX_ATTEMPTS,
  createPasswordResetCode,
  hashPasswordResetCode,
  passwordResetCodeMatches,
};
