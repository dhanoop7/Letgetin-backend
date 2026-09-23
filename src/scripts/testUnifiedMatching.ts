import { candidateJobMatchingService } from '../modules/matching/candidateJobMatching.service.js';
import { CandidateDataResolver } from '../modules/profile/candidateDataResolver.js';
import { EducationMatcher } from '../modules/matching/educationMatcher.js';
import { SemanticRoleMatcher } from '../modules/matching/semanticRoleMatcher.js';

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

async function runUnifiedMatchingTests() {
  console.log('================================================================');
  console.log('🧪 PHASE 3: UNIFIED CANDIDATE ↔ JOB MATCHING ENGINE TEST SUITE');
  console.log('================================================================\n');

  // ============================================================================
  // 1. REQUIRED SKILLS MATCHING
  // ============================================================================
  console.log('--- 1. Required Skills Matching Tests ---');

  // 1.1 Exact match
  const candidateExact = CandidateDataResolver.resolve({
    userProfile: { personal: { headline: 'Sales Representative' } },
    resume: { content: { skills: ['Communication', 'Customer Service', 'Negotiation'] } },
  });
  const jobExact = {
    title: 'Sales Representative',
    structuredRequirements: {
      requiredSkills: ['Communication', 'Customer Service', 'Negotiation'],
    },
  };
  const match1 = candidateJobMatchingService.matchCandidateToJob(candidateExact, jobExact);
  assert(
    match1.requiredSkills.score === 100 &&
      match1.requiredSkills.matched.length === 3 &&
      match1.requiredSkills.missing.length === 0,
    '1.1 Exact required skills match yields 100 score and empty missing array'
  );

  // 1.2 Case-insensitive matching
  const candidateCase = CandidateDataResolver.resolve({
    resume: { content: { skills: ['react', 'TYPESCRIPT', 'Node.JS'] } },
  });
  const jobCase = {
    title: 'Frontend Developer',
    structuredRequirements: {
      requiredSkills: ['React', 'TypeScript', 'Node.js'],
    },
  };
  const match2 = candidateJobMatchingService.matchCandidateToJob(candidateCase, jobCase);
  assert(
    match2.requiredSkills.score === 100 && match2.requiredSkills.matched.length === 3,
    '1.2 Case-insensitive skill matching succeeds across differing letter cases'
  );

  // 1.3 Missing required skills
  const candidatePartial = CandidateDataResolver.resolve({
    resume: { content: { skills: ['Communication'] } },
  });
  const jobPartial = {
    title: 'Client Specialist',
    structuredRequirements: {
      requiredSkills: ['Communication', 'Conflict Resolution', 'Active Listening'],
    },
  };
  const match3 = candidateJobMatchingService.matchCandidateToJob(candidatePartial, jobPartial);
  assert(
    match3.requiredSkills.score === 33 &&
      match3.requiredSkills.matched.includes('Communication') &&
      match3.requiredSkills.missing.includes('Conflict Resolution') &&
      match3.requiredSkills.missing.includes('Active Listening'),
    '1.3 Missing required skills identifies matched vs missing accurately'
  );

  // 1.4 Empty required skills on job
  const jobNoReqSkills = {
    title: 'General Assistant',
    structuredRequirements: { requiredSkills: [] },
  };
  const match4 = candidateJobMatchingService.matchCandidateToJob(candidateExact, jobNoReqSkills);
  assert(
    match4.requiredSkills.score === 100 && match4.requiredSkills.matched.length === 0,
    '1.4 Empty required skills on job gives 100 score without false missing flags'
  );

  // ============================================================================
  // 2. PREFERRED SKILLS MATCHING
  // ============================================================================
  console.log('\n--- 2. Preferred Skills Matching Tests ---');

  // 2.1 Matching preferred skill
  const candidatePref = CandidateDataResolver.resolve({
    resume: { content: { skills: ['Communication', 'Salesforce', 'B2B Sales'] } },
  });
  const jobPref = {
    title: 'Account Executive',
    structuredRequirements: {
      requiredSkills: ['Communication'],
      preferredSkills: ['Salesforce', 'HubSpot'],
    },
  };
  const matchPref1 = candidateJobMatchingService.matchCandidateToJob(candidatePref, jobPref);
  assert(
    matchPref1.preferredSkills.score === 50 &&
      matchPref1.preferredSkills.matched.includes('Salesforce') &&
      matchPref1.preferredSkills.missing.includes('HubSpot'),
    '2.1 Preferred skills evaluated independently with matched/missing'
  );

  // 2.2 Missing preferred skills does not penalize required skills
  assert(
    matchPref1.requiredSkills.score === 100 && matchPref1.requiredSkills.missing.length === 0,
    '2.2 Missing preferred skills does NOT mark mandatory requirements missing'
  );

  // 2.3 Empty preferred skills on job
  const jobNoPref = {
    title: 'Clerk',
    structuredRequirements: { requiredSkills: ['Typing'], preferredSkills: [] },
  };
  const matchPref3 = candidateJobMatchingService.matchCandidateToJob(candidatePref, jobNoPref);
  assert(
    matchPref3.preferredSkills.score === 100 && matchPref3.preferredSkills.missing.length === 0,
    '2.3 Empty preferred skills evaluates to 100'
  );

  // ============================================================================
  // 3. EXPERIENCE MATCHING
  // ============================================================================
  console.log('\n--- 3. Experience Matching Tests ---');

  // 3.1 No experience requirement
  const jobNoExp = {
    title: 'Entry Associate',
    structuredRequirements: {},
  };
  const matchExp1 = candidateJobMatchingService.matchCandidateToJob(candidateExact, jobNoExp);
  assert(
    matchExp1.experience.score === 100 && matchExp1.experience.status === 'no_requirement',
    '3.1 Unspecified experience requirement gives full score (status: no_requirement)'
  );

  // 3.2 Candidate within range
  const candidate3Yrs = CandidateDataResolver.resolve({
    resume: {
      content: {
        experiences: [
          { startDate: '2021-01-01', endDate: '2023-12-31', position: 'Analyst' }, // 3 yrs
        ],
      },
    },
  });
  const jobRange = {
    title: 'Financial Analyst',
    structuredRequirements: { minimumExperienceYears: 2, maximumExperienceYears: 5 },
  };
  const matchExp2 = candidateJobMatchingService.matchCandidateToJob(candidate3Yrs, jobRange);
  assert(
    matchExp2.experience.score === 100 && matchExp2.experience.status === 'within_range',
    '3.2 Candidate inside experience range yields 100 score and within_range status'
  );

  // 3.3 Candidate below minimum
  const candidate1Yr = CandidateDataResolver.resolve({
    resume: {
      content: {
        experiences: [
          { startDate: '2023-01-01', endDate: '2023-12-31', position: 'Junior Analyst' }, // 1 yr
        ],
      },
    },
  });
  const jobMin4 = {
    title: 'Senior Financial Analyst',
    structuredRequirements: { minimumExperienceYears: 4 },
  };
  const matchExp3 = candidateJobMatchingService.matchCandidateToJob(candidate1Yr, jobMin4);
  assert(
    matchExp3.experience.status === 'below_minimum' && matchExp3.experience.score <= 50,
    '3.3 Candidate below minimum experience is identified as below_minimum with graduated score'
  );

  // 3.4 Candidate above maximum (No harsh penalty)
  const candidate8Yrs = CandidateDataResolver.resolve({
    resume: {
      content: {
        experiences: [
          { startDate: '2016-01-01', endDate: '2023-12-31', position: 'Senior Lead' }, // 8 yrs
        ],
      },
    },
  });
  const matchExp4 = candidateJobMatchingService.matchCandidateToJob(candidate8Yrs, jobRange);
  assert(
    matchExp4.experience.status === 'above_range' && matchExp4.experience.score >= 85,
    '3.4 Candidate exceeding maximum experience receives above_range status without harsh penalty (score >= 85)'
  );

  // 3.5 Fresher / 0 years matching 0-year requirement
  const candidateFresher = CandidateDataResolver.resolve({
    userProfile: { track: 'fresher' },
    resume: { content: {} },
  });
  const jobFresher = {
    title: 'Graduate Trainee',
    structuredRequirements: { minimumExperienceYears: 0, maximumExperienceYears: 1 },
  };
  const matchExp5 = candidateJobMatchingService.matchCandidateToJob(candidateFresher, jobFresher);
  assert(
    matchExp5.experience.score === 100 && matchExp5.experience.status === 'within_range',
    '3.5 Fresher (0 years) fulfills 0-year minimum requirement with 100 score'
  );

  // ============================================================================
  // 4. EDUCATION MATCHING
  // ============================================================================
  console.log('\n--- 4. Education Matching Tests ---');

  // 4.1 No requirement
  const eduNone = EducationMatcher.evaluateEducation([], 'none');
  assert(
    eduNone.component.score === 100 && eduNone.component.status === 'no_requirement',
    '4.1 No education requirement gives 100 score and no_requirement status'
  );

  // 4.2 Exact level (Bachelor matches Bachelor)
  const candidateBachelor = CandidateDataResolver.resolve({
    resume: {
      content: {
        educations: [{ degree: 'Bachelor of Science', fieldOfStudy: 'Economics' }],
      },
    },
  });
  const eduExact = EducationMatcher.evaluateEducation(candidateBachelor.educations, 'bachelor');
  assert(
    eduExact.component.score === 100 && eduExact.component.status === 'meets_requirement',
    '4.2 Bachelor meets Bachelor requirement'
  );

  // 4.3 Higher level (Master meets Bachelor)
  const candidateMaster = CandidateDataResolver.resolve({
    resume: {
      content: {
        educations: [{ degree: 'Master of Business Administration', fieldOfStudy: 'Finance' }],
      },
    },
  });
  const eduHigher = EducationMatcher.evaluateEducation(candidateMaster.educations, 'bachelor');
  assert(
    eduHigher.component.score === 100 && eduHigher.component.status === 'meets_requirement',
    '4.3 Master degree satisfies Bachelor requirement'
  );

  // 4.4 Lower level (Associate for Bachelor requirement)
  const candidateAssociate = CandidateDataResolver.resolve({
    resume: {
      content: {
        educations: [{ degree: 'Associate Degree', fieldOfStudy: 'General Studies' }],
      },
    },
  });
  const eduLower = EducationMatcher.evaluateEducation(candidateAssociate.educations, 'bachelor');
  assert(
    eduLower.component.status === 'below_requirement' && eduLower.component.score === 75,
    '4.4 Associate degree is below Bachelor requirement with graduated score (75)'
  );

  // 4.5 Unknown / Missing candidate education when degree required
  const eduMissing = EducationMatcher.evaluateEducation([], 'bachelor');
  assert(
    eduMissing.component.status === 'unknown' && eduMissing.component.score === 60,
    '4.5 Unspecified candidate education yields neutral unknown status (60)'
  );

  // ============================================================================
  // 5. SEMANTIC & ROLE RELEVANCE MATCHING
  // ============================================================================
  console.log('\n--- 5. Semantic & Role Relevance Tests ---');

  // 5.1 Precomputed vector embeddings
  const dummyVecA = [0.8, 0.6, 0.0];
  const dummyVecB = [0.8, 0.6, 0.0]; // identical
  const semExact = SemanticRoleMatcher.evaluateSemanticMatch(
    candidateExact,
    { title: 'Sales Rep' },
    dummyVecA,
    dummyVecB
  );
  assert(semExact.score === 100, '5.1 Identical vector embeddings yield 100 semantic score');

  // 5.2 Orthogonal vector embeddings
  const dummyVecC = [0.0, 0.0, 1.0];
  const semOrtho = SemanticRoleMatcher.evaluateSemanticMatch(
    candidateExact,
    { title: 'Sales Rep' },
    dummyVecA,
    dummyVecC
  );
  assert(semOrtho.score === 0, '5.2 Orthogonal vector embeddings yield 0 semantic score');

  // 5.3 Deterministic text fallback without embeddings
  const semFallback = SemanticRoleMatcher.evaluateSemanticMatch(
    candidateExact,
    {
      title: 'Sales Representative',
      description: 'Customer outreach, negotiation, and account communication.',
      responsibilities: ['Drive sales', 'Engage customers'],
    }
  );
  assert(
    semFallback.score >= 50 && typeof semFallback.explanation === 'string',
    '5.3 Text fallback computes contextual similarity when embeddings are absent'
  );

  // 5.4 Role relevance: Direct title alignment
  const roleDirect = SemanticRoleMatcher.evaluateRoleRelevance(
    candidateExact, // headline: 'Sales Representative'
    { title: 'Senior Sales Representative' }
  );
  assert(roleDirect.score >= 85, '5.4 Direct title alignment produces high role relevance (>= 85)');

  // 5.5 Role relevance: Adjacent functional role without tech bias
  const candidateBDR = CandidateDataResolver.resolve({
    userProfile: { personal: { headline: 'Business Development Representative' } },
    resume: {
      content: {
        experiences: [
          {
            position: 'BDR',
            company: 'Growth Corp',
            startDate: '2022-01-01',
            endDate: '2023-12-31',
            highlights: ['Lead generation', 'Pipeline expansion', 'Client outreach'],
          },
        ],
      },
    },
  });
  const roleAdjacent = SemanticRoleMatcher.evaluateRoleRelevance(
    candidateBDR,
    {
      title: 'Sales Executive',
      responsibilities: ['Lead generation', 'Client outreach', 'Pipeline management'],
    }
  );
  assert(
    roleAdjacent.score >= 60,
    '5.5 Adjacent functional role recognized via responsibilities & experience'
  );

  // 5.6 Role relevance: Completely unrelated role
  const roleUnrelated = SemanticRoleMatcher.evaluateRoleRelevance(
    candidateBDR,
    { title: 'Executive Chef', responsibilities: ['Kitchen management', 'Menu design'] }
  );
  assert(roleUnrelated.score <= 45, '5.6 Unrelated role produces low role relevance (<= 45)');

  // ============================================================================
  // 6. 8 GENERAL-PURPOSE INDUSTRY EXAMPLES
  // ============================================================================
  console.log('\n--- 6. 8 General-Purpose Industry Role Tests ---');

  // 6.1 Software Engineer
  const candSoftware = CandidateDataResolver.resolve({
    userProfile: { personal: { headline: 'Software Engineer' } },
    resume: {
      content: {
        skills: ['TypeScript', 'React', 'Node.js', 'PostgreSQL', 'Docker'],
        experiences: [{ position: 'Software Engineer', startDate: '2020-01-01', endDate: '2023-12-31' }],
        educations: [{ degree: 'Bachelor of Science', fieldOfStudy: 'Computer Science' }],
      },
    },
  });
  const jobSoftware = {
    title: 'Software Engineer',
    description: 'Build full stack web applications and microservices.',
    responsibilities: ['Write maintainable TypeScript', 'Design RESTful APIs'],
    structuredRequirements: {
      requiredSkills: ['TypeScript', 'React', 'Node.js'],
      preferredSkills: ['Docker', 'AWS'],
      minimumExperienceYears: 3,
      maximumExperienceYears: 6,
      education: { minimumLevel: 'bachelor' },
    },
  };
  const resSoftware = candidateJobMatchingService.matchCandidateToJob(candSoftware, jobSoftware);
  assert(
    resSoftware.overallScore >= 80 && resSoftware.recommendation === 'strong_match',
    '6.1 Software Engineer matched accurately as strong_match'
  );

  // 6.2 Accountant (Finance)
  const candAccountant = CandidateDataResolver.resolve({
    userProfile: { personal: { headline: 'Certified Public Accountant' } },
    resume: {
      content: {
        skills: ['Bookkeeping', 'Financial Reporting', 'Tax Compliance', 'Auditing', 'QuickBooks'],
        experiences: [{ position: 'Senior Accountant', startDate: '2019-01-01', endDate: '2023-12-31' }],
        educations: [{ degree: 'Bachelor of Commerce', fieldOfStudy: 'Accounting' }],
      },
    },
  });
  const jobAccountant = {
    title: 'Accountant',
    description: 'Prepare quarterly financial statements and tax compliance audits.',
    responsibilities: ['Reconcile general ledger', 'File corporate tax returns'],
    structuredRequirements: {
      requiredSkills: ['Bookkeeping', 'Financial Reporting', 'Tax Compliance'],
      preferredSkills: ['QuickBooks', 'SAP'],
      minimumExperienceYears: 3,
      maximumExperienceYears: 7,
      education: { minimumLevel: 'bachelor' },
    },
  };
  const resAccountant = candidateJobMatchingService.matchCandidateToJob(candAccountant, jobAccountant);
  assert(
    resAccountant.overallScore >= 80 && resAccountant.recommendation === 'strong_match',
    '6.2 Accountant matched accurately with finance requirements'
  );

  // 6.3 Registered Nurse (Healthcare)
  const candNurse = CandidateDataResolver.resolve({
    userProfile: { personal: { headline: 'Registered Nurse' } },
    resume: {
      content: {
        skills: ['Patient Care', 'Clinical Assessment', 'Medication Administration', 'BLS', 'Triage'],
        experiences: [{ position: 'Staff Nurse', startDate: '2021-01-01', endDate: '2023-12-31' }],
        educations: [{ degree: 'Bachelor of Science in Nursing', fieldOfStudy: 'Nursing' }],
      },
    },
  });
  const jobNurse = {
    title: 'Registered Nurse',
    description: 'Provide inpatient clinical nursing care and patient triage.',
    responsibilities: ['Administer medications', 'Monitor vital signs', 'Coordinate with physicians'],
    structuredRequirements: {
      requiredSkills: ['Patient Care', 'Clinical Assessment', 'Medication Administration'],
      preferredSkills: ['Triage', 'ICU Experience'],
      minimumExperienceYears: 2,
      education: { minimumLevel: 'bachelor' },
    },
  };
  const resNurse = candidateJobMatchingService.matchCandidateToJob(candNurse, jobNurse);
  assert(
    resNurse.overallScore >= 80 && resNurse.recommendation === 'strong_match',
    '6.3 Registered Nurse matched accurately with clinical healthcare criteria'
  );

  // 6.4 Sales Executive
  const candSales = CandidateDataResolver.resolve({
    userProfile: { personal: { headline: 'Sales Executive' } },
    resume: {
      content: {
        skills: ['Negotiation', 'Lead Generation', 'Cold Calling', 'CRM'],
        experiences: [{ position: 'Sales Associate', startDate: '2022-01-01', endDate: '2023-12-31' }],
      },
    },
  });
  const jobSales = {
    title: 'Sales Executive',
    description: 'Drive regional revenue growth and close commercial sales deals.',
    responsibilities: ['Prospect target accounts', 'Deliver product demos', 'Negotiate contracts'],
    structuredRequirements: {
      requiredSkills: ['Negotiation', 'Lead Generation', 'CRM'],
      minimumExperienceYears: 1,
      education: { minimumLevel: 'none' },
    },
  };
  const resSales = candidateJobMatchingService.matchCandidateToJob(candSales, jobSales);
  assert(
    resSales.overallScore >= 80 && resSales.education.status === 'no_requirement',
    '6.4 Sales Executive matched with no-education requirement intact'
  );

  // 6.5 Marketing Executive
  const candMarketing = CandidateDataResolver.resolve({
    userProfile: { personal: { headline: 'Digital Marketing Specialist' } },
    resume: {
      content: {
        skills: ['Digital Marketing', 'Content Strategy', 'Social Media Management', 'Google Analytics'],
        experiences: [{ position: 'Marketing Associate', startDate: '2023-01-01', endDate: '2023-12-31' }],
        educations: [{ degree: 'Bachelor of Arts', fieldOfStudy: 'Communications' }],
      },
    },
  });
  const jobMarketing = {
    title: 'Marketing Executive',
    description: 'Execute omnichannel campaigns and social media brand growth.',
    responsibilities: ['Manage paid social', 'Analyze campaign metrics'],
    structuredRequirements: {
      requiredSkills: ['Digital Marketing', 'Content Strategy'],
      preferredSkills: ['Google Analytics', 'SEO'],
      minimumExperienceYears: 0,
      maximumExperienceYears: 2,
      education: { minimumLevel: 'bachelor' },
    },
  };
  const resMarketing = candidateJobMatchingService.matchCandidateToJob(candMarketing, jobMarketing);
  assert(
    resMarketing.overallScore >= 80 && resMarketing.experience.status === 'within_range',
    '6.5 Marketing Executive matched entry-level requirements'
  );

  // 6.6 Operations Manager
  const candOps = CandidateDataResolver.resolve({
    userProfile: { personal: { headline: 'Operations Manager' } },
    resume: {
      content: {
        skills: ['Supply Chain Management', 'Warehouse Logistics', 'Process Optimization', 'Vendor Relations'],
        experiences: [{ position: 'Operations Supervisor', startDate: '2017-01-01', endDate: '2023-12-31' }],
        educations: [{ degree: 'Bachelor of Science', fieldOfStudy: 'Operations Management' }],
      },
    },
  });
  const jobOps = {
    title: 'Operations Manager',
    description: 'Oversee regional distribution centers and supply chain workflows.',
    responsibilities: ['Optimize inventory turnover', 'Supervise floor personnel'],
    structuredRequirements: {
      requiredSkills: ['Supply Chain Management', 'Warehouse Logistics', 'Process Optimization'],
      minimumExperienceYears: 5,
      education: { minimumLevel: 'bachelor' },
    },
  };
  const resOps = candidateJobMatchingService.matchCandidateToJob(candOps, jobOps);
  assert(
    resOps.overallScore >= 80 && resOps.recommendation === 'strong_match',
    '6.6 Operations Manager matched operations/logistics criteria'
  );

  // 6.7 Teacher (Education)
  const candTeacher = CandidateDataResolver.resolve({
    userProfile: { personal: { headline: 'Secondary School Teacher' } },
    resume: {
      content: {
        skills: ['Lesson Planning', 'Classroom Management', 'Curriculum Development', 'Student Assessment'],
        experiences: [{ position: 'High School Teacher', startDate: '2020-01-01', endDate: '2023-12-31' }],
        educations: [{ degree: 'Bachelor of Education', fieldOfStudy: 'Education' }],
      },
    },
  });
  const jobTeacher = {
    title: 'High School Teacher',
    description: 'Deliver engaging classroom instruction and grade student assignments.',
    responsibilities: ['Develop curriculum', 'Host parent-teacher conferences'],
    structuredRequirements: {
      requiredSkills: ['Lesson Planning', 'Classroom Management', 'Curriculum Development'],
      minimumExperienceYears: 2,
      education: { minimumLevel: 'bachelor' },
    },
  };
  const resTeacher = candidateJobMatchingService.matchCandidateToJob(candTeacher, jobTeacher);
  assert(
    resTeacher.overallScore >= 80 && resTeacher.recommendation === 'strong_match',
    '6.7 Teacher matched educational pedagogy criteria'
  );

  // 6.8 Electrician (Skilled Trade)
  const candElectrician = CandidateDataResolver.resolve({
    userProfile: { personal: { headline: 'Licensed Electrician' } },
    resume: {
      content: {
        skills: ['Electrical Wiring', 'Circuit Diagnostics', 'Blueprints Reading', 'OSHA Safety Standards'],
        experiences: [{ position: 'Journeyman Electrician', startDate: '2019-01-01', endDate: '2023-12-31' }],
        educations: [{ degree: 'Vocational Diploma', fieldOfStudy: 'Electrical Technology' }],
      },
    },
  });
  const jobElectrician = {
    title: 'Industrial Electrician',
    description: 'Maintain commercial electrical infrastructure and high-voltage panels.',
    responsibilities: ['Troubleshoot circuit breakers', 'Install conduit and wiring'],
    structuredRequirements: {
      requiredSkills: ['Electrical Wiring', 'Circuit Diagnostics', 'Blueprints Reading'],
      minimumExperienceYears: 3,
      education: { minimumLevel: 'diploma' },
    },
  };
  const resElectrician = candidateJobMatchingService.matchCandidateToJob(candElectrician, jobElectrician);
  assert(
    resElectrician.overallScore >= 80 && resElectrician.recommendation === 'strong_match',
    '6.8 Electrician (skilled trade) matched technical trade criteria'
  );

  // ============================================================================
  // 7. EDGE CASES & RESILIENCE
  // ============================================================================
  console.log('\n--- 7. Edge Cases & Resilience Tests ---');

  // 7.1 Candidate with zero skills
  const candZeroSkills = CandidateDataResolver.resolve({});
  const resZeroSkills = candidateJobMatchingService.matchCandidateToJob(candZeroSkills, jobSoftware);
  assert(
    resZeroSkills.requiredSkills.score === 0 && resZeroSkills.overallScore <= 50,
    '7.1 Candidate with zero skills evaluates safely without NaN or error'
  );

  // 7.2 Candidate with zero experience
  const candZeroExp = CandidateDataResolver.resolve({});
  const resZeroExp = candidateJobMatchingService.matchCandidateToJob(candZeroExp, jobMin4);
  assert(
    resZeroExp.experience.status === 'below_minimum' && resZeroExp.experience.candidateYears === 0,
    '7.2 Candidate with zero experience evaluates safely without throwing'
  );

  // 7.3 Candidate with no education
  const candNoEdu = CandidateDataResolver.resolve({});
  const resNoEdu = candidateJobMatchingService.matchCandidateToJob(candNoEdu, jobSoftware);
  assert(
    resNoEdu.education.status === 'unknown' && typeof resNoEdu.education.score === 'number',
    '7.3 Candidate without education evaluates with unknown status and valid number'
  );

  // 7.4 Job with zero requirements (completely open job)
  const jobEmpty = { title: 'Open Volunteer Role' };
  const resEmptyJob = candidateJobMatchingService.matchCandidateToJob(candSoftware, jobEmpty);
  assert(
    resEmptyJob.overallScore > 0 && !isNaN(resEmptyJob.overallScore),
    '7.4 Job with zero requirements evaluates cleanly with valid overallScore'
  );

  // 7.5 Legacy job without structuredRequirements (only old flat fields)
  const legacyJob = {
    title: 'Legacy Warehouse Specialist',
    skills: ['Logistics', 'Inventory Control'],
    minimumExperience: 2,
    maximumExperience: 5,
    educationRequirements: "Bachelor's Degree in Business or related",
  };
  const candLegacy = CandidateDataResolver.resolve({
    userProfile: { personal: { headline: 'Warehouse Specialist' } },
    resume: {
      content: {
        skills: ['Logistics', 'Inventory Control'],
        experiences: [{ position: 'Warehouse Associate', startDate: '2020-01-01', endDate: '2023-12-31' }],
        educations: [{ degree: 'Bachelor of Science', fieldOfStudy: 'Business Administration' }],
      },
    },
  });
  const resLegacy = candidateJobMatchingService.matchCandidateToJob(candLegacy, legacyJob);
  assert(
    resLegacy.requiredSkills.score === 100 &&
      resLegacy.experience.status === 'within_range' &&
      resLegacy.education.status === 'meets_requirement' &&
      resLegacy.overallScore >= 80,
    '7.5 Legacy job without structuredRequirements successfully extracted from flat fields'
  );

  // 7.6 Explanations array is comprehensive and non-empty
  assert(
    Array.isArray(resLegacy.explanations) && resLegacy.explanations.length >= 3,
    '7.6 Explanations array contains multiple detailed human-readable points'
  );

  // 7.7 Breakdown has all 6 scores in range 0-100
  const b = resLegacy.breakdown;
  const validBreakdown =
    b.requiredSkillsScore >= 0 && b.requiredSkillsScore <= 100 &&
    b.preferredSkillsScore >= 0 && b.preferredSkillsScore <= 100 &&
    b.experienceScore >= 0 && b.experienceScore <= 100 &&
    b.educationScore >= 0 && b.educationScore <= 100 &&
    b.semanticScore >= 0 && b.semanticScore <= 100 &&
    b.roleRelevanceScore >= 0 && b.roleRelevanceScore <= 100;
  assert(validBreakdown, '7.7 All breakdown sub-scores are strictly bounded between 0 and 100');

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('\n================================================================');
  console.log(`Phase 3 Unified Matching Test Results: ${passedCount} passed, ${failedCount} failed`);
  console.log('================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runUnifiedMatchingTests().catch((err) => {
  console.error('Unhandled error in test runner:', err);
  process.exit(1);
});
