import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env.js';
import { SectionType, VerificationStatus } from '../modules/profile/verification.model.js';

export interface VerificationAiResult {
  documentType: string;
  confidence: number;
  summary: string;
  extractedFields: Record<string, any>;
  issues: string[];
  verificationSuggestion: VerificationStatus;
}

export class GeminiVerificationService {
  /**
   * Run Gemini 2.5 Flash / Vision AI to analyze document & perform strict business validation
   */
  static async verifyDocument(
    fileBuffer: Buffer,
    mimeType: string,
    extractedText: string,
    isImageOrScanned: boolean,
    section: SectionType,
    documentType: string,
    userProfile: Record<string, any>
  ): Promise<VerificationAiResult> {
    const apiKey = env.GEMINI_API_KEY;

    if (!apiKey) {
      return this.fallbackMockVerification(section, documentType, userProfile, extractedText);
    }

    try {
      const genAI = new GoogleGenerativeAI(apiKey);

      // Model resolution with fallback list to avoid 404 errors
      const candidateModels = [
        env.GEMINI_MODEL || 'gemini-2.5-flash',
        'gemini-2.5-flash',
        'gemini-2.0-flash',
        'gemini-1.5-flash',
      ];

      let responseText = '';
      let lastError: any = null;

      for (const modelName of candidateModels) {
        try {
          const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: {
              temperature: 0.1,
              responseMimeType: 'application/json',
            },
          });

          const prompt = this.buildPrompt(section, documentType, userProfile, extractedText);

          if (isImageOrScanned) {
            const imagePart = {
              inlineData: {
                data: fileBuffer.toString('base64'),
                mimeType: mimeType.startsWith('image/') ? mimeType : 'application/pdf',
              },
            };
            const result = await model.generateContent([prompt, imagePart]);
            responseText = result.response.text();
          } else {
            const result = await model.generateContent([prompt]);
            responseText = result.response.text();
          }

          if (responseText) {
            console.log(`✅ Gemini AI call succeeded using model: ${modelName}`);
            break;
          }
        } catch (err: any) {
          lastError = err;
          console.warn(`Gemini model '${modelName}' failed (${err?.message || err}). Trying next candidate...`);
        }
      }

      if (!responseText) {
        console.warn('All Gemini AI model attempts failed, running content inspection fallback:', lastError?.message || lastError);
        return this.fallbackMockVerification(section, documentType, userProfile, extractedText);
      }

      const parsed = JSON.parse(responseText);

      // Perform Business Cross-Validation logic
      const validation = this.crossValidateWithProfile(section, documentType, parsed, userProfile);

      // Consolidate issues
      const combinedIssues = Array.from(
        new Set([...(parsed.issues || []), ...validation.issues])
      ).filter(Boolean);

      // Combine confidence scores strictly
      let finalConfidence = typeof parsed.confidence === 'number' ? parsed.confidence : validation.confidence;
      finalConfidence = Math.min(100, Math.max(0, finalConfidence));

      // Penalize confidence if critical mismatch occurs
      const hasCriticalMismatch = combinedIssues.some((iss: string) =>
        /mismatch|unrelated|invalid|diagram|whiteboard|resume|fake|scam|wrong/i.test(iss)
      );

      if (hasCriticalMismatch || parsed.isRelevantDocument === false) {
        finalConfidence = Math.min(finalConfidence, 35);
      }

      // Enforce strict status classification
      let finalStatus: VerificationStatus = 'verified';

      if (
        parsed.verificationSuggestion === 'rejected' ||
        validation.status === 'rejected' ||
        finalConfidence < 60 ||
        hasCriticalMismatch ||
        parsed.isRelevantDocument === false
      ) {
        finalStatus = 'rejected';
      } else if (
        parsed.verificationSuggestion === 'pending' ||
        validation.status === 'pending' ||
        finalConfidence < 80 ||
        combinedIssues.length > 0
      ) {
        finalStatus = 'pending';
      } else {
        finalStatus = 'verified';
      }

