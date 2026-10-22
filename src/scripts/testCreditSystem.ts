import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import { recruiterCreditsService } from '../modules/recruiterCredits/recruiterCredits.service.js';
import { RecruiterCreditsModel, CreditTransactionModel, PaymentOrderModel, UserSubscriptionModel } from '../modules/recruiterCredits/recruiterCredits.model.js';
import { INITIAL_PROMOTIONAL_CREDITS, REFERRAL_REWARD_CREDITS, CREDIT_VALUE_INR } from '../config/pricing.config.js';

async function runCreditSystemTests() {
  console.log('====================================================');
  console.log('🧪 LETGETIN CREDIT SYSTEM INTEGRATION TEST SUITE');
  console.log('====================================================');
  await connectDatabase();
  process.env.ENABLE_TEST_PAYMENTS = 'true';

  // Ensure database indexes are sparse so orgId: null and userId: null don't collide
  try {
    const existingIndexes = await RecruiterCreditsModel.collection.indexes();
    const hasOrgIndex = existingIndexes.some((idx: any) => idx.name === 'orgId_1');
    if (hasOrgIndex) {
      await RecruiterCreditsModel.collection.dropIndex('orgId_1');
    }
  } catch (err) {}
  try {
    await RecruiterCreditsModel.createIndexes();
  } catch (err) {}

  const testUserId = new mongoose.Types.ObjectId().toString();
  const testReferralUserId = new mongoose.Types.ObjectId().toString();
  let passedCount = 0;
  let totalTests = 0;

  function assert(condition: boolean, testName: string, detail?: any) {
    totalTests++;
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passedCount++;
    } else {
      console.error(`  ❌ [FAIL] ${testName}`, detail || '');
      throw new Error(`Test failed: ${testName}`);
    }
  }

  try {
    // -----------------------------------------------------------------
    // TEST 1: Initial Promotional Balance (20 credits = ₹200)
    // -----------------------------------------------------------------
    console.log('\n--- 1. Testing Promotional Welcome Balance ---');
    const initialWallet = await recruiterCreditsService.getUserWallet(testUserId);
    assert(
      initialWallet.balance === INITIAL_PROMOTIONAL_CREDITS,
      `User receives exactly ${INITIAL_PROMOTIONAL_CREDITS} promotional credits on first access`,
      { balance: initialWallet.balance, expected: INITIAL_PROMOTIONAL_CREDITS }
    );
    assert(
      initialWallet.transactions.length === 1 && initialWallet.transactions[0].type === 'grant',
      'Promotional ledger transaction recorded in audit history',
      initialWallet.transactions
    );

    // -----------------------------------------------------------------
    // TEST 2: Sufficient Balance Deduction (Deduct 10 credits)
    // -----------------------------------------------------------------
    console.log('\n--- 2. Testing Sufficient Credit Deduction ---');
    const deductRes = await recruiterCreditsService.deduct(testUserId, 10, 'Psychometric Test', 'psychometric_test');
    assert(
      deductRes.balance === 10,
      'Balance reduced from 20 to 10 credits after psychometric test deduction',
      deductRes
    );

    // -----------------------------------------------------------------
    // TEST 3: Insufficient Credits 402 Error & Shortfall Calculation
    // -----------------------------------------------------------------
    console.log('\n--- 3. Testing Insufficient Balance Enforcement ---');
    let caughtError: any = null;
    try {
      // Trying to spend 30 credits (e.g. ATS Resume) with only 10 available
      await recruiterCreditsService.chargeForFeature(testUserId, 'ats_resume', '/resume/tailor');
    } catch (err: any) {
      caughtError = err;
    }

    assert(caughtError !== null, 'Operation blocked when balance is insufficient');
    assert(
      caughtError?.code === 'INSUFFICIENT_CREDITS',
      'Error code is strictly INSUFFICIENT_CREDITS',
      caughtError?.code
    );
    assert(
      caughtError?.statusCode === 402,
      'HTTP status code is strictly 402 Payment Required',
      caughtError?.statusCode
    );
    assert(
      caughtError?.details?.requiredCredits === 30,
      'Error details report requiredCredits = 30',
      caughtError?.details
    );
    assert(
      caughtError?.details?.availableBalance === 10,
      'Error details report availableBalance = 10',
      caughtError?.details
    );
    assert(
      caughtError?.details?.shortfall === 20,
      'Error details calculate exact shortfall = 20 credits',
      caughtError?.details
    );

    // -----------------------------------------------------------------
    // TEST 4: Atomic Concurrency & Negative Balance Prevention
    // -----------------------------------------------------------------
    console.log('\n--- 4. Testing Atomic Concurrency & Zero Negative Balance ---');
    // Balance is 10. Fire 3 concurrent requests each attempting to spend 5 credits.
    // Exactly 2 must succeed, 1 must fail. Balance must end at exactly 0.
    const concurrentResults = await Promise.allSettled([
      recruiterCreditsService.deduct(testUserId, 5, 'Concurrent Test 1'),
      recruiterCreditsService.deduct(testUserId, 5, 'Concurrent Test 2'),
      recruiterCreditsService.deduct(testUserId, 5, 'Concurrent Test 3'),
    ]);

    const successes = concurrentResults.filter((r) => r.status === 'fulfilled');
    const rejections = concurrentResults.filter((r) => r.status === 'rejected');
    const finalBalanceWallet = await recruiterCreditsService.getUserWallet(testUserId);

    assert(
      successes.length === 2,
      'Exactly 2 out of 3 concurrent 5-credit deductions succeeded',
      { successes: successes.length }
    );
    assert(
      rejections.length === 1,
      'Exactly 1 concurrent deduction rejected with insufficient balance',
      { rejections: rejections.length }
    );
    assert(
      finalBalanceWallet.balance === 0,
      'Wallet balance is exactly 0 and never dropped below zero',
      { balance: finalBalanceWallet.balance }
    );

    // -----------------------------------------------------------------
    // TEST 5: Payment Order & Idempotent Verification
    // -----------------------------------------------------------------
    console.log('\n--- 5. Testing Payment Order & Idempotent Verification ---');
    // Create an order for 50 credits (pack_50 = ₹500)
    const orderRes = await recruiterCreditsService.createPaymentOrder(testUserId, {
      purchaseType: 'credits',
      itemKey: 'pack_50',
    });
    assert(
      orderRes.credits === 50 && orderRes.amountInr === 500,
      'Payment order created for 50 credits at strict ₹10/credit = ₹500',
      orderRes
    );

    // Verify payment using sandbox verification mechanism
    const verifyRes = await recruiterCreditsService.verifyPayment(testUserId, {
      orderId: orderRes.orderId,
      paymentId: `pay_${Date.now()}`,
      signature: 'sandbox_payment_verified',
    });

    assert(
      verifyRes.success === true && verifyRes.creditsAdded === 50,
      'Payment verified and 50 credits granted to user account',
      verifyRes
    );
    assert(
      verifyRes.balance === 50,
      'User balance is now updated to 50 credits',
      verifyRes
    );

    // Idempotency: Attempt to verify the EXACT same order again
    const duplicateVerifyRes = await recruiterCreditsService.verifyPayment(testUserId, {
      orderId: orderRes.orderId,
      paymentId: `pay_duplicate_${Date.now()}`,
    });

    assert(
      duplicateVerifyRes.success === true && duplicateVerifyRes.balance === 50,
      'Duplicate payment verification was detected and preserved balance at 50 credits (Idempotent)',
      duplicateVerifyRes
    );
    const balanceAfterDuplicate = await recruiterCreditsService.getUserWallet(testUserId);
    assert(
      balanceAfterDuplicate.balance === 50,
      'Wallet balance remained 50 (no duplicate crediting)',
      balanceAfterDuplicate.balance
    );

    // -----------------------------------------------------------------
    // TEST 6: Referral Rewards (10 credits to both parties)
    // -----------------------------------------------------------------
    console.log('\n--- 6. Testing Referral Rewards System ---');
    const referralCode = initialWallet.referralCode;
    assert(!!referralCode, 'Referral code generated for user', referralCode);

    // New user claims referral
    const referralClaimRes = await recruiterCreditsService.claimReferral(testReferralUserId, referralCode!);
    assert(
      referralClaimRes.reward === REFERRAL_REWARD_CREDITS,
      `New user received ${REFERRAL_REWARD_CREDITS} referral credits`,
      referralClaimRes
    );

    // Check new user's balance: 20 promotional + 10 referral = 30 credits
    const refUserWallet = await recruiterCreditsService.getUserWallet(testReferralUserId);
    assert(
      refUserWallet.balance === 30,
      'New user has 30 credits (20 promotional + 10 referral)',
      refUserWallet.balance
    );

    // Check referrer's balance: 50 + 10 referral reward = 60 credits
    const referrerWallet = await recruiterCreditsService.getUserWallet(testUserId);
    assert(
      referrerWallet.balance === 60,
      'Referrer received +10 credits (balance updated from 50 to 60)',
      referrerWallet.balance
    );

    // Attempt repeated claim with same user
    let repeatedClaimError: any = null;
    try {
      await recruiterCreditsService.claimReferral(testReferralUserId, referralCode!);
    } catch (err: any) {
      repeatedClaimError = err;
    }
    assert(
      repeatedClaimError !== null,
      'Repeated referral claim is strictly blocked',
      repeatedClaimError?.message
    );

    // -----------------------------------------------------------------
    // TEST 7: Candidate vs Recruiter Pricing Catalog Separation
    // -----------------------------------------------------------------
    console.log('\n--- 7. Testing Candidate vs Recruiter Catalog Separation ---');
    const candidateWallet = await recruiterCreditsService.getUserWallet(testUserId, 'candidate');
    assert(
      Array.isArray(candidateWallet.pricingCatalog.candidatePlans) && candidateWallet.pricingCatalog.candidatePlans.length === 4,
      'Candidate wallet returns 4 candidate plan categories',
      candidateWallet.pricingCatalog.candidatePlans?.length
    );
    const totalCandidateItems = candidateWallet.pricingCatalog.candidatePlans?.reduce((sum, cat) => sum + cat.items.length, 0);
    assert(
      totalCandidateItems === 17,
      'Candidate plans contain exactly 17 authoritative pricing items',
      totalCandidateItems
    );
    assert(
      candidateWallet.pricingCatalog.subscriptionPlans.length === 0,
      'Recruiter enterprise subscription plans are NOT exposed to candidates',
      candidateWallet.pricingCatalog.subscriptionPlans
    );

    const recruiterWallet = await recruiterCreditsService.getUserWallet(testUserId, 'recruiter');
    assert(
      recruiterWallet.pricingCatalog.candidatePlans === undefined,
      'Candidate plans are NOT exposed to recruiter accounts',
      recruiterWallet.pricingCatalog.candidatePlans
    );
    assert(
      recruiterWallet.pricingCatalog.subscriptionPlans.length > 0,
      'Recruiter subscription plans are returned to recruiter accounts',
      recruiterWallet.pricingCatalog.subscriptionPlans.length
    );

    // -----------------------------------------------------------------
    // TEST 8: AI Apply Package Activation with Limit & Duration Enforcement
    // -----------------------------------------------------------------
    console.log('\n--- 8. Testing AI Apply Package Activation ---');
    // testUserId balance is currently 60 credits.
    // Activate ai_apply_20jobs_7days (40 credits).
    const pkgActivationRes = await recruiterCreditsService.activateCandidatePackage(
      testUserId,
      'ai_apply_20jobs_7days',
      'candidate'
    );
    assert(
      pkgActivationRes.success === true,
      'AI Apply package activated successfully',
      pkgActivationRes.message
    );
    assert(
      pkgActivationRes.balance === 20,
      'Credits deducted atomically from 60 to 20 for 40-credit package',
      pkgActivationRes.balance
    );
    assert(
      pkgActivationRes.subscription?.quotaTotal === 20 && pkgActivationRes.subscription?.quotaRemaining === 20,
      'AI Apply package quota initialized to 20 jobs',
      pkgActivationRes.subscription
    );

    const updatedCandidateWallet = await recruiterCreditsService.getUserWallet(testUserId, 'candidate');
    assert(
      updatedCandidateWallet.packages.length >= 1 && updatedCandidateWallet.packages[0].planId === 'ai_apply_20jobs_7days',
      'Active AI Apply package returned in candidate packages list',
      updatedCandidateWallet.packages
    );

    // -----------------------------------------------------------------
    // TEST 9: Strict Role-Based Restrictions Enforcement
    // -----------------------------------------------------------------
    console.log('\n--- 9. Testing Role-Based Restrictions ---');
    let recruiterPackageError: any = null;
    try {
      await recruiterCreditsService.activateCandidatePackage(testUserId, 'ai_apply_10jobs_1day', 'recruiter');
    } catch (err: any) {
      recruiterPackageError = err;
    }
    assert(
      recruiterPackageError !== null && recruiterPackageError.statusCode === 403,
      'Recruiter cannot activate candidate-only package (403 Forbidden)',
      recruiterPackageError?.message
    );

    let recruiterOrderError: any = null;
    try {
      await recruiterCreditsService.createPaymentOrder(
        testUserId,
        { purchaseType: 'package', itemKey: 'ai_apply_10jobs_1day' },
        'recruiter'
      );
    } catch (err: any) {
      recruiterOrderError = err;
    }
    assert(
      recruiterOrderError !== null && recruiterOrderError.statusCode === 403,
      'Recruiter cannot purchase candidate-only package order (403 Forbidden)',
      recruiterOrderError?.message
    );

    let candidateSubOrderError: any = null;
    try {
      await recruiterCreditsService.createPaymentOrder(
        testUserId,
        { purchaseType: 'subscription', itemKey: 'job_posting', billingCycle: 'monthly' },
        'candidate'
      );
    } catch (err: any) {
      candidateSubOrderError = err;
    }
    assert(
      candidateSubOrderError !== null && candidateSubOrderError.statusCode === 403,
      'Candidate cannot purchase recruiter enterprise subscription order (403 Forbidden)',
      candidateSubOrderError?.message
    );

    // -----------------------------------------------------------------
    // TEST 10: Company Subscription Plans Isolation & Pricing Verification
    // -----------------------------------------------------------------
    console.log('\n--- 10. Testing Company Subscription Plans & Duration Tiers ---');
    const companyWallet = await recruiterCreditsService.getUserWallet(testUserId, 'recruiter');
    assert(
      companyWallet.pricingCatalog.subscriptionPlans !== undefined,
      'Subscription plans returned for company recruiter'
    );
    const companySubIds = companyWallet.pricingCatalog.subscriptionPlans.map((s) => s.id);
    assert(
      companySubIds.includes('job_posting') && companySubIds.includes('hrms') && companySubIds.includes('recruitment_suite'),
      'Company wallet contains exactly Job Posting, HRMS, and Recruitment Suite',
      companySubIds
    );

    // Verify Job Posting tiers: 50 / 250 / 500 credits
    const jobPostingPlan = companyWallet.pricingCatalog.subscriptionPlans.find((s) => s.id === 'job_posting')!;
    assert(
      jobPostingPlan.durations.monthly.credits === 50 && jobPostingPlan.durations.monthly.priceInr === 500,
      'Job Posting Monthly = 50 credits / ₹500',
      jobPostingPlan.durations.monthly
    );
    assert(
      jobPostingPlan.durations.six_months.credits === 250 && jobPostingPlan.durations.six_months.priceInr === 2500,
      'Job Posting 6 Months = 250 credits / ₹2,500',
      jobPostingPlan.durations.six_months
    );
    assert(
      jobPostingPlan.durations.yearly.credits === 500 && jobPostingPlan.durations.yearly.priceInr === 5000,
      'Job Posting Yearly = 500 credits / ₹5,000',
      jobPostingPlan.durations.yearly
    );

    // Verify HRMS tiers: 150 / 750 / 1500 credits
    const hrmsPlan = companyWallet.pricingCatalog.subscriptionPlans.find((s) => s.id === 'hrms')!;
    assert(
      hrmsPlan.durations.monthly.credits === 150 && hrmsPlan.durations.monthly.priceInr === 1500 &&
      hrmsPlan.durations.six_months.credits === 750 && hrmsPlan.durations.six_months.priceInr === 7500 &&
      hrmsPlan.durations.yearly.credits === 1500 && hrmsPlan.durations.yearly.priceInr === 15000,
      'HRMS Durations: 150 cr / ₹1.5k, 750 cr / ₹7.5k, 1500 cr / ₹15k',
      hrmsPlan.durations
    );

    // Verify Recruitment Suite tiers: 250 / 1250 / 2500 credits
    const suitePlan = companyWallet.pricingCatalog.subscriptionPlans.find((s) => s.id === 'recruitment_suite')!;
    assert(
      suitePlan.durations.monthly.credits === 250 && suitePlan.durations.monthly.priceInr === 2500 &&
      suitePlan.durations.six_months.credits === 1250 && suitePlan.durations.six_months.priceInr === 12500 &&
      suitePlan.durations.yearly.credits === 2500 && suitePlan.durations.yearly.priceInr === 25000,
      'Recruitment Suite Durations: 250 cr / ₹2.5k, 1250 cr / ₹12.5k, 2500 cr / ₹25k',
      suitePlan.durations
    );

    // -----------------------------------------------------------------
    // TEST 11: Company Promotions & 7-Day Duration Enforcement
    // -----------------------------------------------------------------
    console.log('\n--- 11. Testing Company Promotions & 7-Day Placements ---');
    // Top up balance to test promotion activations
    const promoTestOwner = await recruiterCreditsService.getOrCreateCredits({ userId: testUserId });
    promoTestOwner.balance += 200;
    await promoTestOwner.save();

    // Activate Stay on the First Page (50 credits, 7-day duration)
    const firstPagePromo = await recruiterCreditsService.activateCompanyPromotion(
      testUserId,
      'promo_first_page_7d',
      'recruiter'
    );
    assert(
      firstPagePromo.success === true,
      'Successfully activated "Stay on the first page" promotion',
      firstPagePromo
    );
    const firstPageExpiryDiff = new Date(firstPagePromo.subscription.expiresAt).getTime() - new Date(firstPagePromo.subscription.startDate).getTime();
    const firstPageDays = Math.round(firstPageExpiryDiff / (24 * 3600 * 1000));
    assert(
      firstPageDays === 7,
      'Stay on the first page strictly enforces 7-day backend duration',
      { days: firstPageDays }
    );

    // Activate Stay in front row (75 credits, 7-day duration)
    const frontRowPromo = await recruiterCreditsService.activateCompanyPromotion(
      testUserId,
      'promo_front_row_7d',
      'recruiter'
    );
    assert(
      frontRowPromo.success === true,
      'Successfully activated "Stay in the front row" promotion',
      frontRowPromo
    );
    const frontRowExpiryDiff = new Date(frontRowPromo.subscription.expiresAt).getTime() - new Date(frontRowPromo.subscription.startDate).getTime();
    const frontRowDays = Math.round(frontRowExpiryDiff / (24 * 3600 * 1000));
    assert(
      frontRowDays === 7,
      'Stay in front row strictly enforces 7-day backend duration',
      { days: frontRowDays }
    );

    // -----------------------------------------------------------------
    // TEST 12: Case-by-Case Advertisement Rejection
    // -----------------------------------------------------------------
    console.log('\n--- 12. Testing Case-by-Case Advertisement Quote Enforce ---');
    let adError: any = null;
    try {
      await recruiterCreditsService.activateCompanyPromotion(testUserId, 'promo_advertisement', 'recruiter');
    } catch (err: any) {
      adError = err;
    }
    assert(
      adError !== null && adError.statusCode === 400,
      'Advertisement cannot be activated with fixed credits (case-by-case agreed quote required)',
      adError?.message
    );

    // -----------------------------------------------------------------
    // TEST 13: Company Pipeline Credit Calculations
    // -----------------------------------------------------------------
    console.log('\n--- 13. Testing Pipeline Credit Calculation Rules ---');
    const { computePipelineCreditsCost } = await import('../modules/recruiterCredits/pipelineCreditCosts.constants.js');
    const standardJobCost = computePipelineCreditsCost({ listAsJob: true });
    assert(standardJobCost === 10, 'Create Job Posting — Standard costs 10 credits (₹100)', { cost: standardJobCost });

    const premiumJobCost = computePipelineCreditsCost({ premiumJob: true });
    assert(premiumJobCost === 20, 'Create Job Posting — PremiumS costs 20 credits (₹200)', { cost: premiumJobCost });

    const featuredJobCost = computePipelineCreditsCost({ listAsJob: true, featuredJob: true });
    assert(featuredJobCost === 40, 'Standard Job (10) + Featured Job (30) = 40 credits', { cost: featuredJobCost });

    const fullPipelineCost = computePipelineCreditsCost({
      premiumJob: true,
      listInLandingPage: true, // 50
      listInRecentlyPosted: true, // 10
      featuredJob: true, // 30
    });
    assert(
      fullPipelineCost === 20 + 50 + 10 + 30, // 110 credits
      'Premium Job (20) + Landing Page (50) + Recently Posted (10) + Featured (30) = 110 credits',
      { cost: fullPipelineCost }
    );

    // -----------------------------------------------------------------
    // TEST 14: Billable Company Feature Charges
    // -----------------------------------------------------------------
    console.log('\n--- 14. Testing Billable Company Feature Charges ---');
    const domainCheckCharge = await recruiterCreditsService.chargeForFeature(testUserId, 'domain_check');
    assert(domainCheckCharge.cost === 20, 'Domain Check charge = 20 credits (₹200)', domainCheckCharge);

    const bgvCharge = await recruiterCreditsService.chargeForFeature(testUserId, 'bg_verification');
    assert(bgvCharge.cost === 30, 'BG Verification platform charge = 30 credits (₹300)', bgvCharge);

    // -----------------------------------------------------------------
    // TEST 15: Startup Account Isolation & Subscription Plans
    // -----------------------------------------------------------------
    console.log('\n--- 15. Testing Startup Account Isolation & Subscription Plans ---');
    const testStartupUserId = new mongoose.Types.ObjectId().toString();

    // Create a mock user document with role: 'startup'
    const { UserModel } = await import('../modules/user/user.model.js');
    await UserModel.create({
      _id: new mongoose.Types.ObjectId(testStartupUserId),
      email: `startup_test_${Date.now()}@letgetin.com`,
      passwordHash: 'dummy_hash',
      role: 'startup',
      entityType: 'startup',
      status: 'active',
      isEmailVerified: true,
    });

    const startupWallet = await recruiterCreditsService.getUserWallet(testStartupUserId, 'startup');
    assert(
      startupWallet.balance === INITIAL_PROMOTIONAL_CREDITS,
      `Startup account receives ${INITIAL_PROMOTIONAL_CREDITS} initial promotional credits (₹200)`,
      startupWallet.balance
    );

    assert(
      startupWallet.pricingCatalog.subscriptionPlans.length === 3,
      'Startup account receives exactly 3 subscription plans (Job Posting, HRMS, and Startup)',
      startupWallet.pricingCatalog.subscriptionPlans.map((s) => s.id)
    );
    const startupSubIds = startupWallet.pricingCatalog.subscriptionPlans.map((s) => s.id);
    assert(
      startupSubIds.includes('job_posting') && startupSubIds.includes('hrms') && startupSubIds.includes('startup'),
      'Startup subscription plans include job_posting, hrms, and startup',
      startupSubIds
    );

    // Verify Job Posting tiers for Startup: 50 / 250 / 500 credits
    const startupJobPosting = startupWallet.pricingCatalog.subscriptionPlans.find((s) => s.id === 'job_posting')!;
    assert(
      startupJobPosting.durations.monthly.credits === 50 && startupJobPosting.durations.monthly.priceInr === 500 &&
      startupJobPosting.durations.six_months.credits === 250 && startupJobPosting.durations.six_months.priceInr === 2500 &&
      startupJobPosting.durations.yearly.credits === 500 && startupJobPosting.durations.yearly.priceInr === 5000,
      'Startup Job Posting durations: 50 cr / ₹500 (mo), 250 cr / ₹2,500 (6 mo), 500 cr / ₹5,000 (yr)',
      startupJobPosting.durations
    );

    // Verify HRMS tiers for Startup: 150 / 750 / 1500 credits
    const startupHrms = startupWallet.pricingCatalog.subscriptionPlans.find((s) => s.id === 'hrms')!;
    assert(
      startupHrms.durations.monthly.credits === 150 && startupHrms.durations.monthly.priceInr === 1500 &&
      startupHrms.durations.six_months.credits === 750 && startupHrms.durations.six_months.priceInr === 7500 &&
      startupHrms.durations.yearly.credits === 1500 && startupHrms.durations.yearly.priceInr === 15000,
      'Startup HRMS durations: 150 cr / ₹1,500 (mo), 750 cr / ₹7,500 (6 mo), 1,500 cr / ₹15,000 (yr)',
      startupHrms.durations
    );

    // Verify Startup tiers: 50 / 250 / 500 credits
    const startupSub = startupWallet.pricingCatalog.subscriptionPlans.find((s) => s.id === 'startup')!;
    assert(
      startupSub.durations.monthly.credits === 50 && startupSub.durations.monthly.priceInr === 500 &&
      startupSub.durations.six_months.credits === 250 && startupSub.durations.six_months.priceInr === 2500 &&
      startupSub.durations.yearly.credits === 500 && startupSub.durations.yearly.priceInr === 5000,
      'Startup durations: 50 cr / ₹500 (mo), 250 cr / ₹2,500 (6 mo), 500 cr / ₹5,000 (yr)',
      startupSub.durations
    );

    assert(
      startupWallet.pricingCatalog.companyPlans === undefined,
      'Company plans are NOT exposed to startup accounts',
      startupWallet.pricingCatalog.companyPlans
    );
    assert(
      startupWallet.pricingCatalog.candidatePlans === undefined,
      'Candidate plans are NOT exposed to startup accounts',
      startupWallet.pricingCatalog.candidatePlans
    );
    assert(
      Array.isArray(startupWallet.pricingCatalog.startupPlans) && startupWallet.pricingCatalog.startupPlans.length >= 3,
      'Startup wallet returns Startup plan category groups including the 3 required categories',
      startupWallet.pricingCatalog.startupPlans?.map((g) => g.id)
    );

    const startupCatIds = startupWallet.pricingCatalog.startupPlans!.map((g) => g.id);
    assert(
      startupCatIds.includes('job_posting_recruitment') &&
      startupCatIds.includes('promotions_explore') &&
      startupCatIds.includes('career_guidance_learning'),
      'Startup catalog contains Job Posting & Recruitment, Promotions, and Career Guidance categories',
      startupCatIds
    );

    // Verify Job Posting & Recruitment Activities items
    const recruitCat = startupWallet.pricingCatalog.startupPlans!.find((g) => g.id === 'job_posting_recruitment')!;
    assert(
      recruitCat.items.length === 6,
      'Job Posting and Recruitment category has exactly 6 items',
      recruitCat.items.length
    );
    const standardJob = recruitCat.items.find((i) => i.id === 'standard_job_posting')!;
    assert(standardJob.credits === 10 && standardJob.priceInr === 100, 'Create Job Posting – Standard: 10 credits / ₹100', standardJob);
    const premiumJob = recruitCat.items.find((i) => i.id === 'premium_job_posting')!;
    assert(premiumJob.credits === 20 && premiumJob.priceInr === 200, 'Create Job Posting – PremiumS: 20 credits / ₹200', premiumJob);
    const bgVerif = recruitCat.items.find((i) => i.id === 'bg_verification')!;
    assert(bgVerif.credits === 30 && bgVerif.priceInr === 300 && !!bgVerif.providerFeeNote, 'BG Verification: 30 credits / ₹300 with provider fee note', bgVerif);

    // Verify Promotions & Explore Opportunities items
    const promoCat = startupWallet.pricingCatalog.startupPlans!.find((g) => g.id === 'promotions_explore')!;
    assert(
      promoCat.items.length === 8,
      'Promotions and Explore Opportunities category has exactly 8 items',
      promoCat.items.length
    );
    const firstPage = promoCat.items.find((i) => i.id === 'promo_first_page_7d')!;
    assert(firstPage.credits === 50 && firstPage.priceInr === 500 && firstPage.durationDays === 7, 'Stay on first page: 50 credits / ₹500 (7-day)', firstPage);
    const frontRow = promoCat.items.find((i) => i.id === 'promo_front_row_7d')!;
    assert(frontRow.credits === 75 && frontRow.priceInr === 750 && frontRow.durationDays === 7, 'Stay in front row: 75 credits / ₹750 (7-day)', frontRow);
    const adItem = promoCat.items.find((i) => i.id === 'promo_advertisement')!;
    assert(adItem.caseByCase === true, 'Advertisement: Case-by-case / To be agreed', adItem);

    // Verify Career Guidance & Learning items
    const careerCat = startupWallet.pricingCatalog.startupPlans!.find((g) => g.id === 'career_guidance_learning')!;
    assert(
      careerCat.items.length === 10,
      'Career Guidance and Learning category has exactly 10 items',
      careerCat.items.length
    );
    const psychoTest = careerCat.items.find((i) => i.id === 'psychometric_test')!;
    assert(psychoTest.credits === 10 && psychoTest.priceInr === 100, 'Psychometric Test: 10 credits / ₹100', psychoTest);
    const aiCounselling = careerCat.items.find((i) => i.id === 'career_counselling_ai')!;
    assert(aiCounselling.credits === 3 && aiCounselling.priceInr === 30, 'Career Counselling – AI: 3 credits / ₹30', aiCounselling);
    const ojtProg = careerCat.items.find((i) => i.id === 'on_job_training')!;
    assert(ojtProg.credits === 100 && ojtProg.priceInr === 1000, 'On-job Training: 100 credits / ₹1,000', ojtProg);

    // -----------------------------------------------------------------
    // TEST 16: Startup Subscription Purchase & Idempotent Verification
    // -----------------------------------------------------------------
    console.log('\n--- 16. Testing Startup Subscription Purchase & Verification ---');
    const startupOrder = await recruiterCreditsService.createPaymentOrder(
      testStartupUserId,
      { purchaseType: 'subscription', itemKey: 'startup', billingCycle: 'monthly' },
      'startup'
    );
    assert(
      startupOrder.credits === 50 && startupOrder.amountInr === 500,
      'Startup monthly subscription order created for 50 credits at ₹500',
      startupOrder
    );

    const startupVerify = await recruiterCreditsService.verifyPayment(testStartupUserId, {
      orderId: startupOrder.orderId,
      paymentId: `pay_startup_${Date.now()}`,
    });
    assert(
      startupVerify.success === true && startupVerify.creditsAdded === 50,
      'Startup payment verified and 50 credits granted',
      startupVerify
    );
    assert(
      startupVerify.balance === 70, // 20 promotional + 50 subscription credits
      'Startup balance updated to 70 credits (20 promotional + 50 subscription credits)',
      startupVerify.balance
    );

    // Check active subscription
    const hasStartupSub = await recruiterCreditsService.hasActiveSubscription(testStartupUserId, 'startup');
    assert(hasStartupSub === true, 'Startup active subscription confirmed in database');

    // Test creating orders for Job Posting and HRMS under Startup role
    const startupJobOrder = await recruiterCreditsService.createPaymentOrder(
      testStartupUserId,
      { purchaseType: 'subscription', itemKey: 'job_posting', billingCycle: 'six_months' },
      'startup'
    );
    assert(
      startupJobOrder.credits === 250 && startupJobOrder.amountInr === 2500,
      'Startup can order Job Posting 6 Months subscription (250 credits / ₹2,500)',
      startupJobOrder
    );

    const startupHrmsOrder = await recruiterCreditsService.createPaymentOrder(
      testStartupUserId,
      { purchaseType: 'subscription', itemKey: 'hrms', billingCycle: 'yearly' },
      'startup'
    );
    assert(
      startupHrmsOrder.credits === 1500 && startupHrmsOrder.amountInr === 15000,
      'Startup can order HRMS Yearly subscription (1,500 credits / ₹15,000)',
      startupHrmsOrder
    );

    // -----------------------------------------------------------------
    // TEST 17: All 6 Billable Startup Feature Deductions
    // -----------------------------------------------------------------
    console.log('\n--- 17. Testing 6 Billable Startup Feature Charges ---');
    // Current balance: 70 credits
    // 1. Networking = 20 credits
    const netCharge = await recruiterCreditsService.chargeStartupFeature(testStartupUserId, 'startup_networking');
    assert(netCharge.cost === 20 && netCharge.balance === 50, 'Networking charged 20 credits (Balance: 70 -> 50)', netCharge);

    // 2. Business Plus = 50 credits (Balance: 50 -> 0)
    const bpCharge = await recruiterCreditsService.chargeStartupFeature(testStartupUserId, 'startup_business_plus');
    assert(bpCharge.cost === 50 && bpCharge.balance === 0, 'Business Plus charged 50 credits (Balance: 50 -> 0)', bpCharge);

    // Top up 250 credits to test the other 4 features
    const startupCreditsDoc = await recruiterCreditsService.getOrCreateCredits({ userId: testStartupUserId });
    startupCreditsDoc.balance += 250;
    await startupCreditsDoc.save();

    // 3. Documentations = 50 credits (Balance: 250 -> 200)
    const docCharge = await recruiterCreditsService.chargeStartupFeature(testStartupUserId, 'startup_documentations');
    assert(docCharge.cost === 50 && docCharge.balance === 200, 'Documentations charged 50 credits (Balance: 250 -> 200)', docCharge);

    // 4. Funding Support = 50 credits (Balance: 200 -> 150)
    const fundCharge = await recruiterCreditsService.chargeStartupFeature(testStartupUserId, 'startup_funding_support');
    assert(fundCharge.cost === 50 && fundCharge.balance === 150, 'Funding Support charged 50 credits (Balance: 200 -> 150)', fundCharge);

    // 5. Incubations = 50 credits (Balance: 150 -> 100)
    const incCharge = await recruiterCreditsService.chargeStartupFeature(testStartupUserId, 'startup_incubations');
    assert(incCharge.cost === 50 && incCharge.balance === 100, 'Incubations charged 50 credits (Balance: 150 -> 100)', incCharge);

    // 6. Accelerators = 50 credits (Balance: 100 -> 50)
    const accCharge = await recruiterCreditsService.chargeStartupFeature(testStartupUserId, 'startup_accelerators');
    assert(accCharge.cost === 50 && accCharge.balance === 50, 'Accelerators charged 50 credits (Balance: 100 -> 50)', accCharge);

    // -----------------------------------------------------------------
    // TEST 18: Startup Insufficient Balance & Cross-Role Restrictions
    // -----------------------------------------------------------------
    console.log('\n--- 18. Testing Startup Insufficient Balance & Cross-Role Enforce ---');
    // Balance is 50 credits. Deduct 40 to leave 10 credits.
    await recruiterCreditsService.deduct(testStartupUserId, 40, 'Interim Spend');

    let startupInsufficientErr: any = null;
    try {
      // Accelerators costs 50 credits, only 10 available
      await recruiterCreditsService.chargeStartupFeature(testStartupUserId, 'startup_accelerators');
    } catch (err: any) {
      startupInsufficientErr = err;
    }
    assert(
      startupInsufficientErr !== null && startupInsufficientErr.statusCode === 402,
      'Startup operation blocked with 402 INSUFFICIENT_CREDITS when balance is insufficient',
      startupInsufficientErr?.message
    );
    assert(
      startupInsufficientErr?.details?.shortfall === 40,
      'Exact shortfall calculated (50 required - 10 available = 40 shortfall)',
      startupInsufficientErr?.details
    );

    // Startup cannot purchase Recruitment Suite
    let startupCrossRoleErr: any = null;
    try {
      await recruiterCreditsService.createPaymentOrder(
        testStartupUserId,
        { purchaseType: 'subscription', itemKey: 'recruitment_suite' },
        'startup'
      );
    } catch (err: any) {
      startupCrossRoleErr = err;
    }
    assert(
      startupCrossRoleErr !== null && startupCrossRoleErr.statusCode === 400,
      'Startup cannot purchase recruitment_suite subscriptions',
      startupCrossRoleErr?.message
    );

    // Clean up testStartupUserId
    await UserModel.deleteOne({ _id: testStartupUserId });
    await RecruiterCreditsModel.deleteMany({ userId: testStartupUserId });
    await CreditTransactionModel.deleteMany({ userId: testStartupUserId });
    await PaymentOrderModel.deleteMany({ userId: testStartupUserId });
    await UserSubscriptionModel.deleteMany({ userId: testStartupUserId });

    // -----------------------------------------------------------------
    // TEST 19: Institution Account Isolation & Catalog Verification
    // -----------------------------------------------------------------
    console.log('\n--- 19. Testing Institution Account Isolation & Catalog Verification ---');
    const testInstUserId = new mongoose.Types.ObjectId().toString();

    // Create a mock user document with role: 'institution'
    await UserModel.create({
      _id: new mongoose.Types.ObjectId(testInstUserId),
      email: `inst_test_${Date.now()}@letgetin.com`,
      passwordHash: 'dummy_hash',
      role: 'institution',
      entityType: 'institution',
      status: 'active',
      isEmailVerified: true,
    });

    const instWallet = await recruiterCreditsService.getUserWallet(testInstUserId, 'institution');
    assert(
      instWallet.balance === INITIAL_PROMOTIONAL_CREDITS,
      `Institution account receives ${INITIAL_PROMOTIONAL_CREDITS} initial promotional credits (₹200)`,
      instWallet.balance
    );

    assert(
      instWallet.pricingCatalog.subscriptionPlans.length === 1,
      'Institution account receives exactly 1 subscription plan (Institution)',
      instWallet.pricingCatalog.subscriptionPlans.map((s) => s.id)
    );
    const instSub = instWallet.pricingCatalog.subscriptionPlans[0];
    assert(
      instSub.id === 'institution',
      'Institution subscription plan ID is "institution"',
      instSub.id
    );

    // Verify Institution subscription tiers: 100 / 500 / 1000 credits
    assert(
      instSub.durations.monthly.credits === 100 && instSub.durations.monthly.priceInr === 1000 &&
      instSub.durations.six_months.credits === 500 && instSub.durations.six_months.priceInr === 5000 &&
      instSub.durations.yearly.credits === 1000 && instSub.durations.yearly.priceInr === 10000,
      'Institution durations: 100 cr / ₹1,000 (mo), 500 cr / ₹5,000 (6 mo), 1,000 cr / ₹10,000 (yr)',
      instSub.durations
    );

    assert(
      instWallet.pricingCatalog.companyPlans === undefined,
      'Company plans are NOT exposed to institution accounts',
      instWallet.pricingCatalog.companyPlans
    );
    assert(
      instWallet.pricingCatalog.candidatePlans === undefined,
      'Candidate plans are NOT exposed to institution accounts',
      instWallet.pricingCatalog.candidatePlans
    );
    assert(
      instWallet.pricingCatalog.startupPlans === undefined,
      'Startup plans are NOT exposed to institution accounts',
      instWallet.pricingCatalog.startupPlans
    );

    assert(
      Array.isArray(instWallet.pricingCatalog.institutionPlans) && instWallet.pricingCatalog.institutionPlans.length === 1,
      'Institution wallet returns institutionPlans catalog with 1 category group',
      instWallet.pricingCatalog.institutionPlans?.map((g) => g.id)
    );

    const instServicesGroup = instWallet.pricingCatalog.institutionPlans![0];
    assert(
      instServicesGroup.items.length === 7,
      'Institution category contains exactly 7 authoritative services',
      instServicesGroup.items.length
    );

    // Verify all 7 services and authoritative pricing
    const massApp = instServicesGroup.items.find((i) => i.id === 'inst_placement_mass_application')!;
    assert(
      massApp.credits === 2 && massApp.priceInr === 20 && massApp.chargingUnit === 'Per student application',
      'Placement – Mass Application: 2 credits / ₹20 (Per student application)',
      massApp
    );

    const campusDrive = instServicesGroup.items.find((i) => i.id === 'inst_campus_drive')!;
    assert(
      campusDrive.credits === 100 && campusDrive.priceInr === 1000 && campusDrive.chargingUnit === 'Per event',
      'Campus – Drive: 100 credits / ₹1,000 (Per event)',
      campusDrive
    );

    const jobFairCampus = instServicesGroup.items.find((i) => i.id === 'inst_job_fair_campus')!;
    assert(
      jobFairCampus.credits === 300 && jobFairCampus.priceInr === 3000 && jobFairCampus.chargingUnit === 'Per event',
      'Job Fair at Campus: 300 credits / ₹3,000 (Per event)',
      jobFairCampus
    );

    const jobFairOnline = instServicesGroup.items.find((i) => i.id === 'inst_job_fair_online')!;
    assert(
      jobFairOnline.credits === 150 && jobFairOnline.priceInr === 1500 && jobFairOnline.chargingUnit === 'Per event',
      'Job Fair – Online: 150 credits / ₹1,500 (Per event)',
      jobFairOnline
    );

    const careerEnhance = instServicesGroup.items.find((i) => i.id === 'inst_career_enhancement')!;
    assert(
      careerEnhance.credits === 50 && careerEnhance.priceInr === 500 && careerEnhance.chargingUnit === 'Per session',
      'Career Enhancement at Campus: 50 credits / ₹500 (Per session)',
      careerEnhance
    );

    const skillsEnhance = instServicesGroup.items.find((i) => i.id === 'inst_skills_enhancement_batch')!;
    assert(
      skillsEnhance.credits === 100 && skillsEnhance.priceInr === 1000 && skillsEnhance.chargingUnit === 'Per batch',
      'Skills Enhancement: 100 credits / ₹1,000 (Per batch)',
      skillsEnhance
    );

    const geniusTest = instServicesGroup.items.find((i) => i.id === 'inst_genius_test_campus')!;
    assert(
      geniusTest.credits === 5 && geniusTest.priceInr === 50 && geniusTest.chargingUnit === 'Per student test',
      'Genius Test at Campus: 5 credits / ₹50 (Per student test)',
      geniusTest
    );

    // -----------------------------------------------------------------
    // TEST 20: Institution Subscription Purchase & Idempotent Verification
    // -----------------------------------------------------------------
    console.log('\n--- 20. Testing Institution Subscription Purchase & Verification ---');
    const instOrder = await recruiterCreditsService.createPaymentOrder(
      testInstUserId,
      { purchaseType: 'subscription', itemKey: 'institution', billingCycle: 'monthly' },
      'institution'
    );
    assert(
      instOrder.credits === 100 && instOrder.amountInr === 1000,
      'Institution monthly subscription order created for 100 credits at ₹1,000',
      instOrder
    );

    const instVerify = await recruiterCreditsService.verifyPayment(testInstUserId, {
      orderId: instOrder.orderId,
      paymentId: `pay_inst_${Date.now()}`,
    });
    assert(
      instVerify.success === true && instVerify.creditsAdded === 100,
      'Institution payment verified and 100 credits granted',
      instVerify
    );
    assert(
      instVerify.balance === 120, // 20 promotional + 100 subscription credits
      'Institution balance updated to 120 credits (20 promotional + 100 subscription credits)',
      instVerify.balance
    );

    // Check active subscription
    const hasInstSub = await recruiterCreditsService.hasActiveSubscription(testInstUserId, 'institution');
    assert(hasInstSub === true, 'Institution active subscription confirmed in database');

    // Test creating orders for 6 months and yearly
    const inst6MoOrder = await recruiterCreditsService.createPaymentOrder(
      testInstUserId,
      { purchaseType: 'subscription', itemKey: 'institution', billingCycle: 'six_months' },
      'institution'
    );
    assert(
      inst6MoOrder.credits === 500 && inst6MoOrder.amountInr === 5000,
      'Institution can order 6 Months subscription (500 credits / ₹5,000)',
      inst6MoOrder
    );

    const instYrOrder = await recruiterCreditsService.createPaymentOrder(
      testInstUserId,
      { purchaseType: 'subscription', itemKey: 'institution', billingCycle: 'yearly' },
      'institution'
    );
    assert(
      instYrOrder.credits === 1000 && instYrOrder.amountInr === 10000,
      'Institution can order Yearly subscription (1,000 credits / ₹10,000)',
      instYrOrder
    );

    // -----------------------------------------------------------------
    // TEST 21: Institution Batch & Service Charges
    // -----------------------------------------------------------------
    console.log('\n--- 21. Testing Institution Batch & Service Charges ---');
    // Current balance: 120 credits

    // 1. Placement – Mass Application: 25 student applications * 2 credits = 50 credits
    const massAppCharge = await recruiterCreditsService.chargeInstitutionFeature(testInstUserId, 'inst_placement_mass_application', {
      quantity: 25,
      details: { batchName: 'Class of 2026 CS' },
    });
    assert(
      massAppCharge.cost === 50 && massAppCharge.balance === 70,
      'Mass Application batch (25 students * 2 cr = 50 cr) charged correctly (Balance: 120 -> 70)',
      massAppCharge
    );

    // 2. Genius Test at Campus: 10 student tests * 5 credits = 50 credits
    const geniusTestCharge = await recruiterCreditsService.chargeInstitutionFeature(testInstUserId, 'inst_genius_test_campus', {
      quantity: 10,
      details: { batchName: 'Pre-placement Screening' },
    });
    assert(
      geniusTestCharge.cost === 50 && geniusTestCharge.balance === 20,
      'Genius Test batch (10 students * 5 cr = 50 cr) charged correctly (Balance: 70 -> 20)',
      geniusTestCharge
    );

    // Top up 650 credits to test remaining 5 services
    const instCreditsDoc = await recruiterCreditsService.getOrCreateCredits({ userId: testInstUserId });
    instCreditsDoc.balance += 650;
    await instCreditsDoc.save();

    // 3. Career Enhancement at Campus: 50 credits (Balance: 670 -> 620)
    const careerCharge = await recruiterCreditsService.chargeInstitutionFeature(testInstUserId, 'inst_career_enhancement');
    assert(careerCharge.cost === 50 && careerCharge.balance === 620, 'Career Enhancement charged 50 credits (Balance: 670 -> 620)', careerCharge);

    // 4. Skills Enhancement: 100 credits (Balance: 620 -> 520)
    const skillsCharge = await recruiterCreditsService.chargeInstitutionFeature(testInstUserId, 'inst_skills_enhancement_batch');
    assert(skillsCharge.cost === 100 && skillsCharge.balance === 520, 'Skills Enhancement charged 100 credits (Balance: 620 -> 520)', skillsCharge);

    // 5. Campus – Drive: 100 credits (Balance: 520 -> 420)
    const driveCharge = await recruiterCreditsService.chargeInstitutionFeature(testInstUserId, 'inst_campus_drive');
    assert(driveCharge.cost === 100 && driveCharge.balance === 420, 'Campus Drive charged 100 credits (Balance: 520 -> 420)', driveCharge);

    // 6. Job Fair – Online: 150 credits (Balance: 420 -> 270)
    const onlineFairCharge = await recruiterCreditsService.chargeInstitutionFeature(testInstUserId, 'inst_job_fair_online');
    assert(onlineFairCharge.cost === 150 && onlineFairCharge.balance === 270, 'Job Fair – Online charged 150 credits (Balance: 420 -> 270)', onlineFairCharge);

    // 7. Job Fair at Campus: 300 credits (Balance: 270 -> insufficient!)
    // Add 50 credits so balance is 320, then charge 300 -> 20 remaining
    instCreditsDoc.balance = 320;
    await instCreditsDoc.save();
    const campusFairCharge = await recruiterCreditsService.chargeInstitutionFeature(testInstUserId, 'inst_job_fair_campus');
    assert(campusFairCharge.cost === 300 && campusFairCharge.balance === 20, 'Job Fair at Campus charged 300 credits (Balance: 320 -> 20)', campusFairCharge);

    // -----------------------------------------------------------------
    // TEST 22: Institution Insufficient Balance 402 & Cross-Role Restrictions
    // -----------------------------------------------------------------
    console.log('\n--- 22. Testing Institution Insufficient Balance & Cross-Role Restrictions ---');
    // Balance is 20 credits.
    // Try to book a Campus Drive (100 credits) with only 20 credits
    let instInsufficientErr: any = null;
    try {
      await recruiterCreditsService.chargeInstitutionFeature(testInstUserId, 'inst_campus_drive');
    } catch (err: any) {
      instInsufficientErr = err;
    }
    assert(
      instInsufficientErr !== null && instInsufficientErr.statusCode === 402,
      'Campus Drive blocked with 402 INSUFFICIENT_CREDITS when balance is insufficient',
      instInsufficientErr?.message
    );
    assert(
      instInsufficientErr?.details?.shortfall === 80,
      'Exact shortfall calculated (100 required - 20 available = 80 shortfall)',
      instInsufficientErr?.details
    );

    // Try Mass Application for 20 students (40 credits) with 20 credits
    let massAppInsufficientErr: any = null;
    try {
      await recruiterCreditsService.chargeInstitutionFeature(testInstUserId, 'inst_placement_mass_application', { quantity: 20 });
    } catch (err: any) {
      massAppInsufficientErr = err;
    }
    assert(
      massAppInsufficientErr !== null && massAppInsufficientErr.statusCode === 402,
      'Mass application batch blocked with 402 INSUFFICIENT_CREDITS when total credits exceed balance',
      massAppInsufficientErr?.message
    );
    assert(
      massAppInsufficientErr?.details?.shortfall === 20,
      'Batch shortfall calculated (40 required - 20 available = 20 shortfall)',
      massAppInsufficientErr?.details
    );

    // Institution cannot purchase Startup, Recruitment Suite, or Job Posting subscriptions
    let instCrossRoleErr: any = null;
    try {
      await recruiterCreditsService.createPaymentOrder(
        testInstUserId,
        { purchaseType: 'subscription', itemKey: 'startup' },
        'institution'
      );
    } catch (err: any) {
      instCrossRoleErr = err;
    }
    assert(
      instCrossRoleErr !== null && instCrossRoleErr.statusCode === 400,
      'Institution cannot purchase startup subscriptions',
      instCrossRoleErr?.message
    );

    // Clean up testInstUserId
    await UserModel.deleteOne({ _id: testInstUserId });
    await RecruiterCreditsModel.deleteMany({ userId: testInstUserId });
    await CreditTransactionModel.deleteMany({ userId: testInstUserId });
    await PaymentOrderModel.deleteMany({ userId: testInstUserId });
    await UserSubscriptionModel.deleteMany({ userId: testInstUserId });

    // -----------------------------------------------------------------
    // CLEANUP
    // -----------------------------------------------------------------
    console.log('\n--- Cleaning up test records ---');
    await RecruiterCreditsModel.deleteMany({ userId: { $in: [testUserId, testReferralUserId] } });
    await CreditTransactionModel.deleteMany({ userId: { $in: [testUserId, testReferralUserId] } });
    await PaymentOrderModel.deleteMany({ userId: { $in: [testUserId, testReferralUserId] } });
    await UserSubscriptionModel.deleteMany({ userId: { $in: [testUserId, testReferralUserId] } });

    console.log('\n====================================================');
    console.log(`🎉 ALL ${passedCount}/${totalTests} TESTS PASSED SUCCESSFULLY!`);
    console.log('====================================================\n');
  } catch (error: any) {
    console.error('\n❌ TEST SUITE RUN FAILED:', error?.message || error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

runCreditSystemTests();
