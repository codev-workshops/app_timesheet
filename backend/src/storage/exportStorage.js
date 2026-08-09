function isS3Backend() {
  return (process.env.EXPORT_BACKEND || 'local').toLowerCase() === 's3';
}

function getS3Adapter() {
  return require('./s3Adapter');
}

async function initializeExportStorage() {
  if (isS3Backend()) {
    await getS3Adapter().ensureBucket();
  }
}

async function deliverExport({ body, contentType, filename, res }) {
  if (!isS3Backend()) {
    return false;
  }

  const { key, url } = await getS3Adapter().uploadExport({
    body,
    contentType,
    filename
  });
  res.status(200).json({ url, filename, key });
  return true;
}

module.exports = {
  deliverExport,
  initializeExportStorage,
  isS3Backend
};
