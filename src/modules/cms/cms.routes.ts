import { Router, Request, Response } from 'express';
import mongoose, { Schema } from 'mongoose';

const router = Router();

// Define LandingPageContent schema matching shared database
const LandingPageContentSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: 'main_cms_content' },
    live: { type: Schema.Types.Mixed },
    draft: { type: Schema.Types.Mixed },
    history: [{ publishedAt: String, summary: String }],
  },
  { timestamps: true, collection: 'landingpagecontents' }
);

const LandingPageContent = mongoose.models.LandingPageContent || mongoose.model('LandingPageContent', LandingPageContentSchema);

// GET /api/cms/landing-page — Publicly returns ONLY the published content
router.get('/landing-page', async (_req: Request, res: Response) => {
  try {
    const doc = await LandingPageContent.findOne({ key: 'main_cms_content' }).lean() as any;
    if (!doc || !doc.live) {
      return res.status(200).json({
        success: true,
        data: null,
        mode: 'published',
        message: 'No published CMS content found, using frontend baseline defaults.',
      });
    }

    return res.status(200).json({
      success: true,
      data: doc.live,
      mode: 'published',
    });
  } catch (err: any) {
    console.error('Error fetching published CMS content in LetGetIn backend:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve published CMS content',
      error: err.message,
    });
  }
});

export default router;
