const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  PASSWORD_RESET_CODE_TTL_MS,
  PASSWORD_RESET_MAX_ATTEMPTS,
  createPasswordResetCode,
  hashPasswordResetCode,
  passwordResetCodeMatches,
} = require('./passwordReset');

describe('password reset codes', () => {
  it('creates six-digit codes with keyed hashes', () => {
    const secret = 'test-secret';
    const reset = createPasswordResetCode(secret);
    assert.match(reset.code, /^\d{6}$/);
    assert.match(reset.hash, /^[a-f0-9]{64}$/);
    assert.equal(reset.hash, hashPasswordResetCode(reset.code, secret));
    assert.notEqual(reset.hash, hashPasswordResetCode(reset.code, 'different-secret'));
  });

  it('matches only the exact code and secret', () => {
    const secret = 'test-secret';
    const reset = createPasswordResetCode(secret);
    assert.equal(passwordResetCodeMatches(reset.code, reset.hash, secret), true);
    assert.equal(passwordResetCodeMatches('000000', reset.hash, secret), reset.code === '000000');
    assert.equal(passwordResetCodeMatches(reset.code, reset.hash, 'different-secret'), false);
  });

  it('uses a short expiry and caps verification attempts', () => {
    assert.equal(PASSWORD_RESET_CODE_TTL_MS, 10 * 60 * 1000);
    assert.equal(PASSWORD_RESET_MAX_ATTEMPTS, 5);
  });
});
