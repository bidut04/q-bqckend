import { z } from "zod";

export const uploadAuthSchema = z.object({
    folder: z
        .enum([
            "hero",
            "hero-mobile",
            "hero-video",
        ]),
});

export const completeMediaSchema =
    z.object({
        providerAssetId: z
            .string()
            .min(1)
            .max(500),

        type: z.enum([
            "IMAGE",
            "VIDEO",
        ]),

        url: z
            .url(),

        thumbnailUrl: z
            .url()
            .optional(),

        fileName: z
            .string()
            .min(1)
            .max(255),

        mimeType: z
            .string()
            .min(1)
            .max(100),

        sizeBytes: z
            .number()
            .int()
            .positive()
            .max(100 * 1024 * 1024),

        width: z
            .number()
            .int()
            .positive()
            .optional(),

        height: z
            .number()
            .int()
            .positive()
            .optional(),

        durationSeconds: z
            .number()
            .positive()
            .optional(),

        folder: z
            .string()
            .max(200)
            .optional(),
    });