import type { Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";

export const mediaRepository = {
    create: (
        data: Prisma.MediaCreateInput,
    ) =>
        prisma.media.create({
            data,
        }),

    findById: (id: string) =>
        prisma.media.findUnique({
            where: { id },
        }),

    findByProviderAssetId: (
        providerAssetId: string,
    ) =>
        prisma.media.findUnique({
            where: {
                providerAssetId,
            },
        }),

    softDelete: (id: string) =>
        prisma.media.update({
            where: { id },
            data: {
                status: "DELETED",
            },
        }),
};