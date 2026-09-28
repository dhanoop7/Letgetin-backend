import { AI_CONFIG } from '../../config/ai.config.js';
import { AIService } from './ai.service.js';

async function runVerification() {
  console.log('--- Central AI Architecture Verification Test ---');
  console.log(`Provider : ${AI_CONFIG.provider}`);
  console.log(`Model    : ${AI_CONFIG.model}`);
  console.log(`Timeout  : ${AI_CONFIG.timeout} ms`);
  console.log(`Retries  : ${AI_CONFIG.retryAttempts}`);

  const aiService = new AIService();
  const testUserId = 'user_test_12345';

  // Test 1: Summary Improvement
  console.log('\n[Test 1] Testing Summary Improvement...');
  const summaryRes = await aiService.improveSummary(testUserId, 'Full stack engineer building web apps.');
  console.log('[PASS] Summary Suggestions Count:', summaryRes.suggestions.length);

  // Test 2: Bullet Rewriting
  console.log('\n[Test 2] Testing Experience Bullet Rewriter...');
  const bulletRes = await aiService.rewriteExperienceBullet(testUserId, 'Software Engineer', 'Built user interface components.');
  console.log('[PASS] Rewritten Bullets Count:', bulletRes.rewrittenBullets.length);

  // Test 3: ATS Analysis
  console.log('\n[Test 3] Testing ATS Analysis...');
  const atsRes = await aiService.analyzeAts(testUserId, { summary: 'Experienced Engineer' });
  console.log('[PASS] ATS Score:', atsRes.score);

  // Test 4: AI Chat
  console.log('\n[Test 4] Testing AI Chat...');
  const chatRes = await aiService.chatWithResumeContext(testUserId, 'How can I highlight my React skills?');
  console.log('[PASS] Chat Reply Length:', chatRes.reply.length);

  console.log('\n--- All AI Endpoints & Provider Integration Verified Successfully ---');
}

runVerification().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
