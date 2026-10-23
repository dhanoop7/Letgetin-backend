import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import { recruiterCreditsService } from '../modules/recruiterCredits/recruiterCredits.service.js';
import { AuthService } from '../modules/auth/auth.service.js';
import { RecruiterOrgService } from '../modules/recruiterOrg/recruiterOrg.service.js';
import { RecruiterCreditsModel, PaymentOrderModel } from '../modules/recruiterCredits/recruiterCredits.model.js';

const ADMIN_API = 'http://localhost:5000/api';

async function runKillSwitchValidation() {
  console.log('================================================================');
  console.log('🛡️ GLOBAL PAYMENT & CREDITS KILL SWITCH AUTHORITATIVE TEST SUITE');
  console.log('================================================================\n');

  await connectDatabase();

  const authService = new AuthService();
  const recruiterOrgService = new RecruiterOrgService();

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, title: string, meta?: any) {
    total++;
    if (condition) {
      console.log(`  ✅ [PASS] ${title}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${title}`, meta || '');
      throw new Error(`Assertion failed: ${title}`);
    }
  }

  const createdUserIds: string[] = [];

  try {
    // -------------------------------------------------------------
    // STEP 1: AUTHENTICATE USERS
    // -------------------------------------------------------------
    console.log('--- Step 1: Authenticate Super Admin and Regular Admin ---');

    // Super Admin login
    const saLoginRes = await fetch(`${ADMIN_API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'labeeb.eee', password: 'SuperAdmin@123' }),
    });
    const saLoginJson: any = await saLoginRes.json();
    assert(saLoginJson.token, 'Super Admin authenticated successfully');
    const superAdminToken = saLoginJson.token;

    // Regular Admin login
    const adminLoginRes = await fetch(`${ADMIN_API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'sarah.mitchell', password: 'Admin@123' }),
    });
    const adminLoginJson: any = await adminLoginRes.json();
    assert(adminLoginJson.token, 'Regular Admin authenticated successfully');
    const adminToken = adminLoginJson.token;

    // -------------------------------------------------------------
    // STEP 2: AUTHORIZATION BOUNDARY ENFORCEMENT
    // -------------------------------------------------------------
    console.log('\n--- Step 2: Authorization Checks (Super Admin Only) ---');

    // Anonymous toggle attempt
    const anonRes = await fetch(`${ADMIN_API}/credits/pricing/toggle-payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false, reason: 'Unauthorized test' }),
    });
    assert(anonRes.status === 401, 'Anonymous toggle request rejected with HTTP 401 Unauthorized');

    // Regular Admin toggle attempt
    const adminAttemptRes = await fetch(`${ADMIN_API}/credits/pricing/toggle-payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ enabled: false, reason: 'Regular Admin unauthorized attempt' }),
    });
    const adminAttemptText = await adminAttemptRes.text();
    console.log('Admin Attempt status:', adminAttemptRes.status, 'body:', adminAttemptText);
    assert(adminAttemptRes.status === 403, 'Regular Admin toggle request rejected with HTTP 403 Forbidden', { status: adminAttemptRes.status, body: adminAttemptText });

    // -------------------------------------------------------------
    // STEP 3: CREATE TEST USERS FOR ALL 4 ACCOUNT TYPES
    // -------------------------------------------------------------
    console.log('\n--- Step 3: Setup Test Accounts Across All 4 Categories ---');

    const testAccounts = [
      { role: 'user', entityType: undefined, label: 'Candidate' },
      { role: 'recruiter', entityType: 'company', label: 'Company' },
      { role: 'recruiter', entityType: 'startup', label: 'Startup' },
      { role: 'recruiter', entityType: 'institution', label: 'Institution' },
    ];

    const userMap: Record<string, any> = {};

    for (const acc of testAccounts) {
      const email = `killswitch_test_${acc.label.toLowerCase()}_${Date.now()}@letgetin.com`;
      const username = `u_ks_${acc.label.toLowerCase()}_${Date.now()}`;
      const password = 'Password@123';
      const otpCode = '123456';

      await authService.sendEmailOtp(email);
      const reg = await authService.verifyEmailOtpAndCreateUser({
        email,
        username,
        password,
        confirmPassword: password,
        otp: otpCode,
        role: acc.role as any,
        entityType: acc.entityType as any,
      });

      const userId = (reg.user as any)._id?.toString() || (reg.user as any).id;
      createdUserIds.push(userId);

      // Check initial 20 welcome credits
      const wallet = await recruiterCreditsService.getUserWallet(userId, acc.role);
      assert(wallet.balance === 20, `${acc.label} received initial 20 welcome credits`);
      userMap[acc.label] = { userId, role: acc.role, initialBalance: wallet.balance };
    }

    // -------------------------------------------------------------
    // STEP 4: SUPER ADMIN DISABLES PAYMENTS & CREDITS
    // -------------------------------------------------------------
    console.log('\n--- Step 4: Super Admin Disables Payments & Credits Platform-Wide ---');

    const disableRes = await fetch(`${ADMIN_API}/credits/pricing/toggle-payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({
        enabled: false,
        reason: 'Scheduled System Upgrade & Security Maintenance',
      }),
    });

    const disableJson: any = await disableRes.json();
    assert(disableRes.status === 200, 'Super Admin toggle request succeeded with HTTP 200');
    assert(disableJson.data.paymentsCreditsEnabled === false, 'paymentsCreditsEnabled returned false');
    assert(disableJson.data.paymentsCreditsDisabledReason === 'Scheduled System Upgrade & Security Maintenance', 'Reason accurately persisted');

    // Verify zero-staleness cross-service check
    const isEnabled = await recruiterCreditsService.isPaymentsCreditsEnabled();
    assert(isEnabled.enabled === false, 'recruiterCreditsService.isPaymentsCreditsEnabled() is false');

    // -------------------------------------------------------------
    // STEP 5: ENFORCEMENT ACROSS ALL 4 CATEGORIES (BLOCKING NEW OPERATIONS)
    // -------------------------------------------------------------
    console.log('\n--- Step 5: Backend Enforcement Across All 4 Account Categories ---');

    for (const acc of testAccounts) {
      const u = userMap[acc.label];

      // A. Verify getUserWallet reflects disabled state
      const wallet = await recruiterCreditsService.getUserWallet(u.userId, u.role);
      assert(wallet.paymentsCreditsEnabled === false, `${acc.label} wallet reflects paymentsCreditsEnabled === false`);
      assert(wallet.balance === u.initialBalance, `${acc.label} wallet balance intact (20 credits) while disabled`);

      // B. Attempt new credit purchase / checkout session -> MUST REJECT
      let orderBlocked = false;
      try {
        await recruiterCreditsService.createPaymentOrder(u.userId, {
          purchaseType: 'credits',
          itemKey: 'pack_standard',
        });
      } catch (err: any) {
        if (err.statusCode === 403 && (err.code === 'PAYMENTS_CREDITS_DISABLED' || err.message?.includes('temporarily disabled'))) {
          orderBlocked = true;
        }
      }
      assert(orderBlocked, `${acc.label} credit purchase rejected with 403 PAYMENTS_CREDITS_DISABLED`);

      // C. Attempt credit-consuming operation -> MUST REJECT
      let deductBlocked = false;
      try {
        await recruiterCreditsService.deduct(
          u.userId,
          5,
          'Attempted resume builder deduction while kill switch active',
          'candidate_resume'
        );
      } catch (err: any) {
        if (err.statusCode === 403 && (err.code === 'PAYMENTS_CREDITS_DISABLED' || err.message?.includes('temporarily disabled'))) {
          deductBlocked = true;
        }
      }
      assert(deductBlocked, `${acc.label} credit deduction rejected with 403 PAYMENTS_CREDITS_DISABLED`);
    }

    // -------------------------------------------------------------
    // STEP 6: VERIFY BALANCES & DATA INTEGRITY REMAIN 100% INTACT
    // -------------------------------------------------------------
    console.log('\n--- Step 6: Verify Balances and Existing Data are Preserved ---');

    for (const acc of testAccounts) {
      const u = userMap[acc.label];
      const creditsRecord = await RecruiterCreditsModel.findOne({ userId: u.userId });
      assert(creditsRecord?.balance === 20, `${acc.label} database credit balance unaltered at 20`);
      assert(creditsRecord?.promotionalGranted === true, `${acc.label} promotional grant flag intact`);
    }

    // -------------------------------------------------------------
    // STEP 7: RE-ENABLE PAYMENTS & CREDITS
    // -------------------------------------------------------------
    console.log('\n--- Step 7: Super Admin Re-Enables Payments & Credits ---');

    const enableRes = await fetch(`${ADMIN_API}/credits/pricing/toggle-payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({
        enabled: true,
        reason: 'Maintenance Completed successfully',
      }),
    });

    const enableJson: any = await enableRes.json();
    assert(enableRes.status === 200, 'Super Admin re-enable request succeeded with HTTP 200');
    assert(enableJson.data.paymentsCreditsEnabled === true, 'paymentsCreditsEnabled returned true');

    const isEnabledAfter = await recruiterCreditsService.isPaymentsCreditsEnabled();
    assert(isEnabledAfter.enabled === true, 'recruiterCreditsService.isPaymentsCreditsEnabled() restored to true');

    // -------------------------------------------------------------
    // STEP 8: RESTORED BEHAVIOR OPERATIONAL VALIDATION
    // -------------------------------------------------------------
    console.log('\n--- Step 8: Restored Operations Operational Validation ---');

    const cand = userMap['Candidate'];

    // Now deduction succeeds
    const deductResult = await recruiterCreditsService.deduct(
      cand.userId,
      5,
      'Resume builder authorized after kill switch disabled',
      'candidate_resume'
    );
    assert(deductResult.balance === 15, 'Credit deduction succeeds when enabled (20 - 5 = 15 credits)');

    // Now order creation succeeds
    const orderResult = await recruiterCreditsService.createPaymentOrder(cand.userId, {
      purchaseType: 'credits',
      itemKey: 'pack_20',
    });
    assert(Boolean(orderResult.orderId), 'Payment checkout order creation succeeds when enabled');

    // Clean up created test order
    await PaymentOrderModel.deleteOne({ orderId: orderResult.orderId });

    // -------------------------------------------------------------
    // STEP 9: AUDIT TRAIL VERIFICATION
    // -------------------------------------------------------------
    console.log('\n--- Step 9: Audit Trail Verification ---');

    const db = mongoose.connection.db;
    assert(Boolean(db), 'Database connection initialized');
    if (!db) {
      throw new Error('Database connection is not initialized');
    }

    const pricingDoc: any = await db
      .collection('creditpricingconfigs')
      .findOne({ key: 'default' });

    assert(Boolean(pricingDoc), 'Credit pricing config document exists');
    assert(Array.isArray(pricingDoc?.auditLog), 'Audit log exists in CreditPricingConfig');

    const auditLog: any[] = Array.isArray(pricingDoc?.auditLog) ? pricingDoc.auditLog : [];

    const disableAudit = auditLog.find(
      (entry: any) => entry.itemKey === 'paymentsCreditsEnabled' && entry.newValue === false
    );
    assert(Boolean(disableAudit), 'Found paymentsCreditsEnabled false entry in audit trail');
    assert(disableAudit?.adminRole === 'Super Admin', 'Audit records actor role as Super Admin');
    assert(Boolean(disableAudit?.reason?.includes('Scheduled System Upgrade')), 'Audit records disable reason');

    const enableAudit = auditLog.find(
      (entry: any) => entry.itemKey === 'paymentsCreditsEnabled' && entry.newValue === true
    );
    assert(Boolean(enableAudit), 'Found paymentsCreditsEnabled true entry in audit trail');
    assert(Boolean(enableAudit?.reason?.includes('Maintenance Completed')), 'Audit records enable reason');

    console.log('\n================================================================');
    console.log(`🎉 ALL TESTS PASSED: ${passed}/${total} assertions successful!`);
    console.log('================================================================\n');
  } finally {
    // Clean up created test accounts
    if (createdUserIds.length > 0 && mongoose.connection.db) {
      await mongoose.connection.db.collection('users').deleteMany({
        _id: { $in: createdUserIds.map((id) => new mongoose.Types.ObjectId(id)) },
      });
      await RecruiterCreditsModel.deleteMany({ userId: { $in: createdUserIds } });
    }
    await mongoose.disconnect();
  }
}

runKillSwitchValidation().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
