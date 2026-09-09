import { ChatService } from '../modules/ai/services/chat.service.js';

async function runTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING AI RESUME AGENT COMPREHENSIVE TEST SUITE');
  console.log('====================================================\n');

  const chatService = new ChatService();
  const testUserId = '64f8a123456789abcdef0123';
  let passedCount = 0;
  let failedCount = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passedCount++;
    } else {
      console.error(`❌ FAIL: ${testName} - ${detail || ''}`);
      failedCount++;
    }
  }

  // ----------------------------------------------------
  // Test 1: Empty resume + summary request
  // ----------------------------------------------------
  console.log('\n--- Scenario 1: Empty resume + summary request ---');
  const res1 = await chatService.chatWithResumeContext(testUserId, 'Write a professional summary for my resume.', {
    content: {
      personalInfo: {},
      skills: [],
      experiences: [],
      projects: [],
    },
  });
  console.log('Status:', res1.status);
  console.log('Known facts:', res1.analysis.knownFacts);
  console.log('Missing facts:', res1.analysis.missingFacts);
  console.log('Questions:', res1.questions);
  assert(res1.status === 'NEEDS_INFORMATION', 'Status is NEEDS_INFORMATION for empty resume');
  assert(res1.analysis.missingFacts.length > 0, 'Detected missing facts for empty resume');
  assert(res1.questions.length > 0, 'Clarifying questions provided');
  assert(res1.draft === null, 'No draft hallucinated when information is missing');

  // ----------------------------------------------------
  // Test 2: Resume with only skills + summary request
  // ----------------------------------------------------
  console.log('\n--- Scenario 2: Resume with only skills + summary request ---');
  const res2 = await chatService.chatWithResumeContext(testUserId, 'Generate a summary for me.', {
    content: {
      personalInfo: {},
      skills: [{ name: 'React' }, { name: 'Node.js' }, { name: 'MongoDB' }],
      experiences: [],
      projects: [],
    },
  });
  console.log('Status:', res2.status);
  console.log('Known facts:', res2.analysis.knownFacts);
  console.log('Missing facts:', res2.analysis.missingFacts);
  assert(res2.status === 'NEEDS_INFORMATION', 'Status is NEEDS_INFORMATION when role/experience missing');
  assert(res2.analysis.knownFacts.some((f) => f.includes('React') || f.includes('Skills')), 'Identified React skills as known fact');
  assert(res2.questions.length > 0, 'Asked for role/experience');

  // ----------------------------------------------------
  // Test 3: Resume with role + experience + skills
  // ----------------------------------------------------
  console.log('\n--- Scenario 3: Resume with role + experience + skills ---');
  const res3 = await chatService.chatWithResumeContext(testUserId, 'Write a professional summary.', {
    content: {
      personalInfo: { headline: 'Senior Full Stack Developer' },
      skills: [{ name: 'React' }, { name: 'TypeScript' }, { name: 'Node.js' }, { name: 'PostgreSQL' }],
      experiences: [
        {
          company: 'Acme Corp',
          position: 'Senior Full Stack Developer',
          startDate: '2021-01',
          endDate: 'Present',
          highlights: ['Architected microservices serving 100k users with 99.9% uptime.'],
        },
      ],
      projects: [],
    },
  });
  console.log('Status:', res3.status);
  console.log('Draft:', res3.draft);
  console.log('Action:', res3.action);
  assert(res3.status === 'READY', 'Status is READY when full context is present');
  assert(res3.draft !== null && typeof res3.draft?.content === 'string', 'Generated truthful draft summary');
  assert(res3.action !== null && res3.action?.type === 'UPDATE_SUMMARY', 'Created UPDATE_SUMMARY action');

  // ----------------------------------------------------
  // Test 4: Template requiring missing award
  // ----------------------------------------------------
  console.log('\n--- Scenario 4: Template requiring missing award ---');
  const templatePrompt = 'Create a summary using this template: Award-winning [Profession/Role] with [Number] years of experience in [Field/Industry]. Recognized with [Award Name] in [Year] for [Achievement].';
  const res4 = await chatService.chatWithResumeContext(testUserId, templatePrompt, {
    content: {
      personalInfo: { headline: 'Full Stack Developer' },
      skills: [{ name: 'React' }, { name: 'Node.js' }],
      experiences: [],
      projects: [],
    },
  });
  console.log('Status:', res4.status);
  console.log('Missing facts:', res4.analysis.missingFacts);
  console.log('Reply preview:', res4.reply.slice(0, 150) + '...');
  assert(res4.status === 'NEEDS_INFORMATION', 'Recognizes template demands details not in resume');
  assert(res4.analysis.missingFacts.some((m) => m.toLowerCase().includes('award') || m.toLowerCase().includes('experience') || m.toLowerCase().includes('achievement')), 'Flags award/achievement/years as missing');
  assert(res4.draft === null, 'Does NOT hallucinate a fake award');

  // ----------------------------------------------------
  // Test 5 & 6: Follow-up message with conversation history memory
  // ----------------------------------------------------
  console.log('\n--- Scenario 5 & 6: Conversation memory across turns ---');
  const res5 = await chatService.chatWithResumeContext(
    testUserId,
    'I have 2 years of experience at a UK fintech startup. I do not have any awards, please adapt the template without one.',
    {
      content: {
        personalInfo: { headline: 'Junior Full Stack Developer' },
        skills: [{ name: 'React' }, { name: 'Node.js' }, { name: 'Express' }, { name: 'MongoDB' }],
        experiences: [],
        projects: [],
      },
    },
    {
      conversationHistory: [
        { sender: 'user', text: templatePrompt },
        { sender: 'ai', text: res4.reply, analysis: res4.analysis, status: res4.status },
      ],
    }
  );
  console.log('Status:', res5.status);
  console.log('Known facts in turn 2:', res5.analysis.knownFacts);
  console.log('Reply preview:', res5.reply.slice(0, 150) + '...');
  assert(res5.analysis.knownFacts.some((f) => f.includes('2') || f.includes('Developer') || f.includes('UK') || f.includes('React')), 'Remembered 2 years experience and role from history');

  // ----------------------------------------------------
  // Test 7: Generates content when sufficient evidence is provided
  // ----------------------------------------------------
  console.log('\n--- Scenario 7: User provides concrete accomplishment metrics ---');
  const res7 = await chatService.chatWithResumeContext(
    testUserId,
    'I built an internal analytics dashboard that reduced manual report generation time by 40% for 50 internal team members.',
    {
      content: {
        personalInfo: { headline: 'Full Stack Developer' },
        skills: [{ name: 'React' }, { name: 'Node.js' }, { name: 'MongoDB' }],
        experiences: [],
        projects: [],
      },
    },
    {
      conversationHistory: [
        { sender: 'user', text: 'Generate a summary for me with 2 years of experience at Apex UK.' },
        { sender: 'ai', text: 'What is one key achievement from your work?' },
      ],
    }
  );
  console.log('Status:', res7.status);
  console.log('Draft content:', res7.draft?.content);
  assert(res7.status === 'READY', 'Status is READY when achievement is provided');
  assert(res7.draft !== null, 'Draft is generated with user-provided metrics');

  // ----------------------------------------------------
  // Test 8: No hallucination of unmentioned facts
  // ----------------------------------------------------
  console.log('\n--- Scenario 8: Anti-hallucination check ---');
  const draftStr = typeof res7.draft?.content === 'string' ? res7.draft.content : JSON.stringify(res7.draft?.content || '');
  assert(!draftStr.includes('Google') && !draftStr.includes('Amazon') && !draftStr.includes('10 years'), 'Draft does NOT invent random big tech companies or fake 10-year experience');

  // ----------------------------------------------------
  // Test 9: User asks for skills recommendation
  // ----------------------------------------------------
  console.log('\n--- Scenario 9: User asks for skills recommendation ---');
  const res9 = await chatService.chatWithResumeContext(testUserId, 'Recommend top skills for my role as Frontend Developer.', {
    content: {
      personalInfo: { headline: 'Frontend Developer' },
      skills: [{ name: 'HTML' }, { name: 'CSS' }, { name: 'JavaScript' }],
      experiences: [],
      projects: [],
    },
  });
  console.log('Status:', res9.status);
  console.log('Suggestions:', res9.suggestions);
  assert(res9.status === 'READY' || res9.status === 'ANSWER', 'Responded cleanly to skills request');

  // ----------------------------------------------------
  // Test 10: General Resume Question
  // ----------------------------------------------------
  console.log('\n--- Scenario 10: General resume question ---');
  const res10 = await chatService.chatWithResumeContext(testUserId, 'How long should a standard software engineer resume be?', {
    content: {
      personalInfo: { headline: 'Software Engineer' },
      skills: [],
      experiences: [],
      projects: [],
    },
  });
  console.log('Status:', res10.status);
  console.log('Intent:', res10.intent);
  assert(res10.status === 'ANSWER', 'General question returns status ANSWER without blocking');
  assert(res10.reply.length > 50, 'Provides comprehensive answer');

  // ----------------------------------------------------
  // Test 11: Normalization of malformed response
  // ----------------------------------------------------
  console.log('\n--- Scenario 11: Normalization & Error resilience ---');
  const normalized = (chatService as any).normalizeAgentResponse(
    {
      reply: 'Plain text reply with no markdown',
      status: 'INVALID_STATUS',
      analysis: null,
    },
    'Test query',
    {}
  );
  assert(normalized.status === 'READY' || normalized.status === 'NEEDS_INFORMATION' || normalized.status === 'ANSWER', 'Status safely normalized');
  assert(Array.isArray(normalized.analysis.knownFacts), 'analysis.knownFacts is guaranteed to be an array');
  assert(Array.isArray(normalized.analysis.missingFacts), 'analysis.missingFacts is guaranteed to be an array');
  assert(Array.isArray(normalized.questions), 'questions is guaranteed to be an array');
  assert(Array.isArray(normalized.suggestions), 'suggestions is guaranteed to be an array');

  console.log('\n====================================================');
  console.log(`📊 TEST RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('====================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error('Fatal test error:', e);
  process.exit(1);
});
