import { ZulipMessaging } from '../src/lib/messaging/zulip.ts';

interface MockRequest {
  path: string;
  method: string;
  contentType: string | null;
  params: Record<string, string>;
}

async function runVerification() {
  console.log('🚀 Starting Zulip Transport Verification...');

  let lastRequest: MockRequest | null = null;

  // 1. Setup Mock Zulip Server
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const contentType = req.headers.get('content-type');
      const bodyText = await req.text();
      const params = new URLSearchParams(bodyText);

      lastRequest = {
        path: url.pathname,
        method: req.method,
        contentType,
        params: Object.fromEntries(params.entries()),
      };

      return Response.json({ result: 'success' });
    },
  });

  const mockSite = `http://localhost:${server.port}`;
  console.log(`📡 Mock Zulip Server listening at ${mockSite}`);

  try {
    const messaging = new ZulipMessaging({
      site: mockSite,
      username: 'bot@example.com',
      apiKey: 'secret-key',
      defaultStream: 'general',
    });

    // 2. Test sendMessage
    console.log('\n--- Testing sendMessage ---');
    await messaging.sendMessage('general:test-topic', 'Hello World');

    const req1 = lastRequest as unknown as MockRequest;
    if (!req1) throw new Error('No request captured for sendMessage');

    console.log('Request Method:', req1.method);
    console.log('Content-Type:', req1.contentType);
    console.log('Params:', JSON.stringify(req1.params, null, 2));

    if (req1.contentType !== 'application/x-www-form-urlencoded') {
      throw new Error(`Invalid Content-Type: ${req1.contentType}`);
    }
    if (req1.params.content !== 'Hello World') {
      throw new Error(`Missing or invalid content: ${req1.params.content}`);
    }
    console.log('✅ sendMessage serialization OK');

    // 3. Test addReaction
    console.log('\n--- Testing addReaction ---');
    // Reset lastRequest to ensure we catch the new one
    lastRequest = null;
    await messaging.addReaction('general:test-topic', '12345', 'working');

    const req2 = lastRequest as unknown as MockRequest;
    if (!req2) throw new Error('No request captured for addReaction');

    console.log('Request Path:', req2.path);
    console.log('Params:', JSON.stringify(req2.params, null, 2));

    if (req2.path !== '/api/v1/messages/12345/reactions') {
      throw new Error(`Invalid reaction path: ${req2.path}`);
    }
    if (req2.params.emoji_name !== 'gear') {
      throw new Error(`Invalid emoji_name: ${req2.params.emoji_name}`);
    }
    console.log('✅ addReaction serialization OK');

    console.log('\n🎉 All Transport Tests Passed!');
  } catch (err: unknown) {
    console.error('\n❌ Verification Failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    server.stop();
  }
}

runVerification();
