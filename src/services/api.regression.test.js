import 'dotenv/config';
import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';

import { Appointment } from '../models/appointment.model.js';
import { CallLog } from '../models/callLog.model.js';
import { ClinicConfig } from '../models/clinicConfig.model.js';
import { Patient } from '../models/patient.model.js';
import { User } from '../models/user.model.js';

// Integration tests against a running backend (see appointment.cancellation.test.js for setup).
const API_BASE_URL = process.env.TEST_API_URL || 'http://localhost:5000/api';
const ADMIN = { email: 'regression-admin@clinic.test', password: 'RegressionTest123' };
const createdPatientIds = new Set();
const createdUserEmails = new Set([ADMIN.email]);
let token = '';
let originalWhatsappEnabled = true;

const request = async (method, path, body, authToken = token) => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  return { status: response.status, payload: await response.json() };
};

const futureSlot = (daysAhead, hourUtc, minute = 0) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysAhead);
  date.setUTCHours(hourUtc, minute, 0, 0);
  return date.toISOString();
};

const uniquePhone = () => `+92345${Math.floor(Math.random() * 9000000 + 1000000)}`;

const book = async (overrides = {}) => {
  const result = await request('POST', '/appointments', {
    patientName: 'Regression Patient',
    phone: uniquePhone(),
    appointmentDate: futureSlot(40, 6),
    durationMinutes: 30,
    ...overrides
  });

  if (result.payload?.data?.patient?._id) {
    createdPatientIds.add(result.payload.data.patient._id);
  }

  return result;
};

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const config = await ClinicConfig.findOne();
  originalWhatsappEnabled = config?.whatsappEnabled ?? true;
  await ClinicConfig.updateOne({}, { $set: { whatsappEnabled: false } }, { upsert: true });

  if (!(await User.exists({ email: ADMIN.email }))) {
    await User.create({ name: 'Regression Admin', role: 'admin', ...ADMIN });
  }

  const login = await request('POST', '/auth/login', ADMIN, null);
  assert.equal(login.status, 200);
  token = login.payload.data.token;
});

test.after(async () => {
  const patientIds = [...createdPatientIds];
  await Appointment.deleteMany({ patient: { $in: patientIds } });
  await Patient.deleteMany({ _id: { $in: patientIds } });
  await User.deleteMany({ email: { $in: [...createdUserEmails] } });
  await CallLog.deleteMany({ vapiCallId: /^regression-call-/ });
  await ClinicConfig.updateOne({}, { $set: { whatsappEnabled: originalWhatsappEnabled } });
  await mongoose.disconnect();
});

test('public registration is closed once an account exists', async () => {
  const { status, payload } = await request(
    'POST',
    '/auth/register',
    { name: 'Intruder', email: 'intruder@clinic.test', password: 'Intruder12345' },
    null
  );

  assert.equal(status, 403);
  assert.equal(payload.success, false);
  assert.equal(await User.exists({ email: 'intruder@clinic.test' }), null);
});

test('expired or invalid tokens return 401 instead of 500', async () => {
  const { status } = await request('GET', '/auth/me', null, 'not-a-real-token');
  assert.equal(status, 401);
});

test('overlapping bookings are rejected using the full appointment duration', async () => {
  const start = futureSlot(41, 6, 0);
  const first = await book({ appointmentDate: start, durationMinutes: 60 });
  assert.equal(first.status, 201);

  // Starts 45 minutes into a 60-minute appointment: the old +/-29 minute check let this through.
  const overlapping = await book({ appointmentDate: futureSlot(41, 6, 45), durationMinutes: 30 });
  assert.equal(overlapping.status, 409);

  const adjacent = await book({ appointmentDate: futureSlot(41, 7, 0), durationMinutes: 30 });
  assert.equal(adjacent.status, 201);
});

test('bookings in the past are rejected', async () => {
  const past = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { status, payload } = await book({ appointmentDate: past });
  assert.equal(status, 400);
  assert.match(payload.message, /future/i);
});

test('dashboard edits update details and move the time', async () => {
  const created = await book({ appointmentDate: futureSlot(42, 6), reason: 'Checkup' });
  assert.equal(created.status, 201);
  const id = created.payload.data._id;

  const edited = await request('PUT', `/appointments/${id}`, {
    reason: 'Follow-up',
    appointmentDate: futureSlot(42, 8),
    durationMinutes: 45
  });

  assert.equal(edited.status, 200);
  assert.equal(edited.payload.data.reason, 'Follow-up');
  assert.equal(edited.payload.data.durationMinutes, 45);
  assert.equal(new Date(edited.payload.data.appointmentDate).toISOString(), futureSlot(42, 8));

  const completed = await request('PUT', `/appointments/${id}`, { status: 'completed' });
  assert.equal(completed.status, 200);
  assert.equal(completed.payload.data.status, 'completed');
});

