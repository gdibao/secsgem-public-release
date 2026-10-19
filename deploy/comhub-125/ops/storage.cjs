const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const req = createRequire('/app/package.json');
const { S3Client, CreateBucketCommand, HeadBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = req('@aws-sdk/client-s3');
const { getSignedUrl } = require('./s3-presign.cjs');
const mode = process.argv[2];
if (!['init', 'check', 'check-internal'].includes(mode)) throw new Error('Usage: storage.cjs init|check|check-internal');
const Bucket = process.env.S3_BUCKET;
const endpoint = mode === 'check' ? process.env.S3_ENDPOINT : process.env.S3_INTERNAL_ENDPOINT;
const client = new S3Client({
  endpoint,
  region: process.env.S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});
(async () => {
  if (mode === 'init') {
    try { await client.send(new HeadBucketCommand({ Bucket })); }
    catch (error) {
      if (error.$metadata?.httpStatusCode !== 404) throw error;
      await client.send(new CreateBucketCommand({ Bucket }));
    }
    console.log('Private bucket exists; no anonymous policy or ACL was added.');
    return;
  }
  const Key = `deployment-check/${randomUUID()}.txt`;
  const body = 'fab125 storage verification';
  let created = false;
  try {
    const put = await getSignedUrl(client, new PutObjectCommand({ Bucket, Key }), { expiresIn: 60 });
    const upload = await fetch(put, { method: 'PUT', body, signal: AbortSignal.timeout(30000) });
    if (!upload.ok) throw new Error(`Presigned PUT failed status=${upload.status}`);
    created = true;
    const get = await getSignedUrl(client, new GetObjectCommand({ Bucket, Key }), { expiresIn: 60 });
    const download = await fetch(get, { signal: AbortSignal.timeout(30000) });
    if (!download.ok || await download.text() !== body) throw new Error('Presigned GET failed');
    const anonymous = await fetch(`${endpoint}/${Bucket}/${Key}`, { signal: AbortSignal.timeout(30000) });
    if (anonymous.status !== 403) throw new Error('Object must reject unsigned access with 403');
    await anonymous.body?.cancel();
    console.log(`${mode}: signed PUT/GET pass, unsigned GET denied.`);
  } finally {
    if (created) {
      await client.send(new DeleteObjectCommand({ Bucket, Key }));
      try {
        await client.send(new GetObjectCommand({ Bucket, Key }));
        throw new Error('Deleted object remains readable');
      } catch (error) {
        if (error.$metadata?.httpStatusCode !== 404) throw error;
      }
      console.log('DELETE confirmed by authenticated GET 404.');
    }
  }
})().catch(error => { console.error(JSON.stringify({ failed: true, type: error.name, status: error.$metadata?.httpStatusCode, code: error.code || error.cause?.code })); process.exitCode = 1; }).finally(() => client.destroy());
