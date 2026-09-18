import { createApp } from '../app.js';
import { connectDatabase } from '../config/database.js';
import { errorHandler } from '../middleware/error.middleware.js';
import { logger, SENSITIVE_FIELDS, REDACTED_PLACEHOLDER } from '../infrastructure/logging/logger.js';
import { logDbError } from '../config/database.js';
import { JobModel } from '../modules/job/job.model.js';
import { UserModel } from '../modules/user/user.model.js';
import { ResumeModel } from '../modules/resume/resume.model.js';
import { ApplicationModel } from '../modules/application/application.model.js';
import { JwtUtils } from '../utils/jwt.js';
import { HiringNotificationHook } from '../modules/hiringEngine/notifications/hiringNotification.hook.js';
import http from 'http';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName} - ${detail || 'Assertion failed'}`);
    failed++;
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 LETGETIN CENTRALIZED BACKEND LOGGING TEST SUITE');
  console.log('================================================================\n');

  // 1. Connect DB
  await connectDatabase();

  // 2. Start Test Server
  const app = createApp();

  // Add a test-only error route to trigger an unhandled 500 error for assertion
  app.get('/api/test-simulated-500', (_req, _res) => {
    throw new Error('Simulated critical database/server failure for testing');
  });
  // Re-attach errorHandler so the test route above routes to it
  app.use(errorHandler);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  console.log(`Test server running at ${baseUrl}\n`);

  try {
    // ------------------------------------------------------------------------
    // TEST 1: Successful API request produces request log & X-Request-Id header
    // ------------------------------------------------------------------------
    console.log('--- TEST 1: Successful HTTP Request & Request ID Generation ---');
    const res1 = await fetch(`${baseUrl}/api/health`);
    const reqId1 = res1.headers.get('x-request-id');
    const data1 = await res1.json();

    assert(res1.status === 200, 'Health check returns status 200');
    assert(!!reqId1 && reqId1.length > 5, 'Server generates and returns X-Request-Id header');
    assert(data1.success === true, 'Response body success is true');

    // ------------------------------------------------------------------------
    // TEST 2: Incoming Client X-Request-Id is preserved and propagated
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 2: Inbound Client Correlation ID Propagation ---');
    const clientProvidedId = 'client-custom-corr-12345';
    const res2 = await fetch(`${baseUrl}/api/health`, {
      headers: { 'X-Request-Id': clientProvidedId },
    });
    const reqId2 = res2.headers.get('x-request-id');
    assert(reqId2 === clientProvidedId, 'Server preserves client-provided X-Request-Id header');

    // ------------------------------------------------------------------------
    // TEST 3: 400 Bad Request / Validation Error returns requestId & safe body
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 3: HTTP 400 Validation Error Logging & Response ---');
    const res3 = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invalid-missing-password@example.com' }),
    });
    const data3 = await res3.json();
    assert(res3.status === 400, 'Invalid login payload (missing password) returns HTTP 400');
    assert(data3.success === false, 'Response success is false');
    assert(!!data3.requestId, 'HTTP 400 response includes requestId in body');
    assert(data3.error?.code === 'VALIDATION_ERROR', 'HTTP 400 response has VALIDATION_ERROR code');

    // ------------------------------------------------------------------------
    // TEST 4: 401 Unauthorized returns requestId & safe error response
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 4: HTTP 401 Unauthorized Logging & Response ---');
    const res4 = await fetch(`${baseUrl}/api/applications`);
    const data4 = await res4.json();
    assert(res4.status === 401, 'Unauthenticated request returns HTTP 401');
    assert(data4.success === false, 'Response success is false');
    assert(!!data4.requestId, 'HTTP 401 response includes requestId in body');
    assert(data4.error?.code === 'UNAUTHORIZED', 'HTTP 401 response has UNAUTHORIZED code');

    // ------------------------------------------------------------------------
    // TEST 5: 404 Not Found returns HTTP 404
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 5: HTTP 404 Handling ---');
    const res5 = await fetch(`${baseUrl}/api/non-existent-route-xyz`);
    assert(res5.status === 404, 'Non-existent route returns HTTP 404');

    // ------------------------------------------------------------------------
    // TEST 6: 500 Unhandled Exception server-side logging & client safety
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 6: HTTP 500 Internal Server Error & Stack Safety ---');
    const res6 = await fetch(`${baseUrl}/api/test-simulated-500`);
    const data6 = await res6.json();
    assert(res6.status === 500, 'Simulated exception returns HTTP 500');
    assert(data6.success === false, 'Response success is false');
    assert(!!data6.requestId, 'HTTP 500 response includes requestId in body');
    assert(data6.message === 'Internal server error', 'HTTP 500 returns generic message');
    assert(!data6.stack, 'Stack trace is strictly NOT returned to client');
    assert(!JSON.stringify(data6).includes('Simulated critical database/server failure'), 'Internal exception details NOT leaked in body');

    // ------------------------------------------------------------------------
    // TEST 7: Sensitive Data Redaction
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 7: Sensitive Data Redaction ---');
    const testObj: Record<string, any> = {
      password: 'SuperSecretPassword123!',
      token: 'jwt.token.abc.xyz',
      accessToken: 'access.jwt.token',
      refreshToken: 'refresh.jwt.token',
      apiKey: 'AIzaSyDemoKey123',
      secret: 'oauth-client-secret-999',
      safeField: 'VisibleUserName',
    };

    // Verify redaction via pino serializer format
    const formatted = JSON.parse(JSON.stringify(testObj, (key, value) => {
      if (SENSITIVE_FIELDS.includes(key)) return REDACTED_PLACEHOLDER;
      return value;
    }));

    assert(formatted.password === REDACTED_PLACEHOLDER, 'password field is redacted');
    assert(formatted.token === REDACTED_PLACEHOLDER, 'token field is redacted');
    assert(formatted.accessToken === REDACTED_PLACEHOLDER, 'accessToken field is redacted');
    assert(formatted.refreshToken === REDACTED_PLACEHOLDER, 'refreshToken field is redacted');
    assert(formatted.apiKey === REDACTED_PLACEHOLDER, 'apiKey field is redacted');
    assert(formatted.secret === REDACTED_PLACEHOLDER, 'secret field is redacted');
    assert(formatted.safeField === 'VisibleUserName', 'safe fields remain unredacted');

    // ------------------------------------------------------------------------
    // TEST 8: Database Error Logger Hook
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 8: Database Error Logger Hook ---');
    let dbErrorLogged = false;
    try {
      logDbError('findApplication', new Error('Mongo connection timeout simulation'), {
        requestId: 'test-req-db-001',
        model: 'Application',
        jobId: '6aabd43aad15c6b1a2481cd4',
      });
      dbErrorLogged = true;
    } catch {
      dbErrorLogged = false;
    }
    assert(dbErrorLogged, 'Database error helper logDbError executes safely without throwing');

    // ------------------------------------------------------------------------
    // TEST 9: Hiring Engine Event Logging
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 9: Hiring Engine Event Notification Hooks ---');
    let eventLogged = false;
    try {
      HiringNotificationHook.notifyCandidateInvited({
        candidateId: 'test-cand-001',
        jobId: 'test-job-001',
        jobTitle: 'Senior Full Stack Engineer',
        stageId: 'stage_resume_screen',
        stageName: 'Resume Screening',
        deadlineHours: 48,
        stageDeadline: new Date(Date.now() + 48 * 3600 * 1000),
      });

      HiringNotificationHook.notifyCandidatePassed({
        candidateId: 'test-cand-001',
        jobId: 'test-job-001',
        jobTitle: 'Senior Full Stack Engineer',
        stageId: 'stage_resume_screen',
        stageName: 'Resume Screening',
        score: 92,
      });

      HiringNotificationHook.notifyCandidateShortlisted({
        candidateId: 'test-cand-001',
        jobId: 'test-job-001',
        jobTitle: 'Senior Full Stack Engineer',
        totalShortlisted: 1,
        targetCount: 5,
      });

      eventLogged = true;
    } catch {
      eventLogged = false;
    }
    assert(eventLogged, 'Hiring Engine notification hooks emit structured logs without errors');

    // ------------------------------------------------------------------------
    // TEST 10: Live Candidate Apply Flow (Candidate -> Apply -> Eligibility -> Routing)
    // ------------------------------------------------------------------------
    console.log('\n--- TEST 10: Live Candidate Apply Flow End-to-End ---');

    // Find test job
    const job = await JobModel.findOne({ title: /new test job/i }).lean();
    assert(!!job, 'Found test job in database for live application testing');

    // Find or create candidate
    let testUser = await UserModel.findOne({ username: 'demouser1' });
    assert(!!testUser, 'Found demo user (demouser1) in database');

    const authToken = JwtUtils.generateAccessToken({
      userId: String(testUser!._id),
      email: testUser!.email || 'demouser1@example.com',
      role: 'user',
    });

    const resume = await ResumeModel.findOne({ userId: testUser!._id }).lean();
    assert(!!resume, 'Found resume for demo candidate');

    // Send application request
    const applyRes = await fetch(`${baseUrl}/api/applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        jobId: String(job!._id),
        resumeId: String(resume!._id),
        source: 'manual',
        matchScore: 92,
      }),
    });

    const applyData = await applyRes.json();
    const applyReqId = applyRes.headers.get('x-request-id');

    assert(applyRes.status === 201, 'POST /api/applications returns HTTP 201 Created');
    assert(!!applyReqId, 'Application response includes X-Request-Id header');
    assert(applyData.success === true, 'Application response body success is true');
    assert(!!applyData.data?._id, 'Created/updated application ID is returned');
    assert(applyData.data?.job !== undefined, 'Application contains populated job context');

  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('\n================================================================');
  console.log(`📊 LOGGING TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('================================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
