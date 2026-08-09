/*
 * Emulated-vs-native differences:
 * - Local mode streams bytes directly (CSV via res.download and PDF via PDFKit);
 *   S3 mode stores the same bytes and returns a redirect-by-URL-style download
 *   contract instead of streaming them from this process.
 * - S3 URLs expire after the configured presign interval, unlike local files.
 * - A presigned GET does not add Content-Disposition unless the caller sets
 *   ResponseContentDisposition; this adapter intentionally leaves it unset.
 * - Moto and other emulators can differ from native S3 in endpoint routing,
 *   error names, and response headers, so bucket creation accepts both
 *   BucketAlreadyOwnedByYou and BucketAlreadyExists.
 */
const {
  CreateBucketCommand,
  PutObjectCommand,
  S3Client
} = require('@aws-sdk/client-s3');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const client = new S3Client({});
client.config.forcePathStyle = process.env.S3_FORCE_PATH_STYLE === 'true';

let systemClockOffset = 0;
Object.defineProperty(client.config, 'systemClockOffset', {
  configurable: true,
  enumerable: true,
  get: () => systemClockOffset,
  set: (value) => {
    if (Number.isFinite(value)) systemClockOffset = value;
  }
});

function bucket() {
  return process.env.S3_BUCKET;
}

function keyPrefix() {
  const prefix = process.env.S3_KEY_PREFIX || '';
  return prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix;
}

async function ensureBucket() {
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket() }));
  } catch (error) {
    if (!['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(error.name)) {
      throw error;
    }
  }
}

async function uploadExport({ body, contentType, filename }) {
  const key = `${keyPrefix()}${filename}`;
  await client.send(new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    Body: body,
    ContentType: contentType
  }));
  const url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
    { expiresIn: 900 }
  );
  return { key, url };
}

module.exports = { ensureBucket, uploadExport };
