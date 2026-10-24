import assert from 'node:assert/strict';
import test from 'node:test';

import { WhatsappOutbox } from '../models/whatsappOutbox.model.js';
import { enqueueWhatsappEvent } from './whatsappOutbox.service.js';

test('a later appointment change supersedes an unsent WhatsApp event', async () => {
  const original = { updateMany: WhatsappOutbox.updateMany, create: WhatsappOutbox.create };
  const updates = [];
  WhatsappOutbox.updateMany = async (filter, update) => { updates.push({ filter, update }); };
  WhatsappOutbox.create = async (payload) => ({ ...payload, _id: 'new-job' });
  const appointment = {
    _id: 'appointment-1',
    appointmentDate: new Date('2026-10-25T10:00:00Z'),
    notificationLogs: [{ status: 'pending', outboxId: 'old-job', reason: '' }]
  };

  try {
    const job = await enqueueWhatsappEvent({
      appointment,
      kind: 'reschedule',
      phone: '+923001234567',
      body: 'Your appointment has been rescheduled.'
    });
    assert.equal(updates[0].filter.status, 'pending');
    assert.equal(updates[0].update.$set.status, 'cancelled');
    assert.equal(appointment.notificationLogs[0].status, 'skipped');
    assert.equal(job.kind, 'reschedule');
    assert.equal(job._id, 'new-job');
  } finally {
    Object.assign(WhatsappOutbox, original);
  }
});
