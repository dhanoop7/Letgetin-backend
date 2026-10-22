import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import { AuthService } from '../modules/auth/auth.service.js';
import { OtpService } from '../modules/auth/services/otp.service.js';
import { recruiterCreditsService } from '../modules/recruiterCredits/recruiterCredits.service.js';
import { RecruiterOrgService } from '../modules/recruiterOrg/recruiterOrg.service.js';
import {
  RecruiterCreditsModel,
  CreditTransactionModel,
  PaymentOrderModel,
  UserSubscriptionModel,
} from '../modules/recruiterCredits/recruiterCredits.model.js';
import { UserModel } from '../modules/user/user.model.js';
import { RecruiterOrganizationModel } from '../modules/recruiterOrg/recruiterOrg.model.js';
import { INITIAL_PROMOTIONAL_CREDITS, CREDIT_VALUE_INR } from '../config/pricing.config.js';

async function runCreditEnforcementSuite() {
  console.log('====================================================');
  console.log('🛡️ LETGETIN CREDIT ACCESS & SECURITY VALIDATION SUITE');
  console.log('====================================================\n');

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
  const createdOrgIds: string[] = [];

  try {
    // -------------------------------------------------------------
    // SCENARIO 1: Initial Signup Credits for All 4 Account Types
    // -------------------------------------------------------------
    console.log('--- Scenario 1: Initial 20 Promotional Credits on Registration ---');

    const accounts = [
      { role: 'user', entityType: undefined, label: 'Candidate' },
      { role: 'recruiter', entityType: 'company', label: 'Company' },
      { role: 'recruiter', entityType: 'startup', label: 'Startup' },
      { role: 'recruiter', entityType: 'institution', label: 'Institution' },
    ];

    const accountWallets: Record<string, any> = {};

    for (const acc of accounts) {
      const email = `test_${acc.label.toLowerCase()}_${Date.now()}@letgetin.com`;
      const username = `u_${acc.label.toLowerCase()}_${Date.now()}`;
      const password = 'Password@123';
      const otpCode = '123456';

      // Send Email OTP (generates 123456 in dev)
      await authService.sendEmailOtp(email);

      // Register new user
      const registerRes = await authService.verifyEmailOtpAndCreateUser({
        email,
        username,
        password,
        confirmPassword: password,
        otp: otpCode,
        role: acc.role as any,
        entityType: acc.entityType as any,
      });

      const userId = registerRes.user._id!.toString();
      createdUserIds.push(userId);

      // Check wallet balance
      const wallet = await recruiterCreditsService.getUserWallet(userId, acc.role);
      accountWallets[acc.label] = { userId, wallet, email, password };

      assert(
        wallet.balance === INITIAL_PROMOTIONAL_CREDITS,
        `${acc.label} successfully awarded exactly ${INITIAL_PROMOTIONAL_CREDITS} promotional credits upon account registration`,
        { balance: wallet.balance }
      );

      // Check transaction ledger
      const grantTx = wallet.transactions.find((t: any) => t.type === 'grant' && t.feature === 'promotional_welcome');
      assert(
        Boolean(grantTx && grantTx.amount === 20 && grantTx.balanceAfter === 20),
        `${acc.label} promotional grant properly recorded in transaction ledger`,
        grantTx
      );
    }

    // -------------------------------------------------------------
    // SCENARIO 2: Repeated Login & Repeated Bonus Protection
    // -------------------------------------------------------------
    console.log('\n--- Scenario 2: Prevention of Duplicate Credits on Login & Retries ---');

    const cand = accountWallets['Candidate'];

    // 1. Repeated Login
    for (let i = 1; i <= 3; i++) {
      await authService.login({
        email: cand.email,
        password: cand.password,
      });
    }

    const candWalletAfterLogins = await recruiterCreditsService.getUserWallet(cand.userId, 'user');
    assert(
      candWalletAfterLogins.balance === 20,
      'Repeated logins do NOT award additional promotional credits (balance remains 20)',
      candWalletAfterLogins.balance
    );

    // 2. Direct repeated getOrCreateCredits calls
    await recruiterCreditsService.getOrCreateCredits({ userId: cand.userId });
    await recruiterCreditsService.getOrCreateCredits({ userId: cand.userId });

    const candWalletAfterRetry = await recruiterCreditsService.getUserWallet(cand.userId, 'user');
    assert(
      candWalletAfterRetry.balance === 20,
      'Repeated getOrCreateCredits calls do NOT duplicate credits (balance remains 20)',
      candWalletAfterRetry.balance
    );

    const candGrants = await CreditTransactionModel.find({ userId: cand.userId, type: 'grant' });
    assert(
      candGrants.length === 1,
      'Ledger contains strictly 1 promotional grant transaction for the account',
      candGrants.length
    );

    // 3. Organization Setup Linking (Company)
    const comp = accountWallets['Company'];
    const compOrg = await recruiterOrgService.saveOrgProfile(comp.userId, {
      entity: 'company',
      name: 'Acme Corp Technologies',
      industry: 'Software',
      website: 'https://acme-test.example.com',
    } as any);
    createdOrgIds.push(compOrg._id.toString());

    // Check company wallet after org profile setup
    const compWalletAfterOrg = await recruiterCreditsService.getUserWallet(comp.userId, 'recruiter');
    assert(
      compWalletAfterOrg.balance === 20,
      'Setting up an organization profile unifies wallet and does NOT duplicate promotional bonus (balance remains 20)',
      compWalletAfterOrg.balance
    );

    const compGrants = await CreditTransactionModel.find({
      $or: [{ userId: comp.userId }, { orgId: compOrg._id }],
      type: 'grant',
    });
    assert(
      compGrants.length === 1,
      'Company ledger contains strictly 1 promotional grant across user and organization',
      compGrants.length
    );

    // -------------------------------------------------------------
    // SCENARIO 3: Premium Feature Deduction With Sufficient Balance
    // -------------------------------------------------------------
    console.log('\n--- Scenario 3: Premium Feature Use with Initial Credits ---');

    // Candidate has 20 credits. Mockup Interview costs 20 credits.
    const interviewCharge = await recruiterCreditsService.chargeForFeature(
      cand.userId,
      'mockup_interview',
      20,
      undefined,
      'Mockup Interview Practice'
    );

    assert(
      interviewCharge.balance === 0 && interviewCharge.cost === 20,
      'Mockup Interview successfully charged 20 credits (Balance: 20 -> 0)',
      interviewCharge
    );

    const candWalletAfterInterview = await recruiterCreditsService.getUserWallet(cand.userId, 'user');
    assert(
      candWalletAfterInterview.balance === 0,
      'Candidate wallet balance is now 0 credits',
      candWalletAfterInterview.balance
    );

    // Check spend ledger
    const candSpendTx = await CreditTransactionModel.findOne({
      userId: cand.userId,
      type: 'spend',
      feature: 'mockup_interview',
    });
    assert(
      Boolean(candSpendTx && candSpendTx.amount === 20 && candSpendTx.balanceAfter === 0),
      'Spend transaction properly recorded in audit ledger',
      candSpendTx
    );

    // -------------------------------------------------------------
    // SCENARIO 4: Insufficient Balance Blocking & 402 Payment Required
    // -------------------------------------------------------------
    console.log('\n--- Scenario 4: Insufficient Balance Enforcement (402 Error) ---');

    // Candidate now has 0 credits. Try to use ATS Resume (30 credits)
    let caughtInsufficientErr: any = null;
    try {
      await recruiterCreditsService.chargeForFeature(cand.userId, 'ats_resume');
    } catch (err: any) {
      caughtInsufficientErr = err;
    }

    assert(caughtInsufficientErr !== null, 'Premium action blocked when credits are exhausted');
    assert(
      caughtInsufficientErr?.statusCode === 402,
      'HTTP status code is strictly 402 Payment Required',
      caughtInsufficientErr?.statusCode
    );
    assert(
      caughtInsufficientErr?.code === 'INSUFFICIENT_CREDITS',
      'Error code is strictly INSUFFICIENT_CREDITS',
      caughtInsufficientErr?.code
    );
    assert(
      caughtInsufficientErr?.details?.shortfall === 30,
      'Calculates exact shortfall of 30 credits needed for purchase',
      caughtInsufficientErr?.details
    );

    // -------------------------------------------------------------
    // SCENARIO 5: Block Unintended / Simulated Credit Purchasing Bypass
    // -------------------------------------------------------------
    console.log('\n--- Scenario 5: Restrict Unverified & Simulated Purchasing Bypasses ---');

    // 1. Direct unverified purchase bypass endpoint blocked
    let directPurchaseErr: any = null;
    try {
      await recruiterCreditsService.purchase(cand.userId, 'pack_500');
    } catch (err: any) {
      directPurchaseErr = err;
    }
    assert(
      directPurchaseErr !== null && directPurchaseErr.statusCode === 400,
      'Direct legacy purchase bypass (/purchase) is strictly blocked (400 Bad Request)',
      directPurchaseErr?.message
    );

    // 2. Client tampering with customCredits: 0 in chargeForFeature
    let zeroCostBypassCharge: any = null;
    try {
      zeroCostBypassCharge = await recruiterCreditsService.chargeForFeature(
        cand.userId,
        'ats_resume',
        0 // Trying to pass 0 custom credits to bypass deduction
      );
    } catch (err: any) {
      // Should reject because ats_resume requires 30 credits and balance is 0
      zeroCostBypassCharge = err;
    }
    assert(
      zeroCostBypassCharge instanceof Error && (zeroCostBypassCharge as any).statusCode === 402,
      'Client cannot zero out feature cost by passing customCredits: 0 (server enforces 30 cr)',
      zeroCostBypassCharge?.message
    );

    // 3. Simulated paymentId bypass in verifyPayment
    const dummyOrder = await recruiterCreditsService.createPaymentOrder(cand.userId, {
      purchaseType: 'credits',
      itemKey: 'pack_50',
    });

    // Verify order creation does NOT grant credits
    const candWalletAfterOrderCreation = await recruiterCreditsService.getUserWallet(cand.userId, 'user');
    assert(
      candWalletAfterOrderCreation.balance === 0,
      'Visiting/creating a payment order does NOT grant credits to wallet (balance remains 0)',
      candWalletAfterOrderCreation.balance
    );

    // 4. Inactive payments rejection when PAYMENTS_ENABLED is not set
    delete process.env.ENABLE_TEST_PAYMENTS;
    delete process.env.PAYMENTS_ENABLED;
    let inactivePaymentErr: any = null;
    try {
      await recruiterCreditsService.verifyPayment(cand.userId, {
        orderId: dummyOrder.orderId,
        paymentId: `pay_unverified_${Date.now()}`,
      });
    } catch (err: any) {
      inactivePaymentErr = err;
    }
    assert(
      inactivePaymentErr !== null && inactivePaymentErr.statusCode === 400,
      'Payment verification is strictly blocked when payment functionality is inactive',
      inactivePaymentErr?.message
    );

    // 5. Simulated payment IDs (sim_*) are strictly rejected
    let simPaymentErr: any = null;
    try {
      await recruiterCreditsService.verifyPayment(cand.userId, {
        orderId: dummyOrder.orderId,
        paymentId: `sim_${Date.now()}`,
      });
    } catch (err: any) {
      simPaymentErr = err;
    }
    assert(
      simPaymentErr !== null && simPaymentErr.statusCode === 400,
      'Simulated payment IDs (sim_*) are strictly rejected without crediting',
      simPaymentErr?.message
    );

    // Verify order was NOT credited and balance is STILL 0
    const candWalletAfterSim = await recruiterCreditsService.getUserWallet(cand.userId, 'user');
    assert(
      candWalletAfterSim.balance === 0,
      'Candidate balance remained 0 after rejected simulated payment',
      candWalletAfterSim.balance
    );

    // 6. Custom credits validation (must be between 1 and 10000)
    let invalidCustomOrderErr: any = null;
    try {
      await recruiterCreditsService.createPaymentOrder(cand.userId, {
        purchaseType: 'credits',
        itemKey: 'custom',
        customCredits: -50,
      });
    } catch (err: any) {
      invalidCustomOrderErr = err;
    }
    assert(
      invalidCustomOrderErr !== null && invalidCustomOrderErr.statusCode === 400,
      'Negative or zero custom credit orders are rejected',
      invalidCustomOrderErr?.message
    );

    // 7. Verify legitimate Admin credit adjustments still work
    const adminAdjustRes = await recruiterCreditsService.adjustCredits(
      cand.userId,
      15,
      'Admin Promotional Grant'
    );
    assert(
      adminAdjustRes.balance === 15,
      'Admin authorized credit adjustment succeeds (balance: 0 -> 15)',
      adminAdjustRes.balance
    );
    // Deduct the 15 back to keep clean state
    await recruiterCreditsService.deduct(cand.userId, 15, 'Reset Admin Adjustment', 'test_reset');

    // -------------------------------------------------------------
    // SCENARIO 6: Legitimate Verified Payment Flow (When Enabled)
    // -------------------------------------------------------------
    console.log('\n--- Scenario 6: Legitimate Verified Payment & Top-Up ---');
    process.env.ENABLE_TEST_PAYMENTS = 'true';

    // Create authentic order for 50 credits (₹500)
    const validOrder = await recruiterCreditsService.createPaymentOrder(cand.userId, {
      purchaseType: 'credits',
      itemKey: 'pack_50',
    });

    assert(
      validOrder.credits === 50 && validOrder.amountInr === 500,
      'Payment order created for 50 credits at strict 1 credit = ₹10 (₹500)',
      validOrder
    );

    // Verify payment using legitimate verification signature
    const verifiedPayment = await recruiterCreditsService.verifyPayment(cand.userId, {
      orderId: validOrder.orderId,
      paymentId: `pay_legit_${Date.now()}`,
      signature: 'sandbox_payment_verified',
    });

    assert(
      verifiedPayment.success === true && verifiedPayment.creditsAdded === 50,
      'Verified payment successfully credited 50 credits to user wallet',
      verifiedPayment
    );
    assert(
      verifiedPayment.balance === 50,
      'Candidate wallet balance successfully updated to 50 credits',
      verifiedPayment.balance
    );

    // -------------------------------------------------------------
    // SCENARIO 7: Idempotent Payment Callbacks (No Double Crediting)
    // -------------------------------------------------------------
    console.log('\n--- Scenario 7: Idempotency Protection Against Duplicate Callbacks ---');

    const duplicatePayment = await recruiterCreditsService.verifyPayment(cand.userId, {
      orderId: validOrder.orderId,
      paymentId: `pay_duplicate_retry_${Date.now()}`,
      signature: 'sandbox_payment_verified',
    });

    assert(
      duplicatePayment.success === true && duplicatePayment.balance === 50,
      'Duplicate payment callback detects already-paid status and preserves balance at 50 credits',
      duplicatePayment
    );

    const candFinalWallet = await recruiterCreditsService.getUserWallet(cand.userId, 'user');
    assert(
      candFinalWallet.balance === 50,
      'Final wallet balance is strictly 50 (NO duplicate credits granted on callback retry)',
      candFinalWallet.balance
    );

    // -------------------------------------------------------------
    // SCENARIO 8: Account-Type Consistency (Company, Startup, Institution)
    // -------------------------------------------------------------
    console.log('\n--- Scenario 8: Consistent Enforcement Across Business Account Types ---');

    // 1. Company
    const compOwner = await recruiterCreditsService.resolveOwner(comp.userId);
    // Company balance is 20 credits. Standard Job Posting costs 10 credits.
    const jobPostCharge = await recruiterCreditsService.deduct(compOwner, 10, 'Standard Job Posting', 'standard_job_posting');
    assert(jobPostCharge.balance === 10, 'Company successfully charged 10 credits for standard job (Balance: 20 -> 10)', jobPostCharge);

    // Company attempts Featured Job (30 credits) with 10 balance -> blocked
    let compBlockedErr: any = null;
    try {
      await recruiterCreditsService.deduct(compOwner, 30, 'Featured Job', 'promo_featured_jobs');
    } catch (err: any) {
      compBlockedErr = err;
    }
    assert(
      compBlockedErr !== null && compBlockedErr.statusCode === 402,
      'Company blocked with 402 INSUFFICIENT_CREDITS when balance is insufficient (shortfall = 20)',
      compBlockedErr?.details
    );

    // 2. Startup
    const start = accountWallets['Startup'];
    // Startup balance is 20 credits. Networking costs 20 credits.
    const netCharge = await recruiterCreditsService.chargeStartupFeature(start.userId, 'startup_networking');
    assert(netCharge.balance === 0, 'Startup successfully charged 20 credits for Networking (Balance: 20 -> 0)', netCharge);

    // Startup attempts Documentations (50 credits) with 0 balance -> blocked
    let startBlockedErr: any = null;
    try {
      await recruiterCreditsService.chargeStartupFeature(start.userId, 'startup_documentations');
    } catch (err: any) {
      startBlockedErr = err;
    }
    assert(
      startBlockedErr !== null && startBlockedErr.statusCode === 402,
      'Startup blocked with 402 INSUFFICIENT_CREDITS when balance is insufficient (shortfall = 50)',
      startBlockedErr?.details
    );

    // 3. Institution
    const inst = accountWallets['Institution'];
    // Institution balance is 20 credits. Placement mass application for 10 students = 20 credits (2 cr/student)
    const instAppCharge = await recruiterCreditsService.chargeInstitutionFeature(
      inst.userId,
      'inst_placement_mass_application',
      { quantity: 10 }
    );
    assert(instAppCharge.balance === 0, 'Institution successfully charged 20 credits for 10 mass applications (Balance: 20 -> 0)', instAppCharge);

    // Institution attempts Campus Drive (100 credits) with 0 balance -> blocked
    let instBlockedErr: any = null;
    try {
      await recruiterCreditsService.chargeInstitutionFeature(inst.userId, 'inst_campus_drive');
    } catch (err: any) {
      instBlockedErr = err;
    }
    assert(
      instBlockedErr !== null && instBlockedErr.statusCode === 402,
      'Institution blocked with 402 INSUFFICIENT_CREDITS when balance is insufficient (shortfall = 100)',
      instBlockedErr?.details
    );

    console.log('\n====================================================');
    console.log(`🎉 ALL ${passed}/${total} CREDIT ACCESS & SECURITY TESTS PASSED!`);
    console.log('====================================================\n');
  } catch (error: any) {
    console.error('\n❌ VALIDATION SUITE ERROR:', error?.message || error);
    process.exit(1);
  } finally {
    // Cleanup created test records
    console.log('--- Cleaning up test records ---');
    if (createdUserIds.length > 0) {
      await UserModel.deleteMany({ _id: { $in: createdUserIds } });
      await RecruiterCreditsModel.deleteMany({ userId: { $in: createdUserIds } });
      await CreditTransactionModel.deleteMany({ userId: { $in: createdUserIds } });
      await PaymentOrderModel.deleteMany({ userId: { $in: createdUserIds } });
      await UserSubscriptionModel.deleteMany({ userId: { $in: createdUserIds } });
    }
    if (createdOrgIds.length > 0) {
      await RecruiterOrganizationModel.deleteMany({ _id: { $in: createdOrgIds } });
      await RecruiterCreditsModel.deleteMany({ orgId: { $in: createdOrgIds } });
      await CreditTransactionModel.deleteMany({ orgId: { $in: createdOrgIds } });
    }
    await mongoose.disconnect();
    process.exit(0);
  }
}

runCreditEnforcementSuite();
