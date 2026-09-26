import mongoose, { Types } from 'mongoose';
import { connectDatabase } from '../config/database.js';
import { JobModel, IJobSkillRequirement, SkillRequirementArray } from '../modules/job/job.model.js';
import {
  normalizeSkillRequirement,
  normalizeSkillRequirementsList,
  normalizeSkillsList,
  resolveRequiredAndPreferredSkills,
  normalizeJobRequirements,
} from '../modules/job/jobRequirements.utils.js';
import {
  structuredRequirementsSchema,
  createJobSchema,
  skillProficiencySchema,
  jobSkillRequirementSchema,
} from '../modules/job/job.validator.js';
import { jobService } from '../modules/job/job.service.js';
import { embeddingService } from '../modules/embedding/embedding.service.js';

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

async function runJobSkillProficiencyTests() {
  console.log('================================================================');
  console.log('🧪 JOB SKILL PROFICIENCY ENHANCEMENT TEST SUITE');
  console.log('================================================================\n');

  // ============================================================================
  // A. SKILL NORMALIZATION & TRIMMING
  // ============================================================================
  console.log('--- A. Skill Normalization & Trimming ---');

  const normalizedTrimmed = normalizeSkillRequirement('   Java   ');
  assert(
    normalizedTrimmed?.name === 'Java' && normalizedTrimmed?.proficiency === 'intermediate',
    'A.1 "  Java  " trimmed to "Java" with default "intermediate" proficiency'
  );

  const normalizedObject = normalizeSkillRequirement({ name: '  Spring Boot  ', proficiency: 'advanced' });
  assert(
    normalizedObject?.name === 'Spring Boot' && normalizedObject?.proficiency === 'advanced',
    'A.2 Structured object name trimmed and proficiency preserved'
  );

  const emptySkill = normalizeSkillRequirement('    ');
  assert(emptySkill === null, 'A.3 Whitespace-only string returns null');

  const emptyObjSkill = normalizeSkillRequirement({ name: '   ', proficiency: 'expert' });
  assert(emptyObjSkill === null, 'A.4 Object with whitespace-only name returns null');

  // ============================================================================
  // B. CASE-INSENSITIVE DUPLICATE DETECTION & CASING PRESERVATION
  // ============================================================================
  console.log('\n--- B. Case-Insensitive Duplicate Detection ---');

  const dedupedSkills = normalizeSkillRequirementsList(['Java', 'java', 'JAVA']);
  assert(
    dedupedSkills.length === 1 && dedupedSkills[0].name === 'Java',
    'B.1 "Java", "java", "JAVA" resolves to exactly one skill preserving first casing'
  );

  const dedupedStructured = normalizeSkillRequirementsList([
    { name: 'TypeScript', proficiency: 'advanced' },
    { name: 'typescript', proficiency: 'intermediate' },
    { name: 'TYPESCRIPT', proficiency: 'expert' },
  ]);
  assert(
    dedupedStructured.length === 1 &&
      dedupedStructured[0].name === 'TypeScript' &&
      dedupedStructured[0].proficiency === 'advanced',
    'B.2 Structured duplicate skills deduplicate and preserve first seen proficiency and casing'
  );

  // ============================================================================
  // C. PROFICIENCY VALIDATION (ZOD)
  // ============================================================================
  console.log('\n--- C. Proficiency Validation (Zod) ---');

  const validProficiencies = ['beginner', 'intermediate', 'advanced', 'expert'];
  for (const prof of validProficiencies) {
    const parseRes = skillProficiencySchema.safeParse(prof);
    assert(parseRes.success, `C.1 Valid proficiency accepted: "${prof}"`);
  }

  const invalidProficiencies = ['novice', 'master', 'guru', '5', '', 123, null, undefined];
  for (const invalid of invalidProficiencies) {
    const parseRes = skillProficiencySchema.safeParse(invalid);
    assert(!parseRes.success, `C.2 Invalid proficiency rejected: "${invalid}"`);
  }

  // Zod structured schema rejection for invalid proficiency
  const invalidStructuredParse = structuredRequirementsSchema.safeParse({
    requiredSkills: [{ name: 'Java', proficiency: 'master' }],
  });
  assert(!invalidStructuredParse.success, 'C.3 structuredRequirementsSchema rejects invalid proficiency "master"');

  const nullProficiencyParse = structuredRequirementsSchema.safeParse({
    requiredSkills: [{ name: 'Java', proficiency: null }],
  });
  assert(!nullProficiencyParse.success, 'C.4 structuredRequirementsSchema rejects null proficiency');

  const validStructuredParse = structuredRequirementsSchema.safeParse({
    requiredSkills: [
      { name: 'Java', proficiency: 'advanced' },
      { name: 'Spring Boot', proficiency: 'advanced' },
      { name: 'PostgreSQL', proficiency: 'intermediate' },
    ],
    preferredSkills: [
      'AWS',
      'Docker',
    ],
  });
  assert(validStructuredParse.success, 'C.5 structuredRequirementsSchema accepts valid structured required skills with proficiencies and preferred skills as strings');

  // Preferred skills without proficiency
  const prefNoProfParse = structuredRequirementsSchema.safeParse({
    requiredSkills: [{ name: 'Java', proficiency: 'advanced' }],
    preferredSkills: [' AWS '],
  });
  assert(prefNoProfParse.success, 'C.6 Preferred skills validation succeeds without proficiency');

  // ============================================================================
  // D. LEGACY COMPATIBILITY
  // ============================================================================
  console.log('\n--- D. Legacy Compatibility ---');

  const legacyNormalized = normalizeSkillRequirementsList(['Java', 'Spring Boot']);
  assert(
    legacyNormalized.length === 2 &&
      legacyNormalized[0].name === 'Java' &&
      legacyNormalized[0].proficiency === 'intermediate' &&
      legacyNormalized[1].name === 'Spring Boot' &&
      legacyNormalized[1].proficiency === 'intermediate',
    'D.1 Legacy string array normalized with default "intermediate" proficiency'
  );

  // SkillRequirementArray .includes() method compatibility
  assert(
    legacyNormalized.includes('Java'),
    'D.2 legacyNormalized.includes("Java") returns true via SkillRequirementArray'
  );
  assert(
    legacyNormalized.includes('java'),
    'D.3 legacyNormalized.includes("java") case-insensitive lookup returns true'
  );
  assert(
    !legacyNormalized.includes('Python'),
    'D.4 legacyNormalized.includes("Python") returns false'
  );

  // Plain string list extractor for legacy consumers
  const plainStringSkills = normalizeSkillsList(legacyNormalized);
  assert(
    plainStringSkills.length === 2 && plainStringSkills[0] === 'Java' && plainStringSkills[1] === 'Spring Boot',
    'D.5 normalizeSkillsList extracts plain string[] from structured IJobSkillRequirement[]'
  );

  // ============================================================================
  // E. NEW STRUCTURED SKILLS RESOLUTION
  // ============================================================================
  console.log('\n--- E. New Structured Skills Input Resolution ---');

  const jobReqs = normalizeJobRequirements({
    requiredSkills: [
      { name: 'Java', proficiency: 'advanced' },
      { name: 'Spring Boot', proficiency: 'advanced' },
      { name: 'PostgreSQL', proficiency: 'intermediate' },
    ],
    preferredSkills: [
      ' AWS ',
      'Kubernetes',
    ],
  });

  assert(jobReqs.requiredSkills.length === 3, 'E.1 Required skills count is 3');
  assert(jobReqs.requiredSkills[0].name === 'Java' && jobReqs.requiredSkills[0].proficiency === 'advanced', 'E.2 Java is advanced');
  assert(jobReqs.requiredSkills[1].name === 'Spring Boot' && jobReqs.requiredSkills[1].proficiency === 'advanced', 'E.3 Spring Boot is advanced');
  assert(jobReqs.requiredSkills[2].name === 'PostgreSQL' && jobReqs.requiredSkills[2].proficiency === 'intermediate', 'E.4 PostgreSQL is intermediate');
  assert(jobReqs.preferredSkills.length === 2, 'E.5 Preferred skills count is 2');
  assert(jobReqs.preferredSkills[0] === 'AWS', 'E.6 Preferred skill " AWS " trimmed and normalized to "AWS" without proficiency');
  assert(jobReqs.preferredSkills[1] === 'Kubernetes', 'E.7 Kubernetes is normalized without proficiency');

  // E.8 Duplicate handling for preferred skills (AWS, aws, AWS -> one skill)
  const dedupedJobReqs = normalizeJobRequirements({
    requiredSkills: [],
    preferredSkills: ['AWS', 'aws', 'AWS'],
  });
  assert(
    dedupedJobReqs.preferredSkills.length === 1 && dedupedJobReqs.preferredSkills[0] === 'AWS',
    'E.8 Preferred skill duplicates (AWS, aws, AWS) deduplicated to one skill'
  );

  // ============================================================================
  // F. REQUIRED VS PREFERRED CONFLICT RESOLUTION
  // ============================================================================
  console.log('\n--- F. Required vs Preferred Conflict Resolution ---');

  const conflictResolved = resolveRequiredAndPreferredSkills(
    [
      { name: 'Java', proficiency: 'advanced' },
      { name: 'PostgreSQL', proficiency: 'intermediate' },
    ],
    [
      'java', // conflict! should be dropped
      'Docker',
    ]
  );

  assert(
    conflictResolved.requiredSkills.length === 2 &&
      conflictResolved.requiredSkills[0].name === 'Java' &&
      conflictResolved.requiredSkills[0].proficiency === 'advanced',
    'F.1 Required skill Java (advanced) retains precedence'
  );
  assert(
    conflictResolved.preferredSkills.length === 1 && conflictResolved.preferredSkills[0] === 'Docker',
    'F.2 Conflicting skill "java" removed from preferredSkills'
  );

  // ============================================================================
  // G. JOB EMBEDDING TEXT FORMATTING WITH PROFICIENCY
  // ============================================================================
  console.log('\n--- G. Job Embedding Text With Proficiency ---');

  const embeddingText = embeddingService.buildJobEmbeddingText({
    title: 'Senior Java Engineer',
    company: { name: 'Acme Cloud' },
    structuredRequirements: {
      requiredSkills: [
        { name: 'Java', proficiency: 'advanced' } as any,
        { name: 'Spring Boot', proficiency: 'advanced' } as any,
        { name: 'PostgreSQL', proficiency: 'intermediate' } as any,
      ],
      preferredSkills: [
        'AWS',
        'Docker',
      ],
    },
  });

  assert(
    embeddingText.includes('Required Skills:\n- Java (Advanced)\n- Spring Boot (Advanced)\n- PostgreSQL (Intermediate)'),
    'G.1 Embedding text includes required skills with capitalized proficiencies'
  );
  assert(
    embeddingText.includes('Preferred Skills:\n- AWS\n- Docker') &&
      !embeddingText.includes('AWS (Intermediate)') &&
      !embeddingText.includes('Docker (Beginner)'),
    'G.2 Embedding text includes preferred skills as skill-only without proficiency'
  );

  // ============================================================================
  // H. DATABASE PERSISTENCE VIA JOB SERVICE
  // ============================================================================
  console.log('\n--- H. Database Persistence & Recruiter Job Creation ---');

  const createdJobIds: Types.ObjectId[] = [];

  try {
    await connectDatabase();
    const testRecruiterId = new Types.ObjectId().toString();

    const createdJob = await jobService.createRecruiterJob(testRecruiterId, {
      title: 'Senior Backend Architect',
      description: 'Design and implement distributed event-driven systems.',
      location: 'Bangalore, India',
      employmentType: 'full-time',
      workplaceType: 'hybrid',
      salaryText: '₹35L - ₹50L',
      structuredRequirements: {
        requiredSkills: [
          { name: 'Java', proficiency: 'advanced' },
          { name: 'Spring Boot', proficiency: 'advanced' },
          { name: 'Kafka', proficiency: 'intermediate' },
        ],
        preferredSkills: [
          'Kubernetes',
          'GCP',
        ],
        minimumExperienceYears: 6,
        maximumExperienceYears: 12,
      },
    });

    createdJobIds.push(createdJob._id as Types.ObjectId);

    const fetched = await JobModel.findById(createdJob._id).lean();
    assert(!!fetched, 'H.1 Job persisted to MongoDB');

    const storedStructured = fetched?.structuredRequirements;
    assert(storedStructured?.requiredSkills?.length === 3, 'H.2 Stored requiredSkills count is 3');
    assert(
      (storedStructured?.requiredSkills?.[0] as any)?.name === 'Java' &&
        (storedStructured?.requiredSkills?.[0] as any)?.proficiency === 'advanced',
      'H.3 Stored Java proficiency is "advanced"'
    );
    assert(
      (storedStructured?.requiredSkills?.[2] as any)?.name === 'Kafka' &&
        (storedStructured?.requiredSkills?.[2] as any)?.proficiency === 'intermediate',
      'H.4 Stored Kafka proficiency is "intermediate"'
    );
    assert(storedStructured?.preferredSkills?.length === 2, 'H.5 Stored preferredSkills count is 2');
    assert(
      storedStructured?.preferredSkills?.[0] === 'Kubernetes' &&
        storedStructured?.preferredSkills?.[1] === 'GCP',
      'H.6 Stored preferred skills are plain strings without proficiency'
    );

    // Verify backward compatibility: combined legacy skills: string[] field
    assert(
      Array.isArray(fetched?.skills) &&
        fetched.skills.includes('Java') &&
        fetched.skills.includes('Spring Boot') &&
        fetched.skills.includes('Kafka') &&
        fetched.skills.includes('Kubernetes') &&
        fetched.skills.includes('GCP'),
      'H.7 Legacy skills: string[] field automatically populated with skill names'
    );

    // Verify existing legacy jobs with object preferred skills remain readable
    const legacyJob = await JobModel.create({
      title: 'Legacy Architect Role',
      company: { name: 'Legacy Corp' },
      description: 'Legacy job with object preferred skills',
      structuredRequirements: {
        requiredSkills: [{ name: 'Java', proficiency: 'advanced' }],
        preferredSkills: [{ name: 'AWS', proficiency: 'intermediate' }] as any,
      },
    });
    createdJobIds.push(legacyJob._id as Types.ObjectId);
    const fetchedLegacy = await JobModel.findById(legacyJob._id).lean();
    assert(!!fetchedLegacy, 'H.8 Existing legacy job with object preferred skills loads successfully');
    const legacyEmbedding = embeddingService.buildJobEmbeddingText(fetchedLegacy!);
    assert(
      legacyEmbedding.includes('Preferred Skills:\n- AWS') && !legacyEmbedding.includes('AWS (Intermediate)'),
      'H.9 Existing legacy preferred skills format as skill-only without proficiency in embeddings'
    );

  } catch (err: any) {
    console.error('Database test error:', err.message);
    assert(false, 'H. Database test execution', err.message);
  } finally {
    if (createdJobIds.length > 0) {
      console.log('🧹 Cleaning up test database records...');
      await JobModel.deleteMany({ _id: { $in: createdJobIds } });
    }
    await mongoose.disconnect();
    console.log('Database disconnected. Tests finished.\n');
  }

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('================================================================');
  console.log(`Job Skill Proficiency Test Results: ${passedCount} passed, ${failedCount} failed`);
  console.log('================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runJobSkillProficiencyTests().catch((err) => {
  console.error('Unhandled error in test runner:', err);
  process.exit(1);
});
