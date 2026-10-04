import { Response } from 'express';

export interface SignalingClient {
  id: string;
  userId: string;
  role: 'candidate' | 'interviewer';
  res: Response;
  joinedAt: Date;
}

export class SignalingService {
  // Map of interviewId -> Map of clientId -> SignalingClient
  private static rooms = new Map<string, Map<string, SignalingClient>>();

  /**
   * Subscribe client to room SSE event stream
   */
  public static subscribe(
    interviewId: string,
    userId: string,
    role: 'candidate' | 'interviewer',
    res: Response
  ): string {
    const clientId = `${userId}_${role}_${Date.now()}`;

    // Configure SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    if (!this.rooms.has(interviewId)) {
      this.rooms.set(interviewId, new Map());
    }
    const room = this.rooms.get(interviewId)!;

    const client: SignalingClient = {
      id: clientId,
      userId,
      role,
      res,
      joinedAt: new Date(),
    };

    room.set(clientId, client);

    // Send initial connected event with current room peers list
    const peers = Array.from(room.values())
      .filter((p) => p.id !== clientId)
      .map((p) => ({ id: p.id, userId: p.userId, role: p.role }));

    this.sendEvent(res, {
      type: 'room-state',
      clientId,
      peers,
      peerCount: room.size,
    });

    // Notify other peers in this room that a new peer joined
    this.broadcastToRoom(
      interviewId,
      {
        type: 'peer-joined',
        peer: { id: clientId, userId, role },
        peerCount: room.size,
      },
      clientId
    );

    // Keep connection alive with periodic ping comment
    const pingInterval = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(pingInterval);
      }
    }, 20000);

    // Handle client disconnect
    res.on('close', () => {
      clearInterval(pingInterval);
      const currentRoom = this.rooms.get(interviewId);
      if (currentRoom) {
        currentRoom.delete(clientId);
        if (currentRoom.size === 0) {
          this.rooms.delete(interviewId);
        } else {
          this.broadcastToRoom(
            interviewId,
            {
              type: 'peer-left',
              peer: { id: clientId, userId, role },
              peerCount: currentRoom.size,
            },
            clientId
          );
        }
      }
    });

    return clientId;
  }

  /**
   * Broadcast signaling payload (offer, answer, ICE candidate, chat, media state, end)
   */
  public static broadcastMessage(
    interviewId: string,
    senderClientId: string,
    payload: any
  ): boolean {
    const room = this.rooms.get(interviewId);
    if (!room) return false;

    this.broadcastToRoom(
      interviewId,
      {
        ...payload,
        senderClientId,
      },
      senderClientId
    );
    return true;
  }

  /**
   * Get active peer count in room
   */
  public static getRoomPeerCount(interviewId: string): number {
    return this.rooms.get(interviewId)?.size || 0;
  }

  /**
   * Helper to serialize and write SSE event
   */
  private static sendEvent(res: Response, data: any) {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (err) {
      console.warn('[SignalingService] Write error:', err);
    }
  }

  /**
   * Broadcast to all clients in room except excluded
   */
  private static broadcastToRoom(
    interviewId: string,
    data: any,
    excludeClientId?: string
  ) {
    const room = this.rooms.get(interviewId);
    if (!room) return;

    for (const [id, client] of room.entries()) {
      if (id !== excludeClientId) {
        this.sendEvent(client.res, data);
      }
    }
  }
}
