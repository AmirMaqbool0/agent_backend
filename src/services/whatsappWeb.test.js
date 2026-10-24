import assert from 'node:assert/strict';
import test from 'node:test';

import { WhatsappWebAuth } from '../models/whatsappWebAuth.model.js';
import { createMongoAuthState } from './whatsappWeb.service.js';

test('Mongo auth store persists credentials and Signal keys across restarts', async () => {
  const documents = new Map();
  const original = {
    findById: WhatsappWebAuth.findById,
    find: WhatsappWebAuth.find,
    replaceOne: WhatsappWebAuth.replaceOne,
    bulkWrite: WhatsappWebAuth.bulkWrite
  };

  WhatsappWebAuth.findById = (id) => ({ lean: async () => documents.get(id) || null });
  WhatsappWebAuth.find = ({ _id }) => ({
    lean: async () => _id.$in.map((id) => documents.get(id)).filter(Boolean)
  });
  WhatsappWebAuth.replaceOne = async (_filter, replacement) => { documents.set(replacement._id, replacement); };
  WhatsappWebAuth.bulkWrite = async (operations) => {
    for (const operation of operations) {
      if (operation.replaceOne) documents.set(operation.replaceOne.replacement._id, operation.replaceOne.replacement);
      if (operation.deleteOne) documents.delete(operation.deleteOne.filter._id);
    }
  };

  try {
    const first = await createMongoAuthState();
    first.state.creds.registered = true;
    await first.saveCreds();
    await first.state.keys.set({ session: { patient: { secret: Buffer.from([1, 2, 3]) } } });

    const restored = await createMongoAuthState();
    assert.equal(restored.state.creds.registered, true);
    const keys = await restored.state.keys.get('session', ['patient', 'missing']);
    assert.deepEqual(keys.patient.secret, Buffer.from([1, 2, 3]));
    assert.equal(keys.missing, null);

    await restored.state.keys.set({ session: { patient: null } });
    assert.equal((await restored.state.keys.get('session', ['patient'])).patient, null);
  } finally {
    Object.assign(WhatsappWebAuth, original);
  }
});
