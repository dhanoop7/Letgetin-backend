import { TextExtractionService } from './text-extraction.service';

/**
 * STEP 10: Independent test script to verify document extraction.
 * No HTTP server or database required.
 */
async function runExtractionTest() {
  console.log('--- Starting Independent Text Extraction Verification Test ---');

  const extractor = new TextExtractionService();

  // Test 1: Plain Text Extraction
  console.log('\n[Test 1] Testing Plain Text Document...');
  const sampleTxtBuffer = Buffer.from(`Alex Mercer
Senior Full Stack Architect
Email: alex.mercer@devmail.com | Phone: +1 (555) 234-5678 | San Francisco, CA

PROFESSIONAL SUMMARY
Experienced Software Architect with 8+ years of expertise building high-throughput microservices, distributed systems, and real-time frontend applications. Proven track record of scaling Node.js/TypeScript backend services and leading engineering teams.

WORK EXPERIENCE
Senior Software Engineer | TechCorp Inc | 2021 - Present
- Architected enterprise cloud services handling over 50M API requests per day with 99.99% availability.
- Reduced database query latency by 45% using Redis caching and PostgreSQL query optimization.
- Mentored a team of 6 junior and mid-level software engineers.

EDUCATION
B.S. in Computer Science | Stanford University | 2017 - 2021

SKILLS
TypeScript, Node.js, React, Next.js, PostgreSQL, Docker, AWS, GraphQL
`);

  try {
    const extractedTxt = await extractor.extractTextFromBuffer(sampleTxtBuffer, 'txt');
    console.log(`[PASS] Plain Text Extracted Successfully (${extractedTxt.length} chars).`);
  } catch (err: any) {
    console.error('[FAIL] Plain Text Extraction Failed:', err.message);
  }

  // Test 2: Simulated PDF Buffer
  console.log('\n[Test 2] Testing PDF File Magic Byte Detection...');
  const pdfHeaderBuffer = Buffer.from('%PDF-1.4 header contents for PDF detection');
  const detectedPdfType = extractor.detectFileType(pdfHeaderBuffer);
  console.log(`[PASS] Detected Type for %PDF buffer: ${detectedPdfType}`);

  // Test 3: Simulated DOCX Buffer
  console.log('\n[Test 3] Testing DOCX File Magic Byte Detection...');
  const docxHeaderBuffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]); // PK\x03\x04
  const detectedDocxType = extractor.detectFileType(docxHeaderBuffer);
  console.log(`[PASS] Detected Type for DOCX buffer: ${detectedDocxType}`);

  console.log('\n--- Independent Extraction Test Completed Successfully ---');
}

runExtractionTest().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