test('disabled WhatsApp is recorded as skipped, not failed', async () => {
  const created = await book({ appointmentDate: futureSlot(43, 6) });
  assert.equal(created.status, 201);
  assert.equal(created.payload.data.whatsappStatus, 'skipped');
  assert.equal(created.payload.data.notificationSent, false);
});

test('patient phones are normalized so local and international formats match', async () => {
  const local = `0345${Math.floor(Math.random() * 9000000 + 1000000)}`;
  const created = await request('POST', '/patients', { fullName: 'Format Test', phone: local });
  assert.equal(created.status, 201);
  createdPatientIds.add(created.payload.data._id);
  assert.equal(created.payload.data.phone, `+92${local.slice(1)}`);
  assert.equal(created.payload.data.appointmentsCount, 0);

  const duplicate = await request('POST', '/patients', {
    fullName: 'Format Test Again',
    phone: `+92${local.slice(1)}`
  });
  assert.equal(duplicate.status, 409);

  const search = await request('GET', `/patients/search?q=${encodeURIComponent('+92')}`);
  assert.equal(search.status, 200);
  assert.ok(Array.isArray(search.payload.data));
});

test('profile and password can be changed by the signed-in user', async () => {
  const email = `staff-${Date.now()}@clinic.test`;
  createdUserEmails.add(email);
  const createdUser = await request('POST', '/auth/users', {
    name: 'Front Desk',
    email,
    password: 'FrontDesk123',
    role: 'staff'
  });
  assert.equal(createdUser.status, 201);

  const login = await request('POST', '/auth/login', { email, password: 'FrontDesk123' }, null);
  const staffToken = login.payload.data.token;

  const profile = await request('PUT', '/auth/me', { name: 'Front Desk Lead' }, staffToken);
  assert.equal(profile.status, 200);
  assert.equal(profile.payload.data.name, 'Front Desk Lead');

  const wrongPassword = await request(
    'PUT',
    '/auth/change-password',
    { currentPassword: 'nope-nope', newPassword: 'NewPassword123' },
    staffToken
  );
  assert.equal(wrongPassword.status, 400);

  const changed = await request(
    'PUT',
    '/auth/change-password',
    { currentPassword: 'FrontDesk123', newPassword: 'NewPassword123' },
    staffToken
  );
  assert.equal(changed.status, 200);

  const staffCannotManageTeam = await request('GET', '/auth/users', null, staffToken);
  assert.equal(staffCannotManageTeam.status, 403);
});

test('vapi booking tool confirms the booked time back to the caller', async () => {
  const phone = uniquePhone();
  const { status, payload } = await request(
    'POST',
    '/webhooks/vapi',
    {
      message: {
        type: 'tool-calls',
        call: { id: `regression-call-${Date.now()}` },
        toolCallList: [
          {
            id: 'tool-1',
            function: {
              name: 'bookAppointment',
              arguments: {
                patientName: 'Voice Caller',
                phone,
                appointmentDate: futureSlot(44, 6)
              }
            }
          }
        ]
      }
    },
    null
  );

  assert.equal(status, 200);
  const result = payload.results?.[0]?.result;
  assert.equal(typeof result, 'string', 'Vapi tool result must be a string');
  assert.ok(result, 'tool result returned');
  const parsed = JSON.parse(result);
  assert.equal(parsed.success, true);
  assert.match(parsed.message, /booked successfully for/i);

  const patient = await Patient.findOne({ phone });
  if (patient) {
    createdPatientIds.add(String(patient._id));
  }
});

test('vapi tools are matched regardless of name capitalization', async () => {
  const { status, payload } = await request(
    'POST',
    '/webhooks/vapi',
    {
      message: {
        type: 'tool-calls',
        call: { id: `regression-call-faq-${Date.now()}` },
        toolCallList: [
          { id: 'tool-faq', function: { name: 'AnswerFAQ', arguments: { question: 'What are your clinic timings?' } } }
        ]
      }
    },
    null
  );

  assert.equal(status, 200);
  const result = payload.results?.[0]?.result;
  assert.equal(typeof result, 'string', 'Vapi tool result must be a string');
  const parsed = JSON.parse(result);
  assert.equal(payload.results?.[0]?.toolCallId, 'tool-faq');
  assert.equal(parsed.success, true);
  assert.ok(parsed.spokenAnswer, 'FAQ answer returned');
});

test('dashboard returns server-side metrics', async () => {
  const { status, payload } = await request('GET', '/dashboard?days=7');
  assert.equal(status, 200);
  assert.equal(payload.data.series.length, 7);
  assert.ok(typeof payload.data.totals.calls === 'number');
});
