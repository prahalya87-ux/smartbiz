const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { getMysqlSslOptions } = require('./mysqlSsl');

describe('MySQL TLS configuration', () => {
  it('uses the system trust store when requested', () => {
    assert.deepEqual(getMysqlSslOptions('system'), {});
  });

  it('accepts a provider-supplied CA certificate', () => {
    const ca = '-----BEGIN CERTIFICATE-----\nexample\n-----END CERTIFICATE-----';
    assert.deepEqual(getMysqlSslOptions(ca), { ca });
  });

  it('loads a CA certificate from a path relative to the backend', () => {
    assert.match(getMysqlSslOptions('certs/isrgrootx1.pem').ca, /BEGIN CERTIFICATE/);
  });

  it('keeps the bundled Aiven CA as the default', () => {
    assert.match(getMysqlSslOptions().ca, /BEGIN CERTIFICATE/);
  });
});
