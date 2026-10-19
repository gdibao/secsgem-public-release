// The image includes the S3 client and Smithy signer, but not s3-request-presigner.
// This maintenance adapter supports only the three fixed object verification calls.
const { createRequire } = require('node:module');
const req = createRequire('/app/package.json');
const sdk = req('@aws-sdk/client-s3');
const fromClient = createRequire(req.resolve('@aws-sdk/client-s3'));
const { SignatureV4 } = fromClient('@smithy/signature-v4');
const { HttpRequest } = fromClient('@smithy/protocol-http');
const { Hash } = fromClient('@smithy/hash-node');

exports.getSignedUrl = async (client, command, { expiresIn }) => {
  const methods = [[sdk.PutObjectCommand, 'PUT'], [sdk.GetObjectCommand, 'GET'], [sdk.DeleteObjectCommand, 'DELETE']];
  const method = methods.find(([Type]) => command instanceof Type)?.[1];
  if (!method) throw new Error('Unsupported maintenance signing command');
  const { Bucket, Key } = command.input;
  if (Bucket !== 'comhub-files' || !/^deployment-check\/[a-zA-Z0-9.-]+$/.test(Key)) throw new Error('Signing outside verification prefix refused');
  const endpoint = await client.config.endpoint();
  const host = endpoint.hostname + (endpoint.port ? ':' + endpoint.port : '');
  const signer = new SignatureV4({
    service: 's3', region: await client.config.region(), credentials: client.config.credentials,
    sha256: Hash.bind(null, 'sha256'), uriEscapePath: false,
  });
  const request = new HttpRequest({
    ...endpoint, method, path: `/${Bucket}/${Key}`,
    headers: { host, 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD' },
  });
  const signed = await signer.presign(request, { expiresIn });
  const url = new URL(`${signed.protocol}//${host}${signed.path}`);
  for (const [key, value] of Object.entries(signed.query || {})) {
    for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, item);
  }
  return url.href;
};
