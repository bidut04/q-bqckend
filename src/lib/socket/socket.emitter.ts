import crypto from "crypto";
import { socketServer } from "./socket.server";
import {
  RealtimeEventType,
  RealtimeEnvelope,
  DisplayCallPayload,
  DisplayClearPayload,
} from "./socket.types";

export class RealtimeEmitter {
  private createEnvelope<T>(
    tenantId: string,
    eventType: RealtimeEventType,
    payload: T,
    branchId?: string
  ): RealtimeEnvelope<T> {
    return {
      eventId: `rt_${Date.now()}_${crypto.randomUUID().substring(0, 8)}`,
      eventType,
      tenantId,
      branchId,
      occurredAt: new Date().toISOString(),
      payload,
    };
  }

  public emitQueueEvent<T = unknown>(
    tenantId: string,
    branchId: string,
    eventType: RealtimeEventType,
    payload: T
  ): void {
    const io = socketServer.getIO();
    if (!io) return;

    const envelope = this.createEnvelope(tenantId, eventType, payload, branchId);
    const branchRoom = `tenant:${tenantId}:branch:${branchId}`;
    const tenantRoom = `tenant:${tenantId}`;

    io.to(branchRoom).emit(eventType, envelope);
    io.to(tenantRoom).emit(eventType, envelope);
  }

  public emitBookingEvent<T = unknown>(
    tenantId: string,
    branchId: string,
    eventType: RealtimeEventType,
    payload: T
  ): void {
    const io = socketServer.getIO();
    if (!io) return;

    const envelope = this.createEnvelope(tenantId, eventType, payload, branchId);
    const branchRoom = `tenant:${tenantId}:branch:${branchId}`;
    const tenantRoom = `tenant:${tenantId}`;

    io.to(branchRoom).emit(eventType, envelope);
    io.to(tenantRoom).emit(eventType, envelope);
  }

  public emitDisplayCall(
    tenantId: string,
    branchId: string,
    payload: DisplayCallPayload
  ): void {
    const io = socketServer.getIO();
    if (!io) return;

    const envelope = this.createEnvelope(
      tenantId,
      RealtimeEventType.DISPLAY_CALL,
      payload,
      branchId
    );
    const displayRoom = `tenant:${tenantId}:branch:${branchId}:display`;
    const branchRoom = `tenant:${tenantId}:branch:${branchId}`;

    io.to(displayRoom).emit(RealtimeEventType.DISPLAY_CALL, envelope);
    io.to(branchRoom).emit(RealtimeEventType.DISPLAY_CALL, envelope);
  }

  public emitDisplayClear(
    tenantId: string,
    branchId: string,
    payload: DisplayClearPayload
  ): void {
    const io = socketServer.getIO();
    if (!io) return;

    const envelope = this.createEnvelope(
      tenantId,
      RealtimeEventType.DISPLAY_CLEAR,
      payload,
      branchId
    );
    const displayRoom = `tenant:${tenantId}:branch:${branchId}:display`;

    io.to(displayRoom).emit(RealtimeEventType.DISPLAY_CLEAR, envelope);
  }
}

export const realtimeEmitter = new RealtimeEmitter();
