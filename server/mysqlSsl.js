const fs = require('node:fs');
const path = require('node:path');
const tls = require('node:tls');

const TIDB_CA_PATH = path.join(__dirname, 'certs', 'isrgrootx1.pem');

function getMysqlSslOptions(caSetting = process.env.MYSQL_SSL_CA) {
  if (caSetting === 'system') {
    return {
      ca: [...tls.rootCertificates, fs.readFileSync(TIDB_CA_PATH, 'utf8')],
    };
  }
  if (caSetting) {
    if (caSetting.includes('-----BEGIN CERTIFICATE-----')) return { ca: caSetting };
    const caPath = path.isAbsolute(caSetting) ? caSetting : path.resolve(__dirname, caSetting);
    return { ca: fs.readFileSync(caPath, 'utf8') };
  }
  return { ca: fs.readFileSync(TIDB_CA_PATH, 'utf8') };
}

module.exports = { getMysqlSslOptions };
