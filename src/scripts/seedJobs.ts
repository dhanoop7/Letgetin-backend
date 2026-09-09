import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import { JobModel, ExperienceLevel, EmploymentType, WorkplaceType } from '../modules/job/job.model.js';
import { enqueueBatchJobEmbeddings } from '../queues/queue.config.js';

interface SeedJobTemplate {
  title: string;
  companyName: string;
  companyLogo?: string;
  companyWebsite?: string;
  category: string;
  description: string;
  responsibilities: string[];
  requirements: string[];
  preferredQualifications: string[];
  skills: string[];
  experienceLevel: ExperienceLevel;
  minExp: number;
  maxExp: number;
  employmentType: EmploymentType;
  workplaceType: WorkplaceType;
  city: string;
  country: string;
  salaryMin: number;
  salaryMax: number;
  currency: string;
  education: string;
  benefits: string[];
}

const COMPANIES = [
  { name: 'Razorpay', domain: 'razorpay.com', color: '#0C2340' },
  { name: 'Swiggy', domain: 'swiggy.com', color: '#FC8019' },
  { name: 'Zomato', domain: 'zomato.com', color: '#E23744' },
  { name: 'Zerodha', domain: 'zerodha.com', color: '#387ED1' },
  { name: 'Flipkart', domain: 'flipkart.com', color: '#2874F0' },
  { name: 'Stripe', domain: 'stripe.com', color: '#635BFF' },
  { name: 'Airbnb', domain: 'airbnb.com', color: '#FF5A5F' },
  { name: 'Spotify', domain: 'spotify.com', color: '#1DB954' },
  { name: 'Shopify', domain: 'shopify.com', color: '#96BF48' },
  { name: 'Datadog', domain: 'datadoghq.com', color: '#632CA6' },
  { name: 'Snowflake', domain: 'snowflake.com', color: '#29B5E8' },
  { name: 'Cloudflare', domain: 'cloudflare.com', color: '#F38020' },
  { name: 'Figma', domain: 'figma.com', color: '#F24E1E' },
  { name: 'Canva', domain: 'canva.com', color: '#00C4CC' },
  { name: 'Notion', domain: 'notion.so', color: '#000000' },
  { name: 'Postman', domain: 'postman.com', color: '#FF6C37' },
  { name: 'Freshworks', domain: 'freshworks.com', color: '#0070BA' },
  { name: 'Atlassian', domain: 'atlassian.com', color: '#0052CC' },
  { name: 'CrowdStrike', domain: 'crowdstrike.com', color: '#D9272E' },
  { name: 'Twilio', domain: 'twilio.com', color: '#F22F46' },
  { name: 'CRED', domain: 'cred.club', color: '#000000' },
  { name: 'PhonePe', domain: 'phonepe.com', color: '#5F259F' },
  { name: 'Gojek', domain: 'gojek.io', color: '#00AA13' },
  { name: 'Grab', domain: 'grab.com', color: '#00B14F' },
  { name: 'HubSpot', domain: 'hubspot.com', color: '#FF7A59' },
];

