import mongoose, { Types } from 'mongoose';
import { connectDatabase } from '../config/database.js';
import { JobModel, formatEducationRequirements, EducationLevel } from '../modules/job/job.model.js';
import {
  normalizeSkillsList,
  resolveRequiredAndPreferredSkills,
  normalizeEducationLevel,
  normalizeJobRequirements,
} from '../modules/job/jobRequirements.utils.js';
import { structuredRequirementsSchema, createJobSchema } from '../modules/job/job.validator.js';
import { jobService } from '../modules/job/job.service.js';

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

async function runJobRequirementsTests() {
  console.log('================================================================');
  console.log('🧪 PHASE 2: INDUSTRY-NEUTRAL JOB REQUIREMENTS TEST SUITE');
  console.log('================================================================\n');

  // ============================================================================
  // 1. REQUIRED SKILLS NORMALIZATION & VALIDATION
  // ============================================================================
  console.log('--- 1. Required Skills Tests ---');

  // 1.1 Multiple skills trimmed
  const trimmed = normalizeSkillsList(['  Sales  ', ' Communication\t', 'Customer Service\n']);
  assert(
    trimmed.length === 3 &&
      trimmed[0] === 'Sales' &&
      trimmed[1] === 'Communication' &&
      trimmed[2] === 'Customer Service',
    '1.1 Multiple skills are trimmed correctly'
  );

  // 1.2 Empty list
  const emptyList = normalizeSkillsList([]);
  assert(emptyList.length === 0, '1.2 Empty list returns empty array');

  // 1.3 Duplicate removal (case-insensitive)
  const deduped = normalizeSkillsList(['TypeScript', 'typescript', 'TYPESCRIPT', 'React', 'react']);
  assert(
    deduped.length === 2 && deduped[0] === 'TypeScript' && deduped[1] === 'React',
    '1.3 Case-insensitive duplicate removal preserves first seen casing'
  );

  // 1.4 Whitespace and empty entries filtered out
  const filtered = normalizeSkillsList(['', '   ', '\t', 'Node.js', '  ']);
  assert(filtered.length === 1 && filtered[0] === 'Node.js', '1.4 Empty and whitespace-only entries are rejected');

  // ============================================================================
  // 2. PREFERRED SKILLS NORMALIZATION
  // ============================================================================
  console.log('\n--- 2. Preferred Skills Tests ---');

  // 2.1 Multiple skills
  const prefMulti = normalizeSkillsList(['CRM', 'B2B Sales', 'Negotiation']);
  assert(prefMulti.length === 3 && prefMulti[1] === 'B2B Sales', '2.1 Preferred skills parsed and preserved');

  // 2.2 Empty list
  const prefEmpty = normalizeSkillsList(undefined);
  assert(prefEmpty.length === 0, '2.2 Undefined preferred skills returns empty array');

  // 2.3 Duplicate removal
  const prefDedup = normalizeSkillsList(['AWS', 'Docker', 'aws', 'DOCKER']);
  assert(prefDedup.length === 2 && prefDedup[0] === 'AWS' && prefDedup[1] === 'Docker', '2.3 Preferred duplicates removed');

  // ============================================================================
  // 3. REQUIRED VS PREFERRED CONFLICT RESOLUTION
  // ============================================================================
  console.log('\n--- 3. Required vs Preferred Conflict Resolution ---');

  // 3.1 Overlapping skill: required takes deterministic precedence
  const resolved = resolveRequiredAndPreferredSkills(
    ['React', 'TypeScript', 'Communication'],
    ['React', 'typescript', 'Docker', 'AWS']
  );
  assert(
    resolved.requiredSkills.includes('React') &&
      resolved.requiredSkills.includes('TypeScript') &&
      resolved.requiredSkills.includes('Communication'),
    '3.1 Required skills retain all specified items'
  );
  assert(
    !resolved.preferredSkills.includes('React') &&
      !resolved.preferredSkills.includes('typescript') &&
      resolved.preferredSkills.includes('Docker') &&
      resolved.preferredSkills.includes('AWS'),
    '3.1 Conflicting skills removed from preferred skills deterministically'
  );
  assert(resolved.preferredSkills.length === 2, '3.1 Preferred skills count is exactly 2');

  // ============================================================================
  // 4. EXPERIENCE REQUIREMENTS
  // ============================================================================
  console.log('\n--- 4. Experience Requirement Tests ---');

  // 4.1 No experience requirement
  const noExp = normalizeJobRequirements({});
  assert(
    noExp.minimumExperienceYears === undefined && noExp.maximumExperienceYears === undefined,
    '4.1 No experience requirement leaves fields undefined (not forced 0-10)'
  );

  // 4.2 Minimum only
  const minOnly = normalizeJobRequirements({ minimumExperienceYears: 3 });
  assert(
    minOnly.minimumExperienceYears === 3 && minOnly.maximumExperienceYears === undefined,
    '4.2 Minimum-only experience sets minimum without forcing maximum'
  );

  // 4.3 Minimum + Maximum
  const rangeExp = normalizeJobRequirements({ minimumExperienceYears: 2, maximumExperienceYears: 5 });
  assert(
    rangeExp.minimumExperienceYears === 2 && rangeExp.maximumExperienceYears === 5,
    '4.3 Valid experience range preserved (2-5 years)'
  );

  // 4.4 0 years (Fresher/Entry-Level)
  const fresherExp = normalizeJobRequirements({ minimumExperienceYears: 0, maximumExperienceYears: 1 });
  assert(
    fresherExp.minimumExperienceYears === 0 && fresherExp.maximumExperienceYears === 1,
    '4.4 0 years allowed for entry-level / fresher roles'
  );

  // 4.5 Validator rejects negative experience
  const negativeValidation = structuredRequirementsSchema.safeParse({
    minimumExperienceYears: -1,
  });
  assert(!negativeValidation.success, '4.5 Zod validator rejects negative experience value');

  // 4.6 Validator rejects maximum < minimum
  const invalidRangeValidation = structuredRequirementsSchema.safeParse({
    minimumExperienceYears: 5,
    maximumExperienceYears: 2,
  });
  assert(!invalidRangeValidation.success, '4.6 Zod validator rejects maximumExperience < minimumExperience');

  // 4.7 Normalizer throws when maximum < minimum
  let caughtInverted = false;
  try {
    normalizeJobRequirements({
      minimumExperienceYears: 5,
      maximumExperienceYears: 2,
    });
  } catch (err: any) {
    caughtInverted = true;
  }
  assert(
    caughtInverted,
    '4.7 Normalizer rejects inverted min/max when maximumExperience < minimumExperience'
  );

  // ============================================================================
  // 5. EDUCATION REQUIREMENTS & FORMATTER
  // ============================================================================
  console.log('\n--- 5. Education Requirement Tests ---');

  // 5.1 No requirement ('none')
  assert(normalizeEducationLevel('none') === 'none', '5.1 normalizeEducationLevel handles "none"');
  assert(normalizeEducationLevel(undefined) === 'none', '5.1 normalizeEducationLevel handles undefined as "none"');
  const noneFormatted = formatEducationRequirements({ minimumLevel: 'none' });
  assert(noneFormatted === 'No specific education requirement', '5.1 Formatter output for "none" is neutral');

  // 5.2 Supported levels normalization
  const levels: EducationLevel[] = ['high_school', 'associate', 'diploma', 'bachelor', 'master', 'doctorate', 'other'];
  let allLevelsPass = true;
  for (const lvl of levels) {
    if (normalizeEducationLevel(lvl) !== lvl) allLevelsPass = false;
  }
  assert(allLevelsPass, '5.2 All generic education levels recognized correctly');

  // 5.3 Optional education fields
  const eduWithFields = normalizeJobRequirements({
    education: {
      minimumLevel: 'bachelor',
      fields: ['  Accounting  ', 'Finance', 'accounting'],
    },
  });
  assert(
    eduWithFields.education?.minimumLevel === 'bachelor' &&
      eduWithFields.education?.fields?.length === 2 &&
      eduWithFields.education?.fields[0] === 'Accounting' &&
      eduWithFields.education?.fields[1] === 'Finance',
    '5.3 Education fields are trimmed and deduplicated'
  );

  // 5.4 Formatter with fields
  const formattedWithFields = formatEducationRequirements(eduWithFields.education);
  assert(
    formattedWithFields.includes("Bachelor's Degree") &&
      formattedWithFields.includes('Accounting') &&
      formattedWithFields.includes('Finance'),
    '5.4 Formatter constructs clean readable string with degree and custom fields'
  );

  // 5.5 Invalid education level rejection in validator
  const invalidEduValidation = structuredRequirementsSchema.safeParse({
    education: {
      minimumLevel: 'invalid_level',
    },
  });
  assert(!invalidEduValidation.success, '5.5 Zod validator rejects invalid education levels');

  // ============================================================================
  // 6. GENERAL-PURPOSE INDUSTRY EXAMPLES (NO TECH ASSUMPTIONS)
  // ============================================================================
  console.log('\n--- 6. General-Purpose Industry Job Examples ---');

  // 6.1 Software Engineer
  const softwareJob = normalizeJobRequirements({
    requiredSkills: ['TypeScript', 'React', 'Node.js'],
    preferredSkills: ['AWS', 'Docker'],
    minimumExperienceYears: 3,
    maximumExperienceYears: 6,
    education: { minimumLevel: 'bachelor', fields: ['Computer Science', 'Software Engineering'] },
  });
  assert(
    softwareJob.requiredSkills.length === 3 && softwareJob.preferredSkills.length === 2,
    '6.1 Software Engineer job requirements structured accurately'
  );

  // 6.2 Accountant
  const accountantJob = normalizeJobRequirements({
    requiredSkills: ['Bookkeeping', 'Financial Reporting', 'Tax Compliance', 'Auditing'],
    preferredSkills: ['QuickBooks', 'SAP'],
    minimumExperienceYears: 2,
    maximumExperienceYears: 5,
    education: { minimumLevel: 'bachelor', fields: ['Accounting', 'Finance'] },
  });
  assert(
    Boolean(
      accountantJob.requiredSkills.includes('Tax Compliance') &&
        accountantJob.education?.fields?.includes('Accounting')
    ),
    '6.2 Accountant job has finance/accounting fields without tech bias'
  );

  // 6.3 Sales Executive
  const salesJob = normalizeJobRequirements({
    requiredSkills: ['Negotiation', 'Lead Generation', 'Cold Calling', 'Client Relations'],
    preferredSkills: ['Salesforce', 'B2B Sales'],
    minimumExperienceYears: 1,
    education: { minimumLevel: 'none' },
  });
  assert(
    salesJob.education?.minimumLevel === 'none' &&
      salesJob.maximumExperienceYears === undefined &&
      salesJob.requiredSkills.includes('Negotiation'),
    '6.3 Sales Executive role has no forced education and open max experience'
  );

  // 6.4 Registered Nurse (Healthcare)
  const nurseJob = normalizeJobRequirements({
    requiredSkills: ['Patient Care', 'Clinical Assessment', 'Medication Administration', 'BLS'],
    preferredSkills: ['ICU Experience', 'Triage'],
    minimumExperienceYears: 2,
    education: { minimumLevel: 'associate', fields: ['Nursing'] },
  });
  assert(
    nurseJob.education?.minimumLevel === 'associate' &&
      nurseJob.education?.fields?.[0] === 'Nursing' &&
      nurseJob.requiredSkills.includes('Patient Care'),
    '6.4 Registered Nurse role supports healthcare skills & nursing degree'
  );

  // 6.5 Marketing Executive
  const marketingJob = normalizeJobRequirements({
    requiredSkills: ['Digital Marketing', 'Content Strategy', 'Social Media Management'],
    preferredSkills: ['Google Analytics', 'SEO'],
    minimumExperienceYears: 0,
    maximumExperienceYears: 2,
    education: { minimumLevel: 'bachelor', fields: ['Marketing', 'Communications'] },
  });
  assert(
    Boolean(
      marketingJob.minimumExperienceYears === 0 &&
        marketingJob.education?.fields?.includes('Marketing') &&
        marketingJob.preferredSkills.includes('Google Analytics')
    ),
    '6.5 Marketing Executive role supports entry-level (0-2 yrs) and marketing fields'
  );

  // ============================================================================
  // 7. DATABASE PERSISTENCE & BACKWARD COMPATIBILITY
  // ============================================================================
  console.log('\n--- 7. Database Persistence & Backward Compatibility Integration ---');

  const createdJobIds: Types.ObjectId[] = [];
  try {
    await connectDatabase();

    const testRecruiterId = new Types.ObjectId();

    // 7.1 Create Job via JobService with structuredRequirements
    const newStructuredJob = await jobService.createRecruiterJob(
      testRecruiterId.toString(),
      {
        title: 'Senior Financial Analyst',
        description: 'Lead financial forecasting and quarterly variance analysis.',
        responsibilities: ['Build models', 'present to CFO', 'supervise junior analysts'],
        location: 'Chicago, USA',
        salaryText: '$90,000 - $130,000',
        employmentType: 'full-time',
        workplaceType: 'hybrid',
        structuredRequirements: {
          requiredSkills: ['Financial Modeling', 'Variance Analysis', 'Forecasting'],
          preferredSkills: ['Python for Finance', 'Bloomberg Terminal'],
          minimumExperienceYears: 4,
          maximumExperienceYears: 8,
          education: {
            minimumLevel: 'bachelor',
            fields: ['Finance', 'Economics'],
          },
        },
      }
    );
    createdJobIds.push(newStructuredJob._id as Types.ObjectId);

    // Verify DB stored document
    const fetchedJob = await JobModel.findById(newStructuredJob._id).lean();
    assert(!!fetchedJob, '7.1 New structured job saved to MongoDB');
    assert(
      fetchedJob?.structuredRequirements?.requiredSkills?.length === 3,
      '7.1 requiredSkills stored in structuredRequirements'
    );
    assert(
      fetchedJob?.structuredRequirements?.preferredSkills?.length === 2,
      '7.1 preferredSkills stored in structuredRequirements'
    );
    assert(
      fetchedJob?.structuredRequirements?.minimumExperienceYears === 4,
      '7.1 minimumExperienceYears stored in structuredRequirements'
    );
    assert(
      fetchedJob?.structuredRequirements?.maximumExperienceYears === 8,
      '7.1 maximumExperienceYears stored in structuredRequirements'
    );
    assert(
      fetchedJob?.structuredRequirements?.education?.minimumLevel === 'bachelor',
      '7.1 education minimumLevel stored in structuredRequirements'
    );
    // Backward compatibility sync check
    assert(
      fetchedJob?.minimumExperience === 4 && fetchedJob?.maximumExperience === 8,
      '7.1 Legacy minimumExperience and maximumExperience automatically synced'
    );
    assert(
      Array.isArray(fetchedJob?.skills) &&
        fetchedJob.skills.includes('Financial Modeling') &&
        fetchedJob.skills.includes('Bloomberg Terminal'),
      '7.1 Combined skills array automatically populated for legacy consumers'
    );
    assert(
      typeof fetchedJob?.educationRequirements === 'string' &&
        fetchedJob.educationRequirements.includes("Bachelor's Degree in Finance, Economics"),
      '7.1 Legacy educationRequirements string formatted without CS bias'
    );

    // 7.2 Legacy Job insertion (no structuredRequirements provided)
    const legacyJob = await JobModel.create({
      recruiterId: testRecruiterId,
      title: 'Legacy Operations Supervisor',
      company: { name: 'Acme Logistics' },
      description: 'Supervise warehouse logistics and dispatch operations.',
      location: { city: 'Dallas', country: 'USA' },
      skills: ['Logistics', 'Warehouse Management', 'Supply Chain'],
      minimumExperience: 3,
      maximumExperience: 7,
      educationRequirements: 'High School Diploma or equivalent',
      status: 'active',
    });
    createdJobIds.push(legacyJob._id as Types.ObjectId);

    const fetchedLegacy = await JobModel.findById(legacyJob._id).lean();
    assert(!!fetchedLegacy, '7.2 Legacy job without structuredRequirements loads successfully');
    assert(
      fetchedLegacy?.skills?.length === 3 && fetchedLegacy.minimumExperience === 3,
      '7.2 Legacy fields preserved intact without corruption or forced migration'
    );

  } catch (err: any) {
    console.error('Database test error:', err.message);
    assert(false, '7. Database test execution', err.message);
  } finally {
    // Cleanup
    if (createdJobIds.length > 0) {
      console.log('\n🧹 Cleaning up test database records...');
      await JobModel.deleteMany({ _id: { $in: createdJobIds } });
    }
    await mongoose.disconnect();
    console.log('Database disconnected. Tests finished.\n');
  }

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('================================================================');
  console.log(`Phase 2 Job Requirements Test Results: ${passedCount} passed, ${failedCount} failed`);
  console.log('================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runJobRequirementsTests().catch((err) => {
  console.error('Unhandled error in test runner:', err);
  process.exit(1);
});
