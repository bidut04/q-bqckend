import type {
    Prisma,
} from "@prisma/client";

import { prisma } from "../../../config/prisma";

export const heroRepository = {
    findById: (id: string) =>
        prisma.hero.findUnique({
            where: { id },

            include: {
                desktopMedia: true,
                mobileMedia: true,
            },
        }),

    findByFestivalId: (
        festivalId: string,
    ) =>
        prisma.hero.findMany({
            where: {
                festivalId,
            },

            include: {
                desktopMedia: true,
                mobileMedia: true,
            },

            orderBy: {
                position: "asc",
            },
        }),

    create: (
        data: Prisma.HeroCreateInput,
    ) =>
        prisma.hero.create({
            data,

            include: {
                desktopMedia: true,
                mobileMedia: true,
            },
        }),

    update: (
        id: string,
        data: Prisma.HeroUpdateInput,
    ) =>
        prisma.hero.update({
            where: { id },
            data,

            include: {
                desktopMedia: true,
                mobileMedia: true,
            },
        }),

    delete: (id: string) =>
        prisma.hero.delete({
            where: { id },
        }),
};