const LOCATIONS = [
  { city: 'Bangalore', state: 'Karnataka', country: 'India', currency: 'INR', salaryMultiplier: 1 },
  { city: 'Hyderabad', state: 'Telangana', country: 'India', currency: 'INR', salaryMultiplier: 0.95 },
  { city: 'Pune', state: 'Maharashtra', country: 'India', currency: 'INR', salaryMultiplier: 0.9 },
  { city: 'Mumbai', state: 'Maharashtra', country: 'India', currency: 'INR', salaryMultiplier: 1.05 },
  { city: 'Gurugram', state: 'Haryana', country: 'India', currency: 'INR', salaryMultiplier: 1 },
  { city: 'San Francisco', state: 'CA', country: 'United States', currency: 'USD', salaryMultiplier: 1.3 },
  { city: 'Seattle', state: 'WA', country: 'United States', currency: 'USD', salaryMultiplier: 1.2 },
  { city: 'New York', state: 'NY', country: 'United States', currency: 'USD', salaryMultiplier: 1.25 },
  { city: 'Austin', state: 'TX', country: 'United States', currency: 'USD', salaryMultiplier: 1.1 },
  { city: 'London', state: 'Greater London', country: 'United Kingdom', currency: 'GBP', salaryMultiplier: 1.15 },
  { city: 'Toronto', state: 'ON', country: 'Canada', currency: 'CAD', salaryMultiplier: 1.1 },
  { city: 'Berlin', state: 'Berlin', country: 'Germany', currency: 'EUR', salaryMultiplier: 1.05 },
  { city: 'Singapore', state: 'Central', country: 'Singapore', currency: 'SGD', salaryMultiplier: 1.2 },
  { city: 'Sydney', state: 'NSW', country: 'Australia', currency: 'AUD', salaryMultiplier: 1.15 },
];

