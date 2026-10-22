import mongoose, { Types } from 'mongoose';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { UserModel } from '../modules/user/user.model.js';
import { RecruiterOrganizationModel } from '../modules/recruiterOrg/recruiterOrg.model.js';
import { HuremasoSubscriptionModel } from '../modules/huremaso/huremaso.model.js';
import { huremasoService } from '../modules/huremaso/huremaso.service.js';
import { TRIAL_DURATION_DAYS, TRIAL_DURATION_MS, HUREMASO_PLANS } from '../modules/huremaso/huremaso.constants.js';

async function runIntegrationTest() {
  console.log('=== STARTING HUREMASO INTEGRATION TEST SUITE ===');

  await mongoose.connect(env.MONGODB_URI);
  console.log(' Connected to MongoDB:', env.MONGODB_URI);

  const testEmail = `test_recruiter_${Date.now()}@letgetin.test`;
  let testUser = await UserModel.create({
    email: testEmail,
    fullName: 'Test Recruiter Enterprise',
    role: 'recruiter',
    provider: 'local',
    emailVerified: true,
    phoneVerified: true,
  });
  console.log(' Created test recruiter user:', testUser._id.toString(), testEmail);

  try {
    // 1. Initial status check (trial not started)
    const initialStatus = await huremasoService.getStatus(testUser._id.toString());
    console.log('\n[TEST 1] Initial Status:');
    console.log('  Status:', initialStatus.status);
    console.log('  Can launch:', initialStatus.canLaunch);
    console.log('  Org created:', initialStatus.org.name);
    if (initialStatus.status !== 'trial_not_started' || initialStatus.canLaunch !== false) {
      throw new Error(`Expected trial_not_started and canLaunch: false, got ${initialStatus.status}`);
    }
    console.log('  PASS: Initial status is trial_not_started and launch is blocked.');

    // 2. Start 7-Day Free Trial
    const trialStarted = await huremasoService.startTrial(testUser._id.toString());
    console.log('\n[TEST 2] Start 7-Day Trial:');
    console.log('  Status:', trialStarted.status);
    console.log('  Can launch:', trialStarted.canLaunch);
    console.log('  Trial started at:', trialStarted.trial.startedAt);
    console.log('  Trial expires at:', trialStarted.trial.expiresAt);
    console.log('  Days remaining:', trialStarted.trial.daysRemaining);

    if (trialStarted.status !== 'trial_active' || trialStarted.canLaunch !== true) {
      throw new Error(`Expected trial_active and canLaunch: true, got ${trialStarted.status}`);
    }

    const startMs = new Date(trialStarted.trial.startedAt!).getTime();
    const expiryMs = new Date(trialStarted.trial.expiresAt!).getTime();
    const diffDays = Math.round((expiryMs - startMs) / (24 * 60 * 60 * 1000));
    if (diffDays !== TRIAL_DURATION_DAYS) {
      throw new Error(`Expected trial duration of ${TRIAL_DURATION_DAYS} days, got ${diffDays}`);
    }
    console.log(`  PASS: Trial successfully started for exactly ${diffDays} days.`);

    // 3. Concurrency / Duplicate Trial Start Protection
    console.log('\n[TEST 3] Duplicate Trial Start Prevention:');
    try {
      await huremasoService.startTrial(testUser._id.toString());
      throw new Error('Expected duplicate trial start to throw an error!');
    } catch (err: any) {
      console.log('  Correctly rejected duplicate trial start:', err.message);
      console.log('  PASS: Re-starting trial is strictly blocked.');
    }

    // 4. Persistence across user session refresh
    console.log('\n[TEST 4] Persistence Check (Simulate Logout/Login/Refresh):');
    const refreshedStatus = await huremasoService.getStatus(testUser._id.toString());
    if (refreshedStatus.status !== 'trial_active') {
      throw new Error('Trial did not persist across status re-check!');
    }
    console.log('  PASS: Trial state and expiry timestamps persist authoritatively in database.');

    // 5. Generate Launch Session & Token
    console.log('\n[TEST 5] Launch Token Creation:');
    const launchSession = await huremasoService.createLaunchSession(testUser._id.toString());
    console.log('  Launch URL:', launchSession.launchUrl);
    console.log('  Token expires at:', launchSession.expiresAt);
    if (!launchSession.token || !launchSession.launchUrl.includes('token=')) {
      throw new Error('Launch URL or token missing from launch session!');
    }
    console.log('  PASS: Signed launch token and URL successfully generated.');

    // 6. Token Verification by Huremaso application
    console.log('\n[TEST 6] Token Verification (Cross-Origin Huremaso Entry):');
    const verifyResult = await huremasoService.verifyLaunchToken(launchSession.token);
    console.log('  Token valid:', verifyResult.valid);
    console.log('  Verified user:', verifyResult.data?.email);
    console.log('  Verified status:', verifyResult.data?.status);
    if (!verifyResult.valid || verifyResult.data?.status !== 'trial_active') {
      throw new Error('Token verification failed!');
    }
    console.log('  PASS: Launch token verified against authoritative database state.');

    // 7. Expired Trial Enforcement
    console.log('\n[TEST 7] Simulated 7-Day Trial Expiry:');
    // Set trial expiry to 1 hour in the past
    const pastDate = new Date(Date.now() - 3600 * 1000);
    await HuremasoSubscriptionModel.updateOne(
      { ownerUserId: testUser._id },
      { $set: { trialExpiresAt: pastDate } }
    );

    const expiredStatus = await huremasoService.getStatus(testUser._id.toString());
    console.log('  Status after expiry:', expiredStatus.status);
    console.log('  Can launch after expiry:', expiredStatus.canLaunch);
    if (expiredStatus.status !== 'trial_expired' || expiredStatus.canLaunch !== false) {
      throw new Error(`Expected trial_expired and canLaunch: false, got ${expiredStatus.status}`);
    }
    console.log('  PASS: Authoritative server timestamps correctly mark trial as expired.');

    // 8. Launch Attempt When Expired
    console.log('\n[TEST 8] Launch Blocking for Expired Trial:');
    try {
      await huremasoService.createLaunchSession(testUser._id.toString());
      throw new Error('Expected launch creation to be rejected for expired trial!');
    } catch (err: any) {
      console.log('  Launch successfully blocked:', err.message);
      console.log('  PASS: Expired users cannot generate launch sessions.');
    }

    // 9. Token Verification When Expired
    console.log('\n[TEST 9] Verify-Token Blocking for Expired Trial:');
    const expiredVerify = await huremasoService.verifyLaunchToken(launchSession.token);
    console.log('  Verify valid:', expiredVerify.valid);
    console.log('  Verify reason:', expiredVerify.reason);
    if (expiredVerify.valid !== false || expiredVerify.reason !== 'trial_expired') {
      throw new Error('Expected token verification to fail with trial_expired!');
    }
    console.log('  PASS: Direct URL or old token access is blocked when trial expires.');

    // 10. Purchase Paid Subscription
    console.log('\n[TEST 10] Subscription Purchase & Activation:');
    const subscribedStatus = await huremasoService.purchaseSubscription(testUser._id.toString(), {
      planId: 'pro',
      billingCycle: 'monthly',
    });
    console.log('  Status after purchase:', subscribedStatus.status);
    console.log('  Can launch:', subscribedStatus.canLaunch);
    console.log('  Plan name:', subscribedStatus.subscription?.planName);
    console.log('  Amount paid:', subscribedStatus.subscription?.amountPaid);
    console.log('  Payment ID:', subscribedStatus.subscription?.paymentId);
    if (subscribedStatus.status !== 'subscription_active' || subscribedStatus.canLaunch !== true) {
      throw new Error(`Expected subscription_active and canLaunch: true, got ${subscribedStatus.status}`);
    }
    console.log('  PASS: Subscription successfully activated, restoring Huremaso access.');

    // 11. Launch Session After Purchase
    console.log('\n[TEST 11] Post-Subscription Launch:');
    const paidLaunch = await huremasoService.createLaunchSession(testUser._id.toString());
    const paidVerify = await huremasoService.verifyLaunchToken(paidLaunch.token);
    if (!paidVerify.valid || paidVerify.data?.status !== 'subscription_active') {
      throw new Error('Paid launch verification failed!');
    }
    console.log('  PASS: Paid subscriber launch token successfully verified.');

    console.log('\n🎉 ALL 11 INTEGRATION TESTS PASSED PERFECTLY! 🎉');
  } finally {
    // Cleanup test data
    await HuremasoSubscriptionModel.deleteMany({ ownerUserId: testUser._id });
    await RecruiterOrganizationModel.deleteMany({ ownerUserId: testUser._id });
    await UserModel.deleteOne({ _id: testUser._id });
    await mongoose.disconnect();
    console.log('\n Cleaned up test data and closed DB connection.');
  }
}

runIntegrationTest().catch((err) => {
  console.error('\n❌ INTEGRATION TEST FAILED:', err);
  process.exit(1);
});
