import { S3Client, PutObjectCommand, GetObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, ListObjectsV2Command, HeadBucketCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Run against the Wayvro compose S3 service (pnpm infra:up) or any local endpoint: S3_ENDPOINT=http://127.0.0.1:8333 node eval.mjs
// The SDK client sets requestChecksumCalculation WHEN_REQUIRED: with the SDK default (WHEN_SUPPORTED) presigned PUT URLs
// embed a CRC32 of the empty body and checksum-verifying servers correctly reject the upload (BadDigest).
const endpoint = process.env.S3_ENDPOINT ?? 'http://127.0.0.1:8333';
const ok = new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: 'wayvro-local-access', secretAccessKey: 'wayvro-local-secret-not-for-production' }, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
const bad = new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: 'wayvro-local-access', secretAccessKey: 'WRONG' } });
const Bucket = 'wayvro-local';
const out = [];
const rec = (name, pass, detail = '') => { out.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`); };

try { await ok.send(new HeadBucketCommand({ Bucket })); rec('pre-created bucket exists', true); } catch (e) { rec('pre-created bucket exists', false, e.name); }
await ok.send(new PutObjectCommand({ Bucket, Key: 'a/hello.txt', Body: 'hello wayvro', ContentType: 'text/plain' }));
const got = await (await ok.send(new GetObjectCommand({ Bucket, Key: 'a/hello.txt' }))).Body.transformToString();
rec('SigV4 put/get roundtrip', got === 'hello wayvro');
try { await bad.send(new GetObjectCommand({ Bucket, Key: 'a/hello.txt' })); rec('wrong secret rejected', false, 'accepted!'); } catch (e) { rec('wrong secret rejected', true, e.name); }
const anon = await fetch(`${endpoint}/${Bucket}/a/hello.txt`);
rec('anonymous GET rejected', anon.status === 403 || anon.status === 401, `HTTP ${anon.status}`);

const putUrl = await getSignedUrl(ok, new PutObjectCommand({ Bucket, Key: 'p2/upload.bin', ContentType: 'application/octet-stream' }), { expiresIn: 60 });
const pr = await fetch(putUrl, { method: 'PUT', body: Buffer.from('presigned-body'), headers: { 'content-type': 'application/octet-stream' } });
rec('presigned PUT works', pr.status === 200, `HTTP ${pr.status}`);
const getUrl = await getSignedUrl(ok, new GetObjectCommand({ Bucket, Key: 'p2/upload.bin' }), { expiresIn: 60 });
const gr = await fetch(getUrl);
rec('presigned GET works', gr.status === 200 && (await gr.text()) === 'presigned-body', `HTTP ${gr.status}`);
const tampered = getUrl.replace(/X-Amz-Signature=([0-9a-f])/, (m, c) => `X-Amz-Signature=${c === 'a' ? 'b' : 'a'}`);
const tr = await fetch(tampered);
rec('tampered presigned signature rejected', tr.status === 403, `HTTP ${tr.status}`);
const otherKey = getUrl.replace('p2/upload.bin', 'a/hello.txt');
const ok2 = await fetch(otherKey);
rec('presigned URL not reusable for another key', ok2.status === 403, `HTTP ${ok2.status}`);
const shortUrl = await getSignedUrl(ok, new GetObjectCommand({ Bucket, Key: 'p2/upload.bin' }), { expiresIn: 1 });
await new Promise((r) => setTimeout(r, 2500));
const er = await fetch(shortUrl);
rec('expired presigned URL rejected', er.status === 403, `HTTP ${er.status}`);

const { UploadId } = await ok.send(new CreateMultipartUploadCommand({ Bucket, Key: 'm/big.bin' }));
const part = Buffer.alloc(5 * 1024 * 1024, 7);
const p1 = await ok.send(new UploadPartCommand({ Bucket, Key: 'm/big.bin', UploadId, PartNumber: 1, Body: part }));
const p2 = await ok.send(new UploadPartCommand({ Bucket, Key: 'm/big.bin', UploadId, PartNumber: 2, Body: Buffer.from('tail') }));
await ok.send(new CompleteMultipartUploadCommand({ Bucket, Key: 'm/big.bin', UploadId, MultipartUpload: { Parts: [{ ETag: p1.ETag, PartNumber: 1 }, { ETag: p2.ETag, PartNumber: 2 }] } }));
const big = await (await ok.send(new GetObjectCommand({ Bucket, Key: 'm/big.bin' }))).Body.transformToByteArray();
rec('multipart upload (5 MiB + tail)', big.length === part.length + 4, `${big.length} bytes`);
const list = await ok.send(new ListObjectsV2Command({ Bucket }));
rec('list objects', (list.KeyCount ?? 0) >= 3, `${list.KeyCount} keys`);
console.log(out.every((o) => o.pass) ? 'S3 EVAL: PASS' : 'S3 EVAL: FAIL');
