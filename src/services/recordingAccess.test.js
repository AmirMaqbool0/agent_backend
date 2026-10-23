import assert from 'node:assert/strict';
import test from 'node:test';

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/unit-test';
process.env.JWT_SECRET ||= 'unit-test-secret';

const { signedRecordingUrl, isValidRecordingSignature } = await import('./recordingAccess.service.js');

test('recording links expire and cannot be used for another call', () => {
  const url = new URL(signedRecordingUrl({ _id: 'call-one' }, 'https://backend.example'));
  const expires = url.searchParams.get('expires');
  const signature = url.searchParams.get('signature');

  assert.equal(isValidRecordingSignature('call-one', expires, signature), true);
  assert.equal(isValidRecordingSignature('call-two', expires, signature), false);
  assert.equal(isValidRecordingSignature('call-one', '1', signature), false);
});
