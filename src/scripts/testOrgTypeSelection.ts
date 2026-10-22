import mongoose from 'mongoose';
import { UserModel } from '../modules/user/user.model.js';
import { RecruiterOrganizationModel } from '../modules/recruiterOrg/recruiterOrg.model.js';
import { AuthService } from '../modules/auth/auth.service.js';
import { OtpService } from '../modules/auth/services/otp.service.js';
import { RecruiterOrgService } from '../modules/recruiterOrg/recruiterOrg.service.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/letgetin';

async function runTests() {
  console.log('Connecting to MongoDB at', MONGO_URI);
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB.');

  const authService = new AuthService();
  const recruiterOrgService = new RecruiterOrgService();

  const testCases: Array<{ type: 'company' | 'startup' | 'institution'; label: string }> = [
    { type: 'company', label: 'Company' },
    { type: 'startup', label: 'Startup' },
    { type: 'institution', label: 'Institution' },
  ];

  for (const { type, label } of testCases) {
    console.log(`\n========================================`);
    console.log(`Testing Registration for: ${label} (${type})`);
    console.log(`========================================`);

    const username = `recruiter_${type}_${Date.now()}`;
    const email = `${username}@test.com`;
    const password = 'Password123!';

    // Cleanup any existing
    await UserModel.deleteMany({ email });

    // Step 1: Send OTP
    console.log(`1. Sending OTP to ${email}...`);
    await authService.sendEmailOtp(email);

    // Development mode OTP is 123456
    const otpCode = '123456';
    console.log(`2. Using OTP code: ${otpCode}`);

    // Step 2: Verify OTP and create recruiter user with entityType
    console.log(`3. Verifying OTP with role: "recruiter" and entityType: "${type}"...`);
    const { user, tokens } = await authService.verifyEmailOtpAndCreateUser({
      email,
      username,
      password,
      confirmPassword: password,
      otp: otpCode,
      role: 'recruiter',
      entityType: type,
    });

    console.log(`4. User created with ID: ${user._id}, role: ${user.role}, entityType: ${user.entityType}`);
    if (user.entityType !== type) {
      throw new Error(`Expected entityType "${type}", got "${user.entityType}"`);
    }

    // Step 3: Verify user directly in MongoDB
    const dbUser = await UserModel.findById(user._id);
    if (!dbUser) {
      throw new Error(`User not found in MongoDB`);
    }
    console.log(`5. Verified UserModel in DB: entityType = "${dbUser.entityType}"`);
    if (dbUser.entityType !== type) {
      throw new Error(`DB entityType mismatch: expected "${type}", got "${dbUser.entityType}"`);
    }

    // Step 4: Verify getMe returns entityType
    const me = await authService.getMe(user._id!.toString());
    console.log(`6. Verified getMe() output: entityType = "${me.entityType}"`);
    if (me.entityType !== type) {
      throw new Error(`getMe entityType mismatch`);
    }

    // Step 5: Test saveOrgProfile with this entity type
    console.log(`7. Testing saveOrgProfile for ${type}...`);
    const orgProfile = await recruiterOrgService.saveOrgProfile(user._id!.toString(), {
      entity: type,
      name: `${label} Test Organization`,
      website: `https://${type}-test.example.com`,
      industry: 'Technology',
    } as any);

    console.log(`8. Org profile saved: ID = ${orgProfile._id}, entity = "${orgProfile.entity}", name = "${orgProfile.name}"`);
    if (orgProfile.entity !== type) {
      throw new Error(`Expected org entity "${type}", got "${orgProfile.entity}"`);
    }

    // Verify in DB
    const dbOrg = await RecruiterOrganizationModel.findOne({ ownerUserId: user._id });
    if (!dbOrg || dbOrg.entity !== type) {
      throw new Error(`DB RecruiterOrganization entity mismatch`);
    }
    console.log(`9. Verified RecruiterOrganizationModel in DB: entity = "${dbOrg.entity}"`);

    // Clean up test records
    await UserModel.deleteMany({ _id: user._id });
    await RecruiterOrganizationModel.deleteMany({ _id: orgProfile._id });
    console.log(`10. Cleaned up test records for ${label}.`);
  }

  // Scenario D & E: Regression check for standard Candidate registration
  console.log(`\n========================================`);
  console.log(`Testing Candidate Registration (Zero Regression Check)`);
  console.log(`========================================`);
  const candidateEmail = `candidate_${Date.now()}@test.com`;
  const candidateUsername = `cand_${Date.now()}`;
  await authService.sendEmailOtp(candidateEmail);
  const candRes = await authService.verifyEmailOtpAndCreateUser({
    email: candidateEmail,
    username: candidateUsername,
    password: 'Password123!',
    confirmPassword: 'Password123!',
    otp: '123456',
    role: 'user',
  });
  console.log(`Candidate created with ID: ${candRes.user._id}, role: "${candRes.user.role}", entityType: "${candRes.user.entityType}"`);
  if (candRes.user.role !== 'user' || candRes.user.entityType !== undefined) {
    throw new Error('Candidate role or entityType corrupted!');
  }
  await UserModel.deleteMany({ _id: candRes.user._id });
  console.log('Candidate regression check PASSED.');

  await mongoose.disconnect();
  console.log('\nAll automated tests PASSED successfully!');
}

runTests().catch((err) => {
  console.error('Test FAILED:', err);
  process.exit(1);
});
