// Points a Vapi assistant and all of its tools at this backend's webhook.
//
//   npm run vapi:point -- https://your-backend.onrender.com          (assistant "Roohi")
//   npm run vapi:point -- https://your-backend.onrender.com "Sara"   (another assistant)
//
// Also sets the webhook secret when VAPI_WEBHOOK_SECRET is configured, so Vapi signs its requests.
import 'dotenv/config';

const [baseArg, assistantName = 'Roohi'] = process.argv.slice(2);
const apiKey = process.env.VAPI_API_KEY;
const base = (baseArg || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');

if (!apiKey || !/^https:\/\//.test(base)) {
  console.error('Usage: npm run vapi:point -- https://your-public-backend-url [assistant name]');
  console.error('VAPI_API_KEY must be set in .env and the URL must start with https://');
  process.exit(1);
}

const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
const vapi = async (path, method = 'GET', body) => {
  const response = await fetch(`https://api.vapi.ai${path}`, { method, headers, body: body && JSON.stringify(body) });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status} ${json.message || ''}`);
  }
  return json;
};

const assistants = await vapi('/assistant');
const assistant = assistants.find((item) => item.name?.toLowerCase() === assistantName.toLowerCase());

if (!assistant) {
  console.error(`No assistant named "${assistantName}". Found: ${assistants.map((item) => item.name).join(', ')}`);
  process.exit(1);
}

const server = {
  url: `${base}/api/webhooks/vapi`,
  // Tool calls include Google Calendar and OpenAI work; give them room on slower hosts.
  timeoutSeconds: 45,
  // Sent as a header on every webhook request; the backend checks x-vapi-secret.
  ...(process.env.VAPI_WEBHOOK_SECRET ? { headers: { 'x-vapi-secret': process.env.VAPI_WEBHOOK_SECRET } } : {})
};

// Setting `serverMessages` replaces Vapi's defaults. Preserve any messages
// already selected in the dashboard, then guarantee the three this backend
// needs: live call creation/status, the completed-call report, and tool calls.
const requiredServerMessages = ['status-update', 'end-of-call-report', 'tool-calls'];
const serverMessages = [
  ...new Set([...(assistant.serverMessages || []), ...requiredServerMessages])
];

await vapi(`/assistant/${assistant.id}`, 'PATCH', { server, serverMessages });
console.log(`assistant ${assistant.name} -> ${server.url}`);
console.log(`server messages -> ${serverMessages.join(', ')}`);

for (const toolId of assistant.model?.toolIds || []) {
  const tool = await vapi(`/tool/${toolId}`);
  if (tool.type !== 'function') {
    continue; // Built-in Vapi tools (e.g. Google Calendar) have no server URL.
  }
  await vapi(`/tool/${toolId}`, 'PATCH', { server });
  console.log(`tool ${tool.function?.name} -> ${server.url}`);
}

console.log(server.headers ? 'Webhook secret header set on all of them.' : 'Tip: set VAPI_WEBHOOK_SECRET to lock down the webhook.');
