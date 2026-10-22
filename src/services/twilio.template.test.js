import assert from 'node:assert/strict';
import test from 'node:test';

// env.js validates these at import time; unit tests never touch a real database or Twilio.
process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/unit-test';
process.env.JWT_SECRET ||= 'unit-test-secret';
process.env.TWILIO_WHATSAPP_FROM ||= 'whatsapp:+14155238886';

const { sendWhatsappMessage } = await import('./twilio.service.js');

// Records every messages.create call and replays scripted responses or errors.
const fakeClient = (...outcomes) => {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (payload) => {
        calls.push(payload);
        const outcome = outcomes.shift();
        if (outcome instanceof Error) {
          throw outcome;
        }
        return { sid: `SM${calls.length}`, status: 'queued', to: payload.to, ...outcome };
      }
    }
  };
};

const twilioError = (code, message) => Object.assign(new Error(message), { code });

const template = { contentSid: 'HXconfirm', variables: { 1: 'Ayesha', 2: 'Clinic', 3: 'Mon, Oct 26', 4: '11:00 AM' } };

test('without a template it sends free-form text', async () => {
  const client = fakeClient({});
  const result = await sendWhatsappMessage({ to: '03001234567', body: 'Hello' }, { client });

  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].body, 'Hello');
  assert.equal(client.calls[0].contentSid, undefined);
  assert.equal(client.calls[0].to, 'whatsapp:+923001234567');
  assert.equal(result.delivered, true);
  assert.equal(result.usedTemplate, '');
});

test('with a template it sends the template and its variables', async () => {
  const client = fakeClient({});
  const result = await sendWhatsappMessage({ to: '03001234567', body: 'Hello', template }, { client });

  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].contentSid, 'HXconfirm');
  assert.deepEqual(JSON.parse(client.calls[0].contentVariables), template.variables);
  assert.equal(client.calls[0].body, undefined);
  assert.equal(result.usedTemplate, 'HXconfirm');
});

test('a rejected template falls back to free-form text', async () => {
  const client = fakeClient(twilioError(21655, 'The ContentSid is Invalid'), {});
  const result = await sendWhatsappMessage({ to: '03001234567', body: 'Hello', template }, { client });

  assert.equal(client.calls.length, 2);
  assert.equal(client.calls[1].body, 'Hello');
  assert.equal(result.delivered, true);
  assert.equal(result.usedTemplate, '');
  assert.match(result.templateError, /template/i);
});

test('a recipient problem does not trigger a pointless free-form retry', async () => {
  const client = fakeClient(twilioError(63003, 'Not a WhatsApp number'));
  const result = await sendWhatsappMessage({ to: '03001234567', body: 'Hello', template }, { client });

  assert.equal(client.calls.length, 1);
  assert.equal(result.delivered, false);
  assert.match(result.error, /not on WhatsApp/);
});
