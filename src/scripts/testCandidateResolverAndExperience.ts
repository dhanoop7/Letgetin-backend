import { ExperienceCalculator } from '../modules/profile/experienceCalculator.js';
import { CandidateDataResolver, IResolvedCandidateData } from '../modules/profile/candidateDataResolver.js';

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passedCount++;
  } else {
    console.error(`  ❌ FAIL: ${testName} - ${detail || 'Assertion failed'}`);
    failedCount++;
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 PHASE 1: CANDIDATE RESOLVER & EXPERIENCE CALCULATION TESTS');
  console.log('================================================================\n');

  // ============================================================================
  // PART 1: EXPERIENCE CALCULATION TESTS
  // ============================================================================
  console.log('--- 1. Experience Calculation Tests ---');

  // 1. Fresher = 0
  const fresherResult = ExperienceCalculator.calculateTotalExperience(
    [{ startDate: '2022-01-01', endDate: '2024-01-01' }],
    true
  );
  assert(fresherResult.totalMonths === 0 && fresherResult.totalYears === 0, '1. Fresher candidate returns 0 experience regardless of entries');

  // 2. One 2-year experience = approximately 2 years
  const twoYearResult = ExperienceCalculator.calculateTotalExperience([
    { startDate: '2022-01-01', endDate: '2023-12-31' },
  ]);
  assert(
    twoYearResult.totalMonths === 24 && Math.abs(twoYearResult.totalYears - 2.0) <= 0.1,
    '2. Single 2-year experience yields ~24 months / 2.0 years',
    `Expected 24 mos / 2.0 yrs, got ${twoYearResult.totalMonths} mos / ${twoYearResult.totalYears} yrs`
  );

  // 3. Multiple sequential jobs (2 yrs + 2 yrs = 4 yrs)
  const sequentialResult = ExperienceCalculator.calculateTotalExperience([
    { startDate: '2020-01-01', endDate: '2021-12-31' },
    { startDate: '2022-01-01', endDate: '2023-12-31' },
  ]);
  assert(
    sequentialResult.totalMonths === 48 && sequentialResult.totalYears === 4.0,
    '3. Multiple sequential jobs sum accurately (48 mos / 4.0 yrs)',
    `Expected 48 mos / 4.0 yrs, got ${sequentialResult.totalMonths} mos / ${sequentialResult.totalYears} yrs`
  );

  // 4. Overlapping jobs (2022-2024 and 2023-2025 -> merged 2022-2025 = 4 years, NOT 6 years)
  const overlappingResult = ExperienceCalculator.calculateTotalExperience([
    { startDate: '2022-01-01', endDate: '2024-12-31' }, // 3 years
    { startDate: '2023-01-01', endDate: '2025-12-31' }, // 3 years
  ]);
  assert(
    overlappingResult.totalMonths === 48 && overlappingResult.totalYears === 4.0,
    '4. Overlapping jobs merge without double counting (48 mos / 4.0 yrs, not 72 mos / 6.0 yrs)',
    `Expected 48 mos / 4.0 yrs, got ${overlappingResult.totalMonths} mos / ${overlappingResult.totalYears} yrs`
  );

  // 5. Current ongoing job
  const now = new Date();
  const currentResult = ExperienceCalculator.calculateTotalExperience([
    { startDate: new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1)), isCurrent: true },
  ]);
  assert(
    currentResult.totalMonths >= 12 && currentResult.totalYears >= 1.0,
    '5. Ongoing job with isCurrent: true calculates up to current date',
    `Got ${currentResult.totalMonths} mos / ${currentResult.totalYears} yrs`
  );

  // 6. Missing end date (inferred as present position)
  const missingEndResult = ExperienceCalculator.calculateTotalExperience([
    { startDate: new Date(Date.UTC(now.getUTCFullYear() - 2, now.getUTCMonth(), 1)) },
  ]);
  assert(
    missingEndResult.totalMonths >= 24 && missingEndResult.totalYears >= 2.0,
    '6. Position with missing end date is treated as active position up to now',
    `Got ${missingEndResult.totalMonths} mos / ${missingEndResult.totalYears} yrs`
  );

  // 7. Missing / invalid dates
  const invalidDateResult = ExperienceCalculator.calculateTotalExperience([
    { startDate: 'not-a-valid-date', endDate: 'also-invalid' },
    { startDate: null, endDate: null },
  ]);
  assert(
    invalidDateResult.totalMonths === 0 && invalidDateResult.totalYears === 0,
    '7. Invalid or missing dates handled safely without throwing or inventing experience'
  );

  // 8. Multiple short experiences (e.g. 3 mos + 4 mos non-overlapping = 7 mos)
  const shortExpResult = ExperienceCalculator.calculateTotalExperience([
    { startDate: '2023-01-01', endDate: '2023-03-31' }, // 3 mos
    { startDate: '2023-06-01', endDate: '2023-09-30' }, // 4 mos
  ]);
  assert(
    shortExpResult.totalMonths === 7 && shortExpResult.totalYears === 0.6,
    '8. Multiple short experiences compute exact sum in months (7 mos / 0.6 yrs)',
    `Got ${shortExpResult.totalMonths} mos / ${shortExpResult.totalYears} yrs`
  );

  // 9. No experience entries
  const emptyExpResult = ExperienceCalculator.calculateTotalExperience([]);
  assert(
    emptyExpResult.totalMonths === 0 && emptyExpResult.totalYears === 0,
    '9. Empty experience array returns 0 months and 0 years'
  );

  // 10. Does NOT use experiences.length * 2
  const fiveShortJobsResult = ExperienceCalculator.calculateTotalExperience([
    { startDate: '2023-01-01', endDate: '2023-01-31' },
    { startDate: '2023-03-01', endDate: '2023-03-31' },
    { startDate: '2023-05-01', endDate: '2023-05-31' },
    { startDate: '2023-07-01', endDate: '2023-07-31' },
    { startDate: '2023-09-01', endDate: '2023-09-30' },
  ]);
  // 5 jobs of 1 month = 5 months (~0.4 years). If it were length * 2, it would have been 10 years!
  assert(
    fiveShortJobsResult.totalYears < 1.0 && fiveShortJobsResult.totalYears !== 10,
    '10. Five 1-month jobs yields ~0.4 years, NOT 10 years from flawed length * 2 heuristic',
    `Got ${fiveShortJobsResult.totalYears} yrs`
  );

  // ============================================================================
  // PART 2: SKILLS RESOLUTION & DEDUPLICATION TESTS
  // ============================================================================
  console.log('\n--- 2. Skills Resolution Tests ---');

  // 1. Profile-only skills
  const profileOnlySkills = CandidateDataResolver.resolve({
    userProfile: { skills: ['Docker', 'Kubernetes'] },
  });
  assert(
    profileOnlySkills.skills.length === 2 &&
    profileOnlySkills.skills.includes('Docker') &&
    profileOnlySkills.skills.includes('Kubernetes'),
    '1. Resolves profile-only skills correctly'
  );

  // 2. Resume-only skills
  const resumeOnlySkills = CandidateDataResolver.resolve({
    resume: { content: { skills: ['Go', 'Rust'] } },
  });
  assert(
    resumeOnlySkills.skills.length === 2 &&
    resumeOnlySkills.skills.includes('Go') &&
    resumeOnlySkills.skills.includes('Rust'),
    '2. Resolves resume-only skills correctly'
  );

  // 3. Same skill in both sources (no double counting)
  const bothSkills = CandidateDataResolver.resolve({
    userProfile: { skills: ['React', 'TypeScript'] },
    resume: { content: { skills: ['React', 'Node.js', 'TypeScript'] } },
  });
  assert(
    bothSkills.skills.length === 3 &&
    bothSkills.skills.filter((s) => s.toLowerCase() === 'react').length === 1 &&
    bothSkills.skills.filter((s) => s.toLowerCase() === 'typescript').length === 1 &&
    bothSkills.skills.includes('Node.js'),
    '3. Combines skills from profile and resume without duplicates or double credit'
  );

  // 4. Different casing normalization
  const caseDiffSkills = CandidateDataResolver.resolve({
    userProfile: { skills: ['python', 'REACT'] },
    resume: { content: { skills: ['Python', 'React'] } },
  });
  assert(
    caseDiffSkills.skills.length === 2,
    '4. Normalizes casing and deduplicates case-insensitively',
    `Expected 2 skills, got ${caseDiffSkills.skills.length}: [${caseDiffSkills.skills.join(', ')}]`
  );

  // 5. Empty skills
  const emptySkills = CandidateDataResolver.resolve({});
  assert(
    emptySkills.skills.length === 0,
    '5. Empty candidate produces empty skills array'
  );

  // 6. No hardcoded tech fallback
  const noFallback = CandidateDataResolver.resolve({
    user: { fullName: 'No Skills Candidate', email: 'test@example.com' },
  });
  assert(
    noFallback.skills.length === 0 &&
    !noFallback.skills.includes('React') &&
    !noFallback.skills.includes('TypeScript'),
    '6. Candidate with no skills does NOT receive hardcoded tech fallback skills'
  );

  // 7. Resume skill metadata preserved
  const metadataSkills = CandidateDataResolver.resolve({
    resume: {
      content: {
        skills: [
          { name: 'TypeScript', category: 'Language', level: 5 },
          { name: 'PostgreSQL', category: 'Database', level: 4 },
        ],
      },
    },
  });
  const tsDetailed = metadataSkills.detailedSkills.find((s) => s.name === 'TypeScript');
  assert(
    tsDetailed !== undefined &&
    tsDetailed.category === 'Language' &&
    tsDetailed.level === 5,
    '7. Resume skill metadata (category, level) is preserved in detailedSkills'
  );

  // ============================================================================
  // PART 3: EDUCATION RESOLUTION TESTS
  // ============================================================================
  console.log('\n--- 3. Education Resolution Tests ---');

  // 1. Profile education only
  const profileEdu = CandidateDataResolver.resolve({
    userProfile: {
      educationsList: [{ institution: 'Stanford', degree: 'B.S.', startYear: 2018, endYear: 2022 }],
    },
  });
  assert(
    profileEdu.educations.length === 1 &&
    profileEdu.educations[0].institution === 'Stanford' &&
    profileEdu.educations[0].degree === 'B.S.',
    '1. Resolves profile education list'
  );

  // 2. Resume education only
  const resumeEdu = CandidateDataResolver.resolve({
    resume: {
      content: {
        educations: [{ institution: 'MIT', degree: 'M.S.', fieldOfStudy: 'AI', gradeScore: '3.9' }],
      },
    },
  });
  assert(
    resumeEdu.educations.length === 1 &&
    resumeEdu.educations[0].institution === 'MIT' &&
    resumeEdu.educations[0].fieldOfStudy === 'AI' &&
    resumeEdu.educations[0].gradeScore === '3.9',
    '2. Resolves resume education with rich fields (fieldOfStudy, gradeScore)'
  );

  // 3. Both profile and resume (merged and deduplicated)
  const bothEdu = CandidateDataResolver.resolve({
    userProfile: {
      educationsList: [
        { institution: 'MIT', degree: 'M.S.', certificateUrl: 'https://verify.mit.edu/123' },
        { institution: 'Stanford', degree: 'B.S.' },
      ],
    },
    resume: {
      content: {
        educations: [
          { institution: 'MIT', degree: 'M.S.', fieldOfStudy: 'Computer Science' },
        ],
      },
    },
  });
  assert(
    bothEdu.educations.length === 2 &&
    bothEdu.educations.some((e) => e.institution === 'MIT' && e.certificateUrl === 'https://verify.mit.edu/123'),
    '3. Merges duplicate education entries and enriches with profile certificateUrl'
  );

  // 4. Missing education
  const missingEdu = CandidateDataResolver.resolve({});
  assert(
    Array.isArray(missingEdu.educations) && missingEdu.educations.length === 0,
    '4. Candidate without education returns clean empty array'
  );

  // ============================================================================
  // PART 4: FULL CANDIDATE RESOLUTION & PRECEDENCE RULES
  // ============================================================================
  console.log('\n--- 4. Full Candidate Resolution & Precedence Tests ---');

  const fullCandidate = CandidateDataResolver.resolve({
    userId: 'user_12345',
    user: {
      fullName: 'Base User Full Name',
      email: 'base@example.com',
      phone: '+1-555-0100',
    },
    userProfile: {
      contact: {
        fullName: 'Profile Authoritative Name',
        email: 'profile@example.com',
        city: 'Bangalore',
        country: 'India',
      },
      personal: {
        headline: 'Lead Cloud Architect',
        bio: 'Passionate about distributed cloud systems.',
      },
      skills: ['Docker', 'AWS', 'Kubernetes'],
      experiencesList: [
        { company: 'Google', title: 'Staff SRE', start: '2021-01-01', end: '2023-12-31' },
      ],
    },
    resume: {
      content: {
        personalInfo: {
          fullName: 'Resume Name',
          headline: 'Resume Headline',
          location: 'Old Resume Location',
        },
        skills: [
          { name: 'AWS', category: 'Cloud', level: 5 },
          { name: 'Terraform', category: 'DevOps', level: 4 },
        ],
        experiences: [
          { company: 'Google', position: 'Staff SRE', startDate: '2021-01-01', endDate: '2023-12-31' },
          { company: 'Meta', position: 'Senior Infrastructure Engineer', startDate: '2019-01-01', endDate: '2020-12-31' },
        ],
        projects: [
          {
            title: 'CloudMesh Engine',
            highlights: ['Multi-region traffic router', 'Sub-millisecond latency'],
            technologies: ['Go', 'eBPF', 'Rust'],
          },
        ],
      },
    },
  });

  // Verify Identity & Contact Precedence
  assert(
    fullCandidate.fullName === 'Profile Authoritative Name',
    'Precedence: Profile contact.fullName overrides user and resume personalInfo'
  );
  assert(
    fullCandidate.email === 'profile@example.com',
    'Precedence: Profile contact.email overrides base user email'
  );
  assert(
    fullCandidate.location === 'Bangalore, India',
    'Precedence: Profile contact city/country overrides resume location'
  );
  assert(
    fullCandidate.headline === 'Lead Cloud Architect',
    'Precedence: Profile personal.headline overrides resume headline'
  );

  // Verify Skills
  assert(
    fullCandidate.skills.includes('Docker') &&
    fullCandidate.skills.includes('AWS') &&
    fullCandidate.skills.includes('Kubernetes') &&
    fullCandidate.skills.includes('Terraform') &&
    fullCandidate.skills.length === 4,
    'Skills: Correct union of profile and resume skills without duplicate AWS'
  );

  // Verify Experience (2019-2020: 24 mos + 2021-2023: 36 mos = 60 mos / 5.0 yrs)
  assert(
    fullCandidate.totalExperienceMonths === 60 && fullCandidate.totalExperienceYears === 5.0,
    'Experience: Merges Google & Meta into 60 non-overlapping months / 5.0 years',
    `Got ${fullCandidate.totalExperienceMonths} mos / ${fullCandidate.totalExperienceYears} yrs`
  );

  // Verify Projects
  assert(
    fullCandidate.projects.length === 1 &&
    fullCandidate.projects[0].title === 'CloudMesh Engine' &&
    fullCandidate.projects[0].technologies.includes('eBPF'),
    'Projects: Extracted rich projects from resume without manual profile input requirement'
  );

  // Verify Embedding Helpers
  const embeddingPayload = CandidateDataResolver.toEmbeddingPayload(fullCandidate);
  assert(
    embeddingPayload.personalInfo.fullName === 'Profile Authoritative Name' &&
    embeddingPayload.skills.length === 4 &&
    embeddingPayload.experiences.length === 2 &&
    embeddingPayload.projects.length === 1,
    'Embedding payload helper formats complete composite structure accurately'
  );

  // Summary
  console.log('\n================================================================');
  console.log(`📊 TEST RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
