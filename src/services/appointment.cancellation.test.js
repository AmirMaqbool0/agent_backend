import 'dotenv/config';
import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';

import { Appointment } from '../models/appointment.model.js';
import { Patient } from '../models/patient.model.js';

const API_BASE_URL = 'http://localhost:5000/api';
const createdAppointmentIds = new Set();
const createdPatientIds = new Set();

const jsonHeaders = {
  'Content-Type': 'application/json'
};

const uniqueSuffix = () => `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

const registerAndLogin = async () => {
  const email = `cancel-audit-${uniqueSuffix()}@example.com`;
  const response = await fetch(`${API_BASE_URL}/auth/register`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      name: 'Cancellation Audit User',
      email,
      password: 'CancelAudit123',
      role: 'admin'
    })
  });

  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.success, true);

  return payload.data.token;
};

const createAppointmentViaApi = async ({ token, phone, appointmentDate, reason = 'Cancellation test' }) => {
  const response = await fetch(`${API_BASE_URL}/appointments`, {
    method: 'POST',
    headers: {
      ...jsonHeaders,
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      patientName: `Cancellation Test ${uniqueSuffix()}`,
      phone,
      appointmentDate,
      reason,
      durationMinutes: 30,
      source: 'dashboard'
    })
  });

  const payload = await response.json();
  assert.equal(response.status, 201);
  assert.equal(payload.success, true);

  const appointmentId = payload.data._id;
  createdAppointmentIds.add(appointmentId);
  createdPatientIds.add(payload.data.patient._id);

  return payload.data;
};

const cancelThroughWebhook = async (body) => {
  const response = await fetch(`${API_BASE_URL}/webhooks/vapi`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(body)
  });

  const payload = await response.json();
  return {
    status: response.status,
    payload
  };
};

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
});

test.after(async () => {
  if (createdAppointmentIds.size) {
    await Appointment.deleteMany({
      _id: { $in: [...createdAppointmentIds] }
    });
  }

  if (createdPatientIds.size) {
    await Patient.deleteMany({
      _id: { $in: [...createdPatientIds] }
    });
  }

  await mongoose.disconnect();
});

test('Case 1: normal cancellation updates MongoDB and deletes the calendar event', async () => {
  const token = await registerAndLogin();
  const phone = `+923001${Math.floor(Math.random() * 900000 + 100000)}`;
  const appointment = await createAppointmentViaApi({
    token,
    phone,
    appointmentDate: '2026-07-10T10:00:00.000Z'
  });

  const { status, payload } = await cancelThroughWebhook({ phone });

  assert.equal(status, 200);
  assert.equal(payload.success, true);
  assert.equal(payload.message, 'Your appointment has been cancelled successfully.');

  const updatedAppointment = await Appointment.findById(appointment._id).lean();
  assert.equal(updatedAppointment.status, 'cancelled');
  assert.ok(updatedAppointment.cancelledAt);
  assert.equal(updatedAppointment.calendarStatus, 'deleted');
});

test('Case 2: Twilio failure does not block cancellation success', async () => {
  const token = await registerAndLogin();
  const phone = `+923002${Math.floor(Math.random() * 900000 + 100000)}`;
  const appointment = await createAppointmentViaApi({
    token,
    phone,
    appointmentDate: '2026-07-11T10:30:00.000Z'
  });

  await Patient.findByIdAndUpdate(appointment.patient._id, {
    phone: 'invalid-phone'
  });

  const { status, payload } = await cancelThroughWebhook({
    appointmentId: appointment._id
  });

  assert.equal(status, 200);
  assert.equal(payload.success, true);
  assert.equal(payload.message, 'Your appointment has been cancelled successfully.');
  assert.equal(payload.notificationSent, false);
  assert.ok(payload.notificationError);

  const updatedAppointment = await Appointment.findById(appointment._id).lean();
  assert.equal(updatedAppointment.status, 'cancelled');
  assert.equal(updatedAppointment.notificationStatus.whatsapp.sent, false);
  assert.equal(updatedAppointment.calendarStatus, 'deleted');
});

test('Case 3: already cancelled appointment returns success false', async () => {
  const token = await registerAndLogin();
  const phone = `+923003${Math.floor(Math.random() * 900000 + 100000)}`;
  const appointment = await createAppointmentViaApi({
    token,
    phone,
    appointmentDate: '2026-07-12T11:00:00.000Z'
  });

  const firstCancellation = await cancelThroughWebhook({
    appointmentId: appointment._id
  });

  assert.equal(firstCancellation.status, 200);

  const secondCancellation = await cancelThroughWebhook({
    appointmentId: appointment._id
  });

  assert.equal(secondCancellation.status, 409);
  assert.equal(secondCancellation.payload.success, false);
  assert.equal(secondCancellation.payload.message, 'Appointment is already cancelled.');
});

test('Case 4: missing appointment returns success false', async () => {
  const { status, payload } = await cancelThroughWebhook({
    appointmentId: new mongoose.Types.ObjectId().toString()
  });

  assert.equal(status, 404);
  assert.equal(payload.success, false);
  assert.equal(payload.message, 'Appointment not found');
});