const ROLE_DEFINITIONS = [
  // 1. Frontend & React
  {
    title: 'Senior Frontend Engineer (React/Next.js)',
    category: 'Frontend',
    skills: ['React', 'Next.js', 'TypeScript', 'Tailwind CSS', 'Redux Toolkit', 'GraphQL', 'Jest', 'Webpack'],
    experienceLevel: 'senior' as ExperienceLevel,
    minExp: 4,
    maxExp: 8,
    desc: 'Join our core web platform team to architect ultra-responsive, accessible, and performant user interfaces serving millions of daily active users.',
    responsibilities: [
      'Architect and build modular, scalable UI components with React 19 and Next.js App Router.',
      'Optimize Core Web Vitals (LCP, INP, CLS) and frontend performance across desktop and mobile.',
      'Collaborate with designers to implement sleek design systems and micro-interactions.',
      'Mentor junior engineers and champion frontend code quality, testing, and accessibility.',
    ],
    requirements: [
      '4+ years building production web applications with React, TypeScript, and modern CSS.',
      'Deep understanding of state management, browser rendering lifecycle, and SSR/SSG patterns.',
      'Proficiency with automated testing (Jest, React Testing Library, Playwright).',
    ],
    pref: ['Experience with Web Workers, WebAssembly, or canvas animations.', 'Contributions to open source libraries.'],
  },
  {
    title: 'Frontend Developer (React & TypeScript)',
    category: 'Frontend',
    skills: ['React', 'TypeScript', 'JavaScript', 'HTML5', 'CSS3', 'Tailwind CSS', 'REST APIs', 'Git'],
    experienceLevel: 'mid' as ExperienceLevel,
    minExp: 2,
    maxExp: 4,
    desc: 'We are seeking an energetic Frontend Developer to build clean, intuitive client-facing product workflows.',
    responsibilities: [
      'Develop interactive dashboard widgets and user authentication flows.',
      'Integrate RESTful and GraphQL backend endpoints with robust error handling.',
      'Write clean, reusable UI components using Tailwind CSS and modern React hooks.',
    ],
    requirements: [
      '2+ years of professional frontend development with React and TypeScript.',
      'Solid command of HTML, CSS Flexbox/Grid, and responsive layout design.',
    ],
    pref: ['Experience with Next.js or Vite.', 'Basic knowledge of CI/CD pipelines.'],
  },
  {
    title: 'Junior React Developer',
    category: 'Frontend',
    skills: ['React', 'JavaScript', 'HTML5', 'CSS3', 'Git', 'REST APIs', 'Responsive Design'],
    experienceLevel: 'junior' as ExperienceLevel,
    minExp: 1,
    maxExp: 2,
    desc: 'Great opportunity for an ambitious junior developer to work alongside experienced staff engineers building high-scale web products.',
    responsibilities: [
      'Implement component designs based on Figma prototypes.',
      'Fix UI bugs, improve accessibility, and write unit tests.',
      'Participate in agile sprints and code reviews.',
    ],
    requirements: [
      '1+ year of hands-on experience or substantial personal projects in React.',
      'Good understanding of JavaScript ES6+, DOM manipulation, and asynchronous programming.',
    ],
    pref: ['Experience with Tailwind CSS and Next.js.'],
  },

  // 2. Backend & Node.js
  {
    title: 'Staff Backend Engineer (Node.js / Distributed Systems)',
    category: 'Backend',
    skills: ['Node.js', 'TypeScript', 'MongoDB', 'Redis', 'BullMQ', 'Kafka', 'Docker', 'Kubernetes', 'Microservices'],
    experienceLevel: 'lead' as ExperienceLevel,
    minExp: 7,
    maxExp: 12,
    desc: 'Lead the architectural design and scaling of our distributed backend services handling 100k+ concurrent requests.',
    responsibilities: [
      'Design high-throughput event-driven microservices using Node.js, Redis BullMQ, and Kafka.',
      'Optimize database queries, indexing strategies, and caching layers for sub-millisecond response times.',
      'Establish architectural best practices, fault-tolerance paradigms, and observability standards.',
    ],
    requirements: [
      '7+ years designing and running distributed production systems at scale.',
      'Mastery of Node.js event loop, asynchronous concurrency, and TypeScript.',
      'Deep expertise in MongoDB, Redis, relational databases, and container orchestration.',
    ],
    pref: ['Experience with Atlas Vector Search or semantic retrieval pipelines.'],
  },
  {
    title: 'Senior Backend Developer (Node.js & Express)',
    category: 'Backend',
    skills: ['Node.js', 'Express', 'TypeScript', 'MongoDB', 'Mongoose', 'Redis', 'JWT', 'REST APIs', 'Jest'],
    experienceLevel: 'senior' as ExperienceLevel,
    minExp: 4,
    maxExp: 7,
    desc: 'Build robust REST APIs, authentication infrastructure, and background queue workers for our flagship SaaS platform.',
    responsibilities: [
      'Develop secure, high-performance REST APIs with Express and TypeScript.',
      'Design MongoDB schemas and aggregations with Mongoose.',
      'Implement asynchronous job queues with BullMQ and Redis for AI document parsing.',
    ],
    requirements: [
      '4+ years of backend development experience with Node.js and TypeScript.',
      'Proven track record building and deploying production APIs.',
      'Strong database skills in MongoDB and Redis.',
    ],
    pref: ['Experience with AWS services (S3, ECS, Lambda).'],
  },
  {
    title: 'Backend Engineer (Python & FastAPI)',
    category: 'Backend',
    skills: ['Python', 'FastAPI', 'PostgreSQL', 'Redis', 'Docker', 'Celery', 'SQLAlchemy', 'REST APIs'],
    experienceLevel: 'mid' as ExperienceLevel,
    minExp: 2,
    maxExp: 5,
    desc: 'Develop high-performance asynchronous API services and data ingestion pipelines using FastAPI and Python.',
    responsibilities: [
      'Build scalable backend services powering AI and analytics products.',
      'Optimize relational schemas and query performance with PostgreSQL and SQLAlchemy.',
      'Implement background tasks and scheduled cron workers.',
    ],
    requirements: [
      '2+ years backend engineering experience with Python and FastAPI / Django.',
      'Proficiency in relational databases and Redis caching.',
    ],
    pref: ['Familiarity with LangChain or vector databases.'],
  },
  {
    title: 'Senior Java Backend Engineer (Spring Boot)',
    category: 'Backend',
    skills: ['Java', 'Spring Boot', 'Microservices', 'PostgreSQL', 'Kafka', 'Docker', 'JUnit', 'AWS'],
    experienceLevel: 'senior' as ExperienceLevel,
    minExp: 5,
    maxExp: 9,
    desc: 'Build enterprise-grade microservices and payment integration backends with Java 21 and Spring Boot.',
    responsibilities: [
      'Design reliable, high-availability microservices for transactional workflows.',
      'Implement event-driven communication with Apache Kafka.',
      'Ensure high code coverage and automated integration testing.',
    ],
    requirements: [
      '5+ years with Java and Spring Boot ecosystem.',
      'Strong knowledge of design patterns, multi-threading, and distributed caching.',
    ],
    pref: ['Experience in FinTech or e-commerce high-concurrency systems.'],
  },

  // 3. Full Stack
  {
    title: 'Senior Full Stack Engineer (MERN Stack)',
    category: 'Full Stack',
    skills: ['React', 'Node.js', 'TypeScript', 'MongoDB', 'Express', 'Next.js', 'Tailwind CSS', 'Docker'],
    experienceLevel: 'senior' as ExperienceLevel,
    minExp: 4,
    maxExp: 8,
    desc: 'Own end-to-end features from database schema design to polished user-facing frontend components in our fast-growing SaaS application.',
    responsibilities: [
      'Build end-to-end product features utilizing React, Next.js, Node.js, and MongoDB.',
      'Design intuitive UI/UX with modern Tailwind styling and seamless state management.',
      'Write scalable APIs, authentication guards, and database migrations.',
    ],
    requirements: [
      '4+ years full stack engineering experience using modern JavaScript/TypeScript stacks.',
      'Demonstrated expertise in both frontend (React) and backend (Node.js/Express) domains.',
    ],
    pref: ['Experience with AI integrations or vector search.'],
  },
  {
    title: 'Full Stack Developer (PERN / Next.js)',
    category: 'Full Stack',
    skills: ['PostgreSQL', 'Express', 'React', 'Node.js', 'Next.js', 'TypeScript', 'Prisma', 'Tailwind CSS'],
    experienceLevel: 'mid' as ExperienceLevel,
    minExp: 2,
    maxExp: 5,
    desc: 'Work across the full product lifecycle building customer-centric features, internal tools, and public web applications.',
    responsibilities: [
      'Develop modern web applications using Next.js, TypeScript, and PostgreSQL.',
      'Design clean REST and GraphQL APIs.',
      'Ensure cross-browser compatibility and responsive layout fidelity.',
    ],
    requirements: [
      '2+ years full stack experience with React and Node.js.',
      'Experience with relational or NoSQL database modeling.',
    ],
    pref: ['Experience with automated CI/CD and Vercel/AWS deployments.'],
  },

  // 4. AI & Machine Learning
  {
    title: 'AI / Machine Learning Engineer (LLMs & Embeddings)',
    category: 'AI & ML',
    skills: ['Python', 'PyTorch', 'Gemini API', 'LangChain', 'Vector Databases', 'Atlas Vector Search', 'RAG', 'Docker'],
    experienceLevel: 'senior' as ExperienceLevel,
    minExp: 3,
    maxExp: 7,
    desc: 'Pioneer our next-generation AI resume parsing, candidate scoring, and semantic job matching recommendation engine.',
    responsibilities: [
      'Develop production RAG architectures, prompt pipelines, and vector search matching algorithms.',
      'Evaluate, fine-tune, and benchmark embedding models for domain-specific semantic retrieval.',
      'Build low-latency inference services and background vectorization workers.',
    ],
    requirements: [
      '3+ years building and deploying production ML / LLM applications.',
      'Strong grasp of vector embeddings, cosine similarity metrics, and semantic search.',
      'Proficiency with Python, ML frameworks, and modern API development.',
    ],
    pref: ['Experience with MongoDB Atlas Vector Search, Pinecone, or Milvus.'],
  },
  {
    title: 'Generative AI Applications Developer',
    category: 'AI & ML',
    skills: ['TypeScript', 'Python', 'OpenAI API', 'Gemini API', 'Node.js', 'Vector Search', 'Prompt Engineering'],
    experienceLevel: 'mid' as ExperienceLevel,
    minExp: 2,
    maxExp: 5,
    desc: 'Bridge AI models with real-world user experiences by building intuitive AI-assisted workflows and smart recommendations.',
    responsibilities: [
      'Build generative AI features including automatic resume restructuring and ATS score analysis.',
      'Implement streaming responses, token optimization, and structured JSON generation.',
      'Maintain prompt templates and conduct systematic quality evaluations.',
    ],
    requirements: [
      '2+ years software engineering experience with focus on AI/LLM integrations.',
      'Familiarity with embedding generation, semantic similarity, and structured output parsing.',
    ],
    pref: ['Experience with BullMQ asynchronous queue pipelines.'],
  },

  // 5. DevOps & Cloud
  {
    title: 'Senior DevOps / Cloud Platform Engineer',
    category: 'DevOps & Cloud',
    skills: ['AWS', 'Kubernetes', 'Terraform', 'Docker', 'CI/CD', 'GitHub Actions', 'Prometheus', 'Grafana', 'Linux'],
    experienceLevel: 'senior' as ExperienceLevel,
    minExp: 4,
    maxExp: 8,
    desc: 'Empower our engineering organization by building resilient cloud infrastructure, automated pipelines, and 99.99% availability.',
    responsibilities: [
      'Manage multi-region AWS infrastructure using Terraform and Kubernetes (EKS).',
      'Optimize CI/CD build times, automated testing, and zero-downtime deployment pipelines.',
      'Implement comprehensive monitoring, alerting, and incident response runbooks.',
    ],
    requirements: [
      '4+ years in DevOps / Site Reliability Engineering roles.',
      'Strong expertise in Terraform, Kubernetes, Docker, and AWS.',
      'Proficiency with Linux systems, networking, and security best practices.',
    ],
    pref: ['Experience managing MongoDB Atlas and Redis clusters in production.'],
  },
  {
    title: 'Cloud Infrastructure Engineer (GCP / Kubernetes)',
    category: 'DevOps & Cloud',
    skills: ['GCP', 'Kubernetes', 'Docker', 'Terraform', 'Helm', 'Python', 'Bash', 'Observability'],
    experienceLevel: 'mid' as ExperienceLevel,
    minExp: 2,
    maxExp: 5,
    desc: 'Help scale our Google Cloud Platform infrastructure, container workloads, and automated developer tooling.',
    responsibilities: [
      'Maintain GKE clusters and container deployments.',
      'Automate infrastructure provisioning and secret management.',
      'Monitor application metrics and troubleshoot production incidents.',
    ],
    requirements: ['2+ years cloud engineering experience with GCP or AWS.'],
    pref: ['CKA (Certified Kubernetes Administrator) certification.'],
  },

  // 6. Data Engineering & Analytics
  {
    title: 'Senior Data Engineer (Spark & SnowFlake)',
    category: 'Data',
    skills: ['Python', 'SQL', 'Snowflake', 'Apache Spark', 'Airflow', 'dbt', 'Kafka', 'Data Warehousing'],
    experienceLevel: 'senior' as ExperienceLevel,
    minExp: 4,
    maxExp: 8,
    desc: 'Build scalable data ingestion pipelines and real-time streaming architectures powering analytics and recommendation feeds.',
    responsibilities: [
      'Design reliable ETL/ELT data pipelines using Apache Airflow and dbt.',
      'Optimize Snowflake queries and analytical data marts.',
      'Ensure data quality, governance, and real-time streaming reliability.',
    ],
    requirements: ['4+ years in data engineering with deep SQL and Python expertise.'],
    pref: ['Experience with vector search indexing pipelines.'],
  },
  {
    title: 'Product Data Analyst',
    category: 'Data',
    skills: ['SQL', 'Python', 'Tableau', 'Product Analytics', 'A/B Testing', 'Statistics', 'Metabase'],
    experienceLevel: 'mid' as ExperienceLevel,
    minExp: 2,
    maxExp: 5,
    desc: 'Uncover actionable product insights, run A/B experiments, and define key metric dashboards for our user growth engine.',
    responsibilities: [
      'Analyze user behavior across resume creation and job discovery funnels.',
      'Design and evaluate statistical A/B tests to optimize conversion.',
      'Build executive dashboards and automated KPI reports.',
    ],
    requirements: ['2+ years experience in product analytics with advanced SQL proficiency.'],
    pref: ['Experience with Mixpanel, Amplitude, or PostHog.'],
  },

  // 7. Mobile Development
  {
    title: 'Senior React Native Developer',
    category: 'Mobile',
    skills: ['React Native', 'TypeScript', 'iOS', 'Android', 'Redux', 'Mobile UI/UX', 'Jest', 'App Store Deployment'],
    experienceLevel: 'senior' as ExperienceLevel,
    minExp: 4,
    maxExp: 7,
    desc: 'Lead the development of our cross-platform iOS and Android mobile apps with smooth 60fps animations and offline sync.',
    responsibilities: [
      'Develop high-quality React Native applications for iOS and Android.',
      'Implement offline-first storage and background synchronization.',
      'Manage App Store and Google Play release pipelines.',
    ],
    requirements: ['4+ years building production mobile apps with React Native.'],
    pref: ['Experience with Swift / Kotlin native modules.'],
  },
  {
    title: 'iOS Developer (Swift & SwiftUI)',
    category: 'Mobile',
    skills: ['Swift', 'SwiftUI', 'Combine', 'Xcode', 'CoreData', 'REST APIs', 'Git', 'iOS SDK'],
    experienceLevel: 'mid' as ExperienceLevel,
    minExp: 2,
    maxExp: 5,
    desc: 'Craft delightful native iOS experiences utilizing SwiftUI, dynamic widgets, and iOS ecosystem features.',
    responsibilities: [
      'Build native iOS user interfaces with SwiftUI and Combine.',
      'Optimize memory usage, app startup time, and battery efficiency.',
    ],
    requirements: ['2+ years native iOS development experience with Swift.'],
    pref: ['Published apps on Apple App Store.'],
  },

  // 8. UI/UX & Product Design
  {
    title: 'Lead Product Designer (UI/UX)',
    category: 'Design',
    skills: ['Figma', 'UI/UX Design', 'Design Systems', 'User Research', 'Prototyping', 'Interaction Design'],
    experienceLevel: 'lead' as ExperienceLevel,
    minExp: 6,
    maxExp: 10,
    desc: 'Define the visual direction, interaction model, and design system across our entire web and mobile product suite.',
    responsibilities: [
      'Lead design vision and collaborate closely with product managers and engineers.',
      'Maintain and evolve our comprehensive multi-brand Figma design system.',
      'Conduct user interviews, usability tests, and translate insights into elegant designs.',
    ],
    requirements: ['6+ years designing SaaS or consumer web products with a stellar portfolio.'],
    pref: ['Basic knowledge of HTML/CSS capabilities.'],
  },
  {
    title: 'UI/UX Designer',
    category: 'Design',
    skills: ['Figma', 'Wireframing', 'User Flows', 'Prototyping', 'Visual Design', 'Design Systems'],
    experienceLevel: 'mid' as ExperienceLevel,
    minExp: 2,
    maxExp: 4,
    desc: 'Create intuitive user experiences, mockups, and clickable prototypes for new feature launches.',
    responsibilities: [
      'Design user flows, wireframes, and high-fidelity screen mockups.',
      'Work with developers during implementation sprints to ensure design perfection.',
    ],
    requirements: ['2+ years UI/UX design experience with a strong Figma portfolio.'],
    pref: ['Experience in B2B SaaS or career/recruitment platforms.'],
  },

  // 9. QA & Testing
  {
    title: 'Senior QA Automation Engineer (Playwright / Cypress)',
    category: 'QA',
    skills: ['Playwright', 'TypeScript', 'Cypress', 'Selenium', 'API Testing', 'Postman', 'CI/CD', 'Jest'],
    experienceLevel: 'senior' as ExperienceLevel,
    minExp: 4,
    maxExp: 7,
    desc: 'Architect our end-to-end automated testing framework to guarantee flawless user experiences across all devices.',
    responsibilities: [
      'Develop robust E2E test suites with Playwright and TypeScript.',
      'Integrate automated tests into GitHub Actions PR validation gates.',
      'Perform load, stress, and security testing on critical backend endpoints.',
    ],
    requirements: ['4+ years QA automation engineering experience with modern web tools.'],
    pref: ['Experience testing AI / LLM output validation.'],
  },

  // 10. Cybersecurity
  {
    title: 'Cybersecurity & Application Security Engineer',
    category: 'Security',
    skills: ['Application Security', 'Penetration Testing', 'OWASP', 'Vulnerability Assessment', 'OAuth2', 'SOC 2', 'AWS Security'],
    experienceLevel: 'senior' as ExperienceLevel,
    minExp: 4,
    maxExp: 8,
    desc: 'Protect customer resume data, secure our cloud infrastructure, and lead compliance and penetration testing initiatives.',
    responsibilities: [
      'Conduct code security audits, threat modeling, and vulnerability assessments.',
      'Ensure strict adherence to OWASP Top 10, SOC 2, and GDPR standards.',
      'Implement automated security scanning in CI/CD pipelines.',
    ],
    requirements: ['4+ years in AppSec or cloud security engineering.'],
    pref: ['Certifications like OSCP, CISSP, or AWS Security Specialist.'],
  },
];

