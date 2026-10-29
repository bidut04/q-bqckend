import crypto from "crypto";
import { prisma } from "../../config/prisma";

import { getActiveTraceContext, formatTraceparent } from "../../lib/tracing/tracer";

export interface TenantWebhookConfig {
  url: string;
  secret: string;
  events?: string[]; // e.g. ["queue.entry.called", "queue.entry.completed", "booking.created"]
  enabled?: boolean;
}

export interface WebhookDeliveryPayload<T = unknown> {
  id: string;
  event: string;
  tenantId: string;
  timestamp: string;
  traceId?: string;
  spanId?: string;
  data: T;
}

const configCache = new Map<string, TenantWebhookConfig>();

/**
 * Register or update webhook config dynamically in-memory or from cache
 */
export const registerWebhookConfig = (tenantId: string, config: TenantWebhookConfig): void => {
  configCache.set(tenantId, config);
};

/**
 * Retrieves webhook configuration for a given tenant.
 * Checks local cache first, then falls back to tenant settings in DB.
 */
export const getTenantWebhookConfig = async (tenantId: string): Promise<TenantWebhookConfig | null> => {
  if (configCache.has(tenantId)) {
    return configCache.get(tenantId)!;
  }

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { setting: true },
    });

    const setting = tenant?.setting as Record<string, any> | null;
    if (setting && typeof setting.webhookUrl === "string" && setting.webhookUrl.startsWith("http")) {
      const config: TenantWebhookConfig = {
        url: setting.webhookUrl,
        secret: setting.webhookSecret || "whsec_default_secret_key",
        events: Array.isArray(setting.webhookEvents) ? setting.webhookEvents : ["*"],
        enabled: setting.webhookEnabled !== false,
      };
      configCache.set(tenantId, config);
      return config;
    }
  } catch (err) {
    console.warn(`[WebhookDispatcher] Failed to fetch settings for ${tenantId}:`, (err as Error).message);
  }

  return null;
};

/**
 * Computes HMAC-SHA256 signature for webhook payload verification
 */
export const generateWebhookSignature = (bodyString: string, secret: string): string => {
  return crypto.createHmac("sha256", secret).update(bodyString).digest("hex");
};

const deliverWithRetry = async (
  url: string,
  bodyString: string,
  meta: { deliveryId: string; eventType: string; signature: string; traceparent?: string; traceId?: string },
  maxAttempts = 3
): Promise<boolean> => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": "QueueFlow-Webhook-Engine/1.0",
        "X-QueueFlow-Event": meta.eventType,
        "X-QueueFlow-Delivery": meta.deliveryId,
        "X-QueueFlow-Signature": `sha256=${meta.signature}`,
      };

      if (meta.traceparent) {
        headers["traceparent"] = meta.traceparent;
      }
      if (meta.traceId) {
        headers["X-Trace-ID"] = meta.traceId;
      }

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: bodyString,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.ok) {
        return true;
      }

      console.warn(`[WebhookDispatcher] Attempt ${attempt} failed with status ${res.status}`);
    } catch (error) {
      console.warn(`[WebhookDispatcher] Attempt ${attempt} error:`, (error as Error).message);
    }

    // Exponential backoff wait (e.g. 500ms, 1500ms)
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, attempt * 500));
    }
  }

  return false;
};

/**
 * Asynchronously dispatches a webhook event with HMAC signature and exponential backoff retry
 */
export const dispatchWebhook = async <T = unknown>(
  tenantId: string,
  eventType: string,
  payload: T
): Promise<void> => {
  // Capture active trace before async deferral
  const activeTrace = getActiveTraceContext();
  const traceId = activeTrace?.traceId;
  const spanId = activeTrace?.spanId;
  const traceparent = traceId && spanId ? formatTraceparent(traceId, spanId) : undefined;

  // Non-blocking execution
  setImmediate(async () => {
    try {
      const config = await getTenantWebhookConfig(tenantId);
      if (!config || config.enabled === false) {
        return;
      }

      // Check event filter
      if (config.events && !config.events.includes("*") && !config.events.includes(eventType)) {
        return;
      }

      const deliveryId = `whd_${Date.now()}_${crypto.randomUUID().substring(0, 8)}`;
      const body: WebhookDeliveryPayload<T> = {
        id: deliveryId,
        event: eventType,
        tenantId,
        timestamp: new Date().toISOString(),
        traceId,
        spanId,
        data: payload,
      };

      const bodyString = JSON.stringify(body);
      const signature = generateWebhookSignature(bodyString, config.secret);

      await deliverWithRetry(config.url, bodyString, {
        deliveryId,
        eventType,
        signature,
        traceparent,
        traceId,
      });
    } catch (err) {
      console.warn(`[WebhookDispatcher] Error dispatching ${eventType} for ${tenantId}:`, (err as Error).message);
    }
  });
};


export const webhookDispatcher = {
  registerConfig: registerWebhookConfig,
  getTenantWebhookConfig,
  generateSignature: generateWebhookSignature,
  dispatch: dispatchWebhook,
};

export const WebhookDispatcher = function (this: unknown) {
  return webhookDispatcher;
} as unknown as {
  new (): typeof webhookDispatcher;
};