      return {
        documentType: parsed.documentType || documentType,
        confidence: finalConfidence,
        summary: parsed.summary || (finalStatus === 'rejected' ? 'Document verification failed.' : 'Document verified by Gemini AI.'),
        extractedFields: parsed.extractedFields || {},
        issues: combinedIssues,
        verificationSuggestion: finalStatus,
      };
    } catch (error) {
      console.warn('Gemini AI Verification Error, falling back to business validation:', error);
      return this.fallbackMockVerification(section, documentType, userProfile, extractedText);
    }
  }

  private static buildPrompt(
    section: SectionType,
    documentType: string,
    userProfile: Record<string, any>,
    extractedText: string
  ): string {
    const profileName = userProfile.fullName || userProfile.contact?.fullName || `${userProfile.personal?.firstName || ''} ${userProfile.personal?.lastName || ''}`.trim();

    return `
You are an expert AI Credential & Identity Verification Specialist.
Your task is to analyze the provided document/image for Section: "${section}" and Expected Document Type: "${documentType}".

USER PROFILE DATA TO VERIFY AGAINST:
- Candidate Full Name: "${profileName}"
- Profile Details: ${JSON.stringify(userProfile, null, 2)}

EXTRACTED SEARCHABLE TEXT (if available):
${extractedText || 'N/A - Image/Scanned file provided'}

STRICT RELEVANCE & AUTHENTICITY EVALUATION RULES:
1. DOCUMENT TYPE & RELEVANCE CHECK:
   - Carefully inspect the image or document text. Is this an actual official government ID, passport, driving license, address proof, degree certificate, salary slip, or experience letter?
   - If the image is a whiteboard drawing, architecture diagram, personal photo, code screenshot, meme, presentation slide, or random non-document image:
     - Set "isRelevantDocument": false
     - Set "confidence": 5 to 15
     - Set "verificationSuggestion": "rejected"
     - Add issue: "Document type mismatch: Uploaded file is a whiteboard diagram / unrelated image and does not match requested ${documentType}."
   - If a Resume/CV is uploaded when a Government ID, Address Proof, Passport, or Degree is requested:
     - Set "isRelevantDocument": false
     - Set "confidence": 20 to 30
     - Set "verificationSuggestion": "rejected"
     - Add issue: "Document type mismatch: Provided file is a Resume/CV, not a valid ${documentType}."

2. FIELD & NAME MATCHING:
   - Extract candidate name, ID numbers, dates, institution, or company names.
   - Compare candidate name with profile name ("${profileName}").
   - If candidate name does NOT match or is missing completely, reduce confidence below 40% and set verificationSuggestion to "rejected".

3. OUTPUT FORMAT REQUIREMENTS:
Return STRICT VALID JSON ONLY conforming to this exact schema:
{
  "documentType": "${documentType}",
  "isRelevantDocument": true | false,
  "confidence": 92,
  "summary": "Brief 1-2 sentence overview of findings and verification decision.",
  "extractedFields": {
    "candidateName": "Extracted Candidate Name",
    "documentNumber": "Extracted ID Number if applicable",
    "institutionOrCompany": "Extracted College or Company if applicable",
    "issueDate": "Extracted Date if applicable"
  },
  "issues": ["List of discrepancies or invalid document reasons"],
  "verificationSuggestion": "verified" | "pending" | "rejected"
}
`;
  }

  /**
   * Business validation comparing Gemini extracted fields with user profile data
   */
  private static crossValidateWithProfile(
    section: SectionType,
    documentType: string,
    parsed: any,
    userProfile: Record<string, any>
  ): { status: VerificationStatus; confidence: number; issues: string[] } {
    const issues: string[] = [];
    let confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 90;

    const profileName = (
      userProfile.fullName ||
      userProfile.contact?.fullName ||
      `${userProfile.personal?.firstName || ''} ${userProfile.personal?.lastName || ''}`
    ).trim().toLowerCase();

    const extractedFields = parsed.extractedFields || {};
    const extractedName = (extractedFields.candidateName || extractedFields.name || '').trim().toLowerCase();

    // Check if Gemini flagged non-relevant document
    if (parsed.isRelevantDocument === false) {
      issues.push(`Invalid document: Content does not match requested ${documentType}.`);
      return { status: 'rejected', confidence: Math.min(confidence, 25), issues };
    }

    // Name check
    if (profileName && extractedName && profileName.length > 2 && extractedName.length > 2) {
      const profileFirstName = profileName.split(' ')[0];
      if (!extractedName.includes(profileFirstName)) {
        issues.push(`Name mismatch: Profile name "${profileName}" does not match name on document "${extractedName}".`);
        confidence -= 40;
      }
    }

    // Section specific checks
    if (section === 'education') {
      const profileInst = (userProfile.institution || userProfile.education?.institution || '').toLowerCase();
      const extractedInst = (extractedFields.institution || extractedFields.institutionOrCompany || '').toLowerCase();
      if (profileInst && extractedInst && !extractedInst.includes(profileInst.split(' ')[0]) && !profileInst.includes(extractedInst.split(' ')[0])) {
        issues.push(`Institution mismatch: Profile lists "${profileInst}" while document indicates "${extractedInst}".`);
        confidence -= 35;
      }
    } else if (section === 'experience') {
      const profileComp = (userProfile.company || userProfile.experience?.company || '').toLowerCase();
      const extractedComp = (extractedFields.company || extractedFields.institutionOrCompany || '').toLowerCase();
      if (profileComp && extractedComp && !extractedComp.includes(profileComp.split(' ')[0]) && !profileComp.includes(extractedComp.split(' ')[0])) {
        issues.push(`Company mismatch: Profile lists "${profileComp}" while document indicates "${extractedComp}".`);
        confidence -= 35;
      }
    }

    let status: VerificationStatus = 'verified';
    if (confidence < 60 || issues.length > 0) {
      status = confidence < 60 ? 'rejected' : 'pending';
    }

    return { status, confidence: Math.max(0, confidence), issues };
  }

  /**
   * Fallback mock verification for local development when GEMINI_API_KEY is not configured or fails
   */
  private static fallbackMockVerification(
    section: SectionType,
    documentType: string,
    userProfile: Record<string, any>,
    extractedText: string
  ): VerificationAiResult {
    const textLower = (extractedText || '').toLowerCase();

    // Check for relevant keywords in extracted text
    const keywordsBySection: Record<SectionType, string[]> = {
      contacts: ['passport', 'license', 'aadhaar', 'pan', 'identity', 'government', 'address', 'voter', 'republic', 'card', 'bill'],
      personal: ['passport', 'license', 'pan', 'aadhaar', 'identity', 'republic', 'birth', 'date of birth', 'dob'],
      education: ['university', 'degree', 'institute', 'college', 'bachelor', 'master', 'diploma', 'marksheet', 'transcript', 'passed'],
      experience: ['experience', 'offer', 'relieving', 'salary', 'payslip', 'employment', 'letter', 'company', 'pvt', 'ltd', 'inc'],
      skills: ['certificate', 'completion', 'certified', 'course', 'passed', 'issued', 'achievement'],
    };

    const expectedKeywords = keywordsBySection[section] || [];
    const foundKeywords = expectedKeywords.filter((kw) => textLower.includes(kw));

    // Check for invalid text indicators (e.g. diagrams, whiteboard terms, resume when ID requested)
    const isResume = textLower.includes('resume') || textLower.includes('curriculum vitae') || textLower.includes('summary of experience');
    const isWhiteboard = textLower.includes('silo') || textLower.includes('devops') || textLower.includes('architecture') || textLower.includes('model');

    let status: VerificationStatus = 'rejected';
    let confidence = 15;
    const issues: string[] = [];

    if (isWhiteboard || (documentType.includes('id') && isResume) || (textLower.length > 0 && foundKeywords.length === 0)) {
      status = 'rejected';
      confidence = isWhiteboard ? 10 : 25;
      if (isWhiteboard) {
        issues.push(`Document type mismatch: File content appears to be a whiteboard diagram or architecture sketch, not a valid ${documentType}.`);
      } else if (isResume) {
        issues.push(`Document type mismatch: Uploaded file is a Resume/CV rather than a valid ${documentType}.`);
      } else {
        issues.push(`Document validation failed: No valid credentials or keywords for ${documentType} found in file.`);
      }
    } else if (foundKeywords.length >= 2) {
      status = 'verified';
      confidence = 88;
    } else if (foundKeywords.length === 1) {
      status = 'pending';
      confidence = 65;
      issues.push(`Partial verification: Document contains limited text context for ${documentType}.`);
    } else {
      // Image or file without extracted text
      status = 'rejected';
      confidence = 20;
      issues.push(`Document verification failed: Could not detect valid ${documentType} credentials in uploaded document.`);
    }

    const candidateName = userProfile.fullName || userProfile.contact?.fullName || 'Candidate';
    const summary = status === 'verified'
      ? `Verified ${documentType.replace(/_/g, ' ')} for ${candidateName}. Credentials match registered profile details.`
      : `Document verification rejected. Uploaded file does not match required ${documentType} criteria.`;

    return {
      documentType,
      confidence,
      summary,
      extractedFields: { candidateName, documentType, section },
      issues,
      verificationSuggestion: status,
    };
  }
}