const WORKPLACE_TYPES: WorkplaceType[] = ['remote', 'hybrid', 'onsite'];
const EMPLOYMENT_TYPES: EmploymentType[] = ['full-time', 'full-time', 'full-time', 'contract', 'part-time'];

/**
 * Generates ~200 diverse, realistic job objects
 */
function generateSeedJobs(targetCount = 200) {
  const jobs: any[] = [];
  let index = 0;

  while (jobs.length < targetCount) {
    const role = ROLE_DEFINITIONS[index % ROLE_DEFINITIONS.length];
    const company = COMPANIES[(index * 3 + (index % 5)) % COMPANIES.length];
    const location = LOCATIONS[(index * 2 + (index % 7)) % LOCATIONS.length];
    const workplace = WORKPLACE_TYPES[(index + (index % 3)) % WORKPLACE_TYPES.length];
    const empType = EMPLOYMENT_TYPES[index % EMPLOYMENT_TYPES.length];

    // Compute realistic salary
    let baseMin = 18;
    let baseMax = 32;

    if (role.experienceLevel === 'junior' || role.experienceLevel === 'entry') {
      baseMin = 8;
      baseMax = 16;
    } else if (role.experienceLevel === 'senior') {
      baseMin = 28;
      baseMax = 50;
    } else if (role.experienceLevel === 'lead') {
      baseMin = 45;
      baseMax = 80;
    }

    let minSalary = Math.round(baseMin * location.salaryMultiplier);
    let maxSalary = Math.round(baseMax * location.salaryMultiplier);

    if (location.currency === 'INR') {
      minSalary = minSalary * 100000;
      maxSalary = maxSalary * 100000;
    } else if (location.currency === 'USD') {
      minSalary = (baseMin * 3.5 + 40) * 1000;
      maxSalary = (baseMax * 3.5 + 60) * 1000;
    } else if (location.currency === 'EUR' || location.currency === 'GBP') {
      minSalary = (baseMin * 2.8 + 35) * 1000;
      maxSalary = (baseMax * 2.8 + 50) * 1000;
    } else {
      minSalary = (baseMin * 3.0 + 35) * 1000;
      maxSalary = (baseMax * 3.0 + 55) * 1000;
    }

    // Realistic published date within past 30 days
    const daysAgo = (index * 7) % 28;
    const publishedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

    const slug = `${company.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${role.title.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${index + 1}`;

    const jobDoc = {
      title: role.title,
      company: {
        name: company.name,
        logo: `https://logo.clearbit.com/${company.domain}`,
        website: `https://${company.domain}`,
      },
      description: `${role.desc} At ${company.name}, you will work with cutting-edge technologies in a collaborative and high-impact environment.`,
      responsibilities: role.responsibilities,
      requirements: role.requirements,
      preferredQualifications: role.pref,
      skills: role.skills,
      experienceLevel: role.experienceLevel,
      minimumExperience: role.minExp,
      maximumExperience: role.maxExp,
      employmentType: empType,
      workplaceType: workplace,
      location: {
        city: location.city,
        state: location.state,
        country: location.country,
        remote: workplace === 'remote' || workplace === 'hybrid',
      },
      salary: {
        min: minSalary,
        max: maxSalary,
        currency: location.currency,
        period: 'yearly',
      },
      educationRequirements: "Bachelor's degree in Computer Science, Engineering, or equivalent experience",
      benefits: [
        'Comprehensive health, dental, and vision insurance',
        'Flexible remote work & home office stipend',
        'Generous annual learning & conference budget',
        'Competitive equity / stock options package',
        'Unlimited paid time off (PTO) policy',
      ],
      applicationUrl: `https://demo.resumebuildai.com/jobs/apply/${slug}`,
      source: 'seed',
      status: 'active',
      publishedAt,
      embeddingStatus: 'pending',
    };

    jobs.push(jobDoc);
    index++;
  }

  return jobs;
}

