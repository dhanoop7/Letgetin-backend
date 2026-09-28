import { Request, Response } from 'express';
import { PDFService } from './pdf.service.js';

const pdfService = new PDFService();

export class PDFController {
  static download = async (req: Request, res: Response): Promise<void> => {
    const pdfBuffer = await pdfService.generatePdfStream(req.body);

    const rawName =
      req.body?.content?.personalInfo?.fullName ||
      req.body?.personalInfo?.fullName ||
      req.body?.fullName ||
      req.user?.email?.split('@')[0] ||
      'User';

    const cleanName =
      rawName
        .replace(/[\\/:*?"<>|#%&{}\\$!'@+`=]/g, '')
        .trim()
        .replace(/[\s\-_]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'User';

    const filename =
      cleanName.toLowerCase().endsWith('_resume') || cleanName.toLowerCase() === 'resume'
        ? `${cleanName}.pdf`
        : `${cleanName}_Resume.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(pdfBuffer);
  };
}
