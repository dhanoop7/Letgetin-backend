import { Request, Response } from 'express';
import { taskService } from './task.service.js';

export class TaskController {
  static getTasks = async (req: Request, res: Response): Promise<void> => {
    const { status, projectId, date, startDate, endDate, type, isWaitingList, search } = req.query;

    const tasks = await taskService.getTasks(req.user!.userId, {
      status: typeof status === 'string' ? status : undefined,
      projectId: typeof projectId === 'string' ? projectId : undefined,
      date: typeof date === 'string' ? date : undefined,
      startDate: typeof startDate === 'string' ? startDate : undefined,
      endDate: typeof endDate === 'string' ? endDate : undefined,
      type: typeof type === 'string' ? type : undefined,
      isWaitingList:
        typeof isWaitingList === 'string'
          ? isWaitingList === 'true'
          : undefined,
      search: typeof search === 'string' ? search : undefined,
    });

    res.status(200).json({
      success: true,
      data: tasks,
      timestamp: new Date().toISOString(),
    });
  };

  static getTaskById = async (req: Request, res: Response): Promise<void> => {
    const task = await taskService.getTaskById(req.user!.userId, req.params.id as string);

    res.status(200).json({
      success: true,
      data: task,
      timestamp: new Date().toISOString(),
    });
  };

  static createTask = async (req: Request, res: Response): Promise<void> => {
    const task = await taskService.createTask(req.user!.userId, req.body);

    res.status(201).json({
      success: true,
      data: task,
      message: 'Task created successfully',
      timestamp: new Date().toISOString(),
    });
  };

  static updateTask = async (req: Request, res: Response): Promise<void> => {
    const task = await taskService.updateTask(
      req.user!.userId,
      req.params.id as string,
      req.body
    );

    res.status(200).json({
      success: true,
      data: task,
      message: 'Task updated successfully',
      timestamp: new Date().toISOString(),
    });
  };

  static updateTaskStatus = async (req: Request, res: Response): Promise<void> => {
    const task = await taskService.updateTaskStatus(
      req.user!.userId,
      req.params.id as string,
      req.body.status
    );

    res.status(200).json({
      success: true,
      data: task,
      message: 'Task status updated successfully',
      timestamp: new Date().toISOString(),
    });
  };

  static deleteTask = async (req: Request, res: Response): Promise<void> => {
    await taskService.deleteTask(req.user!.userId, req.params.id as string);

    res.status(200).json({
      success: true,
      message: 'Task deleted successfully',
      timestamp: new Date().toISOString(),
    });
  };
}
