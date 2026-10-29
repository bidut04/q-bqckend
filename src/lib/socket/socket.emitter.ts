import crypto from "crypto";
import { socketServer } from "./socket.server";
import { realtimeCacheService } from "../redis/realtime-cache.service";
import { getActiveTraceContext } from "../tracing/tracer";
import {
  RealtimeEventType,
  RealtimeEnvelope,
  DisplayCallPayload,
  DisplayClearPayload,
} from "./socket.types";

export const createRealtimeEnvelope = <T>(
  tenantId: string,
  eventType: RealtimeEventType,
  payload: T,
  branchId?: string
): RealtimeEnvelope<T> => {
  const activeTrace = getActiveTraceContext();
  return {
    eventId: `rt_${Date.now()}_${crypto.randomUUID().substring(0, 8)}`,
    eventType,
    tenantId,
    branchId,
    occurredAt: new Date().toISOString(),
    traceId: activeTrace?.traceId,
    spanId: activeTrace?.spanId,
    payload,
  };
};


export const emitQueueEvent = <T = unknown>(
  tenantId: string,
  branchId: string,
  eventType: RealtimeEventType,
  payload: T
): void => {
  const io = socketServer.getIO();
  if (!io) return;

  const envelope = createRealtimeEnvelope(tenantId, eventType, payload, branchId);
  const branchRoom = `tenant:${tenantId}:branch:${branchId}`;
  const tenantRoom = `tenant:${tenantId}`;

  io.to(branchRoom).emit(eventType, envelope);
  io.to(tenantRoom).emit(eventType, envelope);

  // Save to rolling buffer for catch-up recovery upon client reconnect
  realtimeCacheService.recordRecentEvent(tenantId, branchId, envelope as unknown as Record<string, unknown>).catch(() => {});
};

export const emitBookingEvent = <T = unknown>(
  tenantId: string,
  branchId: string,
  eventType: RealtimeEventType,
  payload: T
): void => {
  const io = socketServer.getIO();
  if (!io) return;

  const envelope = createRealtimeEnvelope(tenantId, eventType, payload, branchId);
  const branchRoom = `tenant:${tenantId}:branch:${branchId}`;
  const tenantRoom = `tenant:${tenantId}`;

  io.to(branchRoom).emit(eventType, envelope);
  io.to(tenantRoom).emit(eventType, envelope);
};

export const emitDisplayCall = (
  tenantId: string,
  branchId: string,
  payload: DisplayCallPayload
): void => {
  const io = socketServer.getIO();
  if (!io) return;

  const envelope = createRealtimeEnvelope(
    tenantId,
    RealtimeEventType.DISPLAY_CALL,
    payload,
    branchId
  );
  const displayRoom = `tenant:${tenantId}:branch:${branchId}:display`;
  const branchRoom = `tenant:${tenantId}:branch:${branchId}`;

  io.to(displayRoom).emit(RealtimeEventType.DISPLAY_CALL, envelope);
  io.to(branchRoom).emit(RealtimeEventType.DISPLAY_CALL, envelope);
};

export const emitDisplayClear = (
  tenantId: string,
  branchId: string,
  payload: DisplayClearPayload
): void => {
  const io = socketServer.getIO();
  if (!io) return;

  const envelope = createRealtimeEnvelope(
    tenantId,
    RealtimeEventType.DISPLAY_CLEAR,
    payload,
    branchId
  );
  const displayRoom = `tenant:${tenantId}:branch:${branchId}:display`;

  io.to(displayRoom).emit(RealtimeEventType.DISPLAY_CLEAR, envelope);
};

export const realtimeEmitter = {
  createEnvelope: createRealtimeEnvelope,
  emitQueueEvent,
  emitBookingEvent,
  emitDisplayCall,
  emitDisplayClear,
};

export const RealtimeEmitter = function (this: unknown) {
  return realtimeEmitter;
} as unknown as {
  new (): typeof realtimeEmitter;
};

export type RealtimeEmitter = typeof realtimeEmitter;


