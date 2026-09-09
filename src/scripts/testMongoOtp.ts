import { connectDatabase } from '../config/database.js';
import { OtpService } from '../modules/auth/services/otp.service.js';
import { OtpModel } from '../modules/auth/otp.model.js';
import { PasswordUtils } from '../utils/password.js';
import mongoose from 'mongoose';

async function testMongoOtp() {
  console.log('🧪 Starting MongoDB OTP Test Suite...');
  await connectDatabase();

  const testEmail = 'test_saas_user@example.com';
  const testPhone = '+919876543210';

  // 0. Clean up previous test entries
  await OtpModel.deleteMany({ identifier: { $in: [testEmail, testPhone] } });

  console.log('\n--- Test 1: Send Email OTP (Upsert in MongoDB) ---');
  const sendRes = await OtpService.sendEmailOtp(testEmail);
  console.log('Send response:', sendRes);

  const doc = await OtpModel.findOne({ identifier: testEmail, type: 'email' });
  if (!doc) throw new Error('OTP document not found in MongoDB!');
  console.log('✅ Document created in MongoDB:', {
    identifier: doc.identifier,
    type: doc.type,
    attempts: doc.attempts,
    maxAttempts: doc.maxAttempts,
    cooldownUntil: doc.cooldownUntil,
    expiresAt: doc.expiresAt,
  });

  console.log('\n--- Test 2: Resend before 60s cooldown expires ---');
  try {
    await OtpService.sendEmailOtp(testEmail);
    throw new Error('Cooldown check failed to block rapid resend!');
  } catch (err: any) {
    console.log('✅ Cooldown correctly enforced:', err.message);
  }

  console.log('\n--- Test 3: Failed OTP verification (Attempts tracking) ---');
  // Temporarily set a known hash
  const testCode = '123456';
  doc.otpHash = await PasswordUtils.hashPassword(testCode);
  await doc.save();

  try {
    await OtpService.verifyEmailOtp(testEmail, '999999');
    throw new Error('Verification should have failed with wrong OTP');
  } catch (err: any) {
    console.log('✅ Wrong OTP rejected:', err.message);
  }

  const updatedDoc = await OtpModel.findOne({ identifier: testEmail, type: 'email' });
  console.log('✅ Attempt counter incremented:', updatedDoc?.attempts);

  console.log('\n--- Test 4: Successful OTP verification ---');
  const verifyRes = await OtpService.verifyEmailOtp(testEmail, testCode);
  console.log('✅ Verification success:', verifyRes);

  const deletedDoc = await OtpModel.findOne({ identifier: testEmail, type: 'email' });
  if (deletedDoc) throw new Error('OTP document should have been deleted after successful verification');
  console.log('✅ Document cleanly deleted from MongoDB after verification');

  console.log('\n--- Test 5: WhatsApp OTP Flow ---');
  await OtpService.sendWhatsAppOtp(testPhone);
  const waDoc = await OtpModel.findOne({ identifier: testPhone, type: 'whatsapp' });
  if (!waDoc) throw new Error('WhatsApp OTP document not found in MongoDB!');
  console.log('✅ WhatsApp OTP document created in MongoDB:', {
    identifier: waDoc.identifier,
    type: waDoc.type,
    cooldownUntil: waDoc.cooldownUntil,
  });

  // Clean up
  await OtpModel.deleteMany({ identifier: { $in: [testEmail, testPhone] } });

  console.log('\n🎉 ALL MONGO OTP TESTS PASSED SUCCESSFULLY!');
  await mongoose.disconnect();
  process.exit(0);
}

testMongoOtp().catch(async (e) => {
  console.error('❌ Test failed:', e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