export async function runJobSeed() {
  console.log('🌱 Starting Job Seeder...');

  try {
    await connectDatabase();

    const existingCount = await JobModel.countDocuments({ source: 'seed' });
    console.log(`📊 Currently existing seed jobs in database: ${existingCount}`);

    if (existingCount >= 180) {
      console.log('✅ Seed jobs already populated in database (180+ found). Checking for pending embeddings...');
      const pendingJobs = await JobModel.find({ embeddingStatus: 'pending' }).select('_id').lean();
      if (pendingJobs.length > 0) {
        console.log(`📦 Enqueuing ${pendingJobs.length} pending jobs to BullMQ embedding queue...`);
        const enqueued = await enqueueBatchJobEmbeddings(pendingJobs.map((j) => j._id.toString()));
        console.log(`⚡ Successfully enqueued ${enqueued} jobs for embedding generation.`);
      } else {
        console.log('✨ All jobs have completed or processing embeddings.');
      }
      return;
    }

    // Generate 200 jobs
    const seedJobsData = generateSeedJobs(200);
    console.log(`✨ Generated ${seedJobsData.length} realistic jobs. Inserting into MongoDB...`);

    const inserted = await JobModel.insertMany(seedJobsData, { ordered: false });
    console.log(`🎉 Successfully inserted ${inserted.length} jobs into MongoDB.`);

    // Enqueue jobs into BullMQ
    const jobIds = inserted.map((doc) => doc._id.toString());
    console.log(`📦 Enqueuing ${jobIds.length} jobs to BullMQ embedding queue...`);

    const enqueuedCount = await enqueueBatchJobEmbeddings(jobIds);
    console.log(`⚡ Enqueued ${enqueuedCount} jobs into 'job-embedding-queue'.`);
    console.log(`💡 Run 'npm run worker:dev' to process the embedding generation worker.`);
  } catch (error: any) {
    console.error('❌ Error during job seeding:', error?.message || error);
  } finally {
    await mongoose.disconnect();
    console.log('🔒 Database connection closed. Seeder finished.');
  }
}

// Execute if run as direct script
if (process.argv[1]?.includes('seedJobs')) {
  runJobSeed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
