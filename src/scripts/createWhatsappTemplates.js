// Creates the three WhatsApp appointment templates in Twilio's Content API.
//
//   npm run whatsapp:templates            create the templates and print their Content SIDs
//   npm run whatsapp:templates -- --submit   also submit them to WhatsApp (Meta) for approval
//
// Approval needs your own WhatsApp sender (not the sandbox) connected to a Meta Business account.
// Put the printed SIDs in .env as TWILIO_TEMPLATE_CONFIRMATION_SID / _RESCHEDULE_SID / _CANCELLATION_SID.
import 'dotenv/config';

const SUBMIT = process.argv.includes('--submit');
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

if (!accountSid || !authToken) {
  console.error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set in .env');
  process.exit(1);
}

// Variables: {{1}} patient name, {{2}} clinic name, {{3}} date, {{4}} time (matches the backend).
const SAMPLE_VARIABLES = { 1: 'Ayesha', 2: 'Wellness Partners', 3: 'Mon, Oct 26', 4: '11:00 AM' };

const TEMPLATES = [
  {
    envKey: 'TWILIO_TEMPLATE_CONFIRMATION_SID',
    name: 'clinic_appointment_confirmed',
    body: 'Hello {{1}}, your appointment at {{2}} is confirmed for {{3}} at {{4}}. Reply to this message if you need to change it.'
  },
  {
    envKey: 'TWILIO_TEMPLATE_RESCHEDULE_SID',
    name: 'clinic_appointment_rescheduled',
    body: 'Hello {{1}}, your appointment at {{2}} has been moved to {{3}} at {{4}}. Reply to this message if this time does not work for you.'
  },
  {
    envKey: 'TWILIO_TEMPLATE_CANCELLATION_SID',
    name: 'clinic_appointment_cancelled',
    body: 'Hello {{1}}, your appointment at {{2}} on {{3}} at {{4}} has been cancelled. Reply to this message to book a new time.'
  }
];

const headers = {
  Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
  'Content-Type': 'application/json'
};

const request = async (path, body) => {
  const response = await fetch(`https://content.twilio.com/v1${path}`, {
    method: body ? 'POST' : 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${response.status} ${json.message || JSON.stringify(json)}`);
  }
  return json;
};

const existing = await request('/Content?PageSize=100');

for (const template of TEMPLATES) {
  let content = existing.contents?.find((item) => item.friendly_name === template.name);

  if (content) {
    console.log(`= ${template.name} already exists`);
  } else {
    content = await request('/Content', {
      friendly_name: template.name,
      language: 'en',
      variables: SAMPLE_VARIABLES,
      types: { 'twilio/text': { body: template.body } }
    });
    console.log(`+ created ${template.name}`);
  }

  if (SUBMIT) {
    try {
      await request(`/Content/${content.sid}/ApprovalRequests/whatsapp`, { name: template.name, category: 'UTILITY' });
      console.log(`  submitted ${template.name} to WhatsApp for approval`);
    } catch (error) {
      console.log(`  could not submit ${template.name}: ${error.message}`);
    }
  }

  console.log(`  ${template.envKey}=${content.sid}`);
}

console.log(
  SUBMIT
    ? '\nApproval usually takes minutes to a day. Check status in Twilio: Messaging > Content Template Builder.'
    : '\nRun again with -- --submit to request WhatsApp approval once your own WhatsApp sender is set up.'
);
