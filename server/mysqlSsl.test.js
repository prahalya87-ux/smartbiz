const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const tls = require('node:tls');
const { getMysqlSslOptions } = require('./mysqlSsl');

describe('MySQL TLS configuration', () => {
  it('uses system roots and the bundled TiDB CA when requested', () => {
    const options = getMysqlSslOptions('system');
    assert.deepEqual(options.ca.slice(0, tls.rootCertificates.length), tls.rootCertificates);
    assert.match(options.ca.at(-1), /BEGIN CERTIFICATE/);
  });

  it('accepts a provider-supplied CA certificate', () => {
    const ca = '-----BEGIN CERTIFICATE-----\nexample\n-----END CERTIFICATE-----';
    assert.deepEqual(getMysqlSslOptions(ca), { ca });
  });

  it('loads a CA certificate from a path relative to the backend', () => {
    assert.match(getMysqlSslOptions('certs/isrgrootx1.pem').ca, /BEGIN CERTIFICATE/);
  });

  it('uses the bundled TiDB CA by default', () => {
    assert.match(getMysqlSslOptions().ca, /BEGIN CERTIFICATE/);
  });
});
