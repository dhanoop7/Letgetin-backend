import { Request, Response } from 'express';
import { networkService, NetworkQueryFilters } from './network.service.js';

export class NetworkController {
  static getSummary = async (req: Request, res: Response): Promise<void> => {
    const summary = await networkService.getSummary(req.user!.userId);
    res.status(200).json({
      success: true,
      data: summary,
      timestamp: new Date().toISOString(),
    });
  };

  static getContacts = async (req: Request, res: Response): Promise<void> => {
    const filters: NetworkQueryFilters = {
      page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 50,
      stage: (req.query.stage as any) || 'all',
      industry: (req.query.industry as string) || 'all',
      location: (req.query.location as string) || 'all',
      source: (req.query.source as string) || 'all',
      search: (req.query.search as string) || '',
      sort: (req.query.sort as any) || 'recent',
    };

    const result = await networkService.getContacts(req.user!.userId, filters);
    res.status(200).json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });
  };

  static getRecommended = async (req: Request, res: Response): Promise<void> => {
    const recommended = await networkService.getRecommended(req.user!.userId);
    res.status(200).json({
      success: true,
      data: recommended,
      timestamp: new Date().toISOString(),
    });
  };

  static getConnections = async (req: Request, res: Response): Promise<void> => {
    const search = req.query.search as string;
    const connections = await networkService.getConnections(req.user!.userId, search);
    res.status(200).json({
      success: true,
      data: connections,
      timestamp: new Date().toISOString(),
    });
  };

  static getFollowingAndFollowers = async (req: Request, res: Response): Promise<void> => {
    const result = await networkService.getFollowingAndFollowers(req.user!.userId);
    res.status(200).json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });
  };

  static createContact = async (req: Request, res: Response): Promise<void> => {
    const created = await networkService.createContact(req.user!.userId, req.body);
    res.status(201).json({
      success: true,
      data: created,
      message: 'Contact added to your network successfully',
      timestamp: new Date().toISOString(),
    });
  };

  static updateContact = async (req: Request, res: Response): Promise<void> => {
    const contactId = req.params.id as string;
    const updated = await networkService.updateContact(req.user!.userId, contactId, req.body);
    res.status(200).json({
      success: true,
      data: updated,
      message: 'Contact updated successfully',
      timestamp: new Date().toISOString(),
    });
  };

  static deleteContact = async (req: Request, res: Response): Promise<void> => {
    const contactId = req.params.id as string;
    const result = await networkService.deleteContact(req.user!.userId, contactId);
    res.status(200).json({
      success: true,
      data: result,
      message: 'Contact removed from network',
      timestamp: new Date().toISOString(),
    });
  };

  static toggleConnect = async (req: Request, res: Response): Promise<void> => {
    const contactId = req.params.id as string;
    const updated = await networkService.toggleConnect(req.user!.userId, contactId);
    res.status(200).json({
      success: true,
      data: updated,
      message: `Connection status updated to ${updated.connectionStatus}`,
      timestamp: new Date().toISOString(),
    });
  };

  static toggleFollow = async (req: Request, res: Response): Promise<void> => {
    const contactId = req.params.id as string;
    const updated = await networkService.toggleFollow(req.user!.userId, contactId);
    res.status(200).json({
      success: true,
      data: updated,
      message: updated.isFollowing ? 'Following contact' : 'Unfollowed contact',
      timestamp: new Date().toISOString(),
    });
  };

  static addInteraction = async (req: Request, res: Response): Promise<void> => {
    const contactId = req.params.id as string;
    const updated = await networkService.addInteraction(req.user!.userId, contactId, req.body);
    res.status(200).json({
      success: true,
      data: updated,
      message: 'Interaction recorded',
      timestamp: new Date().toISOString(),
    });
  };

  static getActivityFeed = async (req: Request, res: Response): Promise<void> => {
    const activities = await networkService.getActivityFeed(req.user!.userId);
    res.status(200).json({
      success: true,
      data: activities,
      timestamp: new Date().toISOString(),
    });
  };
}
