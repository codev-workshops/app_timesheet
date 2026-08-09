const fs = require('fs');
const path = require('path');

function root() {
  return process.env.REPORT_ARTIFACTS_DIR || path.join(__dirname, '../../temp/report-artifacts');
}

async function putArtifact(key, buffer, contentType) {
  // The local store has no content-type metadata; S3 implementations must honor it.
  const file = path.join(root(), key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buffer);
  return `file://${file}`;
}

function getArtifact(location) {
  return fs.readFileSync(new URL(location));
}

module.exports = { putArtifact, getArtifact };
