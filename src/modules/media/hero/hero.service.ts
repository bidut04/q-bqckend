import type { Prisma } from "@prisma/client";
import { prisma } from "../../../config/prisma";
import { NotFoundError } from "../../../lib/errors";

import { heroRepository } from "./hero.repository";

import type {
    CreateHeroInput,
    ReorderHeroInput,
    UpdateHeroInput,
} from "./hero.types";

const getHero = async (id: string) => {
    const hero = await heroRepository.findById(id);

    if (!hero) {
        throw new NotFoundError("Hero not found");
    }

    return hero;
};

const listHeroes = (festivalId: string) =>
    heroRepository.findByFestivalId(festivalId);

const createHero = (input: CreateHeroInput) =>
    heroRepository.create({
        festivalId: input.festivalId,
        title: input.title,
        subtitle: input.subtitle,
        description: input.description,

        desktopMedia: input.desktopMediaId
            ? {
                  connect: {
                      id: input.desktopMediaId,
                  },
              }
            : undefined,

        mobileMedia: input.mobileMediaId
            ? {
                  connect: {
                      id: input.mobileMediaId,
                  },
              }
            : undefined,

        ctaLabel: input.ctaLabel,
        ctaUrl: input.ctaUrl,
        position: input.position,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
    });

const updateHero = async (id: string, input: UpdateHeroInput) => {
    await getHero(id);

    return heroRepository.update(id, {
        title: input.title,
        subtitle: input.subtitle,
        description: input.description,
        ctaLabel: input.ctaLabel,
        ctaUrl: input.ctaUrl,
        position: input.position,
        isVisible: input.isVisible,
        startsAt: input.startsAt,
        endsAt: input.endsAt,

        desktopMedia: input.desktopMediaId
            ? {
                  connect: {
                      id: input.desktopMediaId,
                  },
              }
            : undefined,

        mobileMedia: input.mobileMediaId
            ? {
                  connect: {
                      id: input.mobileMediaId,
                  },
              }
            : undefined,
    });
};

const reorderHeroes = async (items: ReorderHeroInput[]) => {
    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const offset = 10_000;

        for (const item of items) {
            await tx.hero.update({
                where: {
                    id: item.id,
                },
                data: {
                    position: item.position + offset,
                },
            });
        }

        for (const item of items) {
            await tx.hero.update({
                where: {
                    id: item.id,
                },
                data: {
                    position: item.position,
                },
            });
        }

        return tx.hero.findMany({
            where: {
                id: {
                    in: items.map((item) => item.id),
                },
            },
            orderBy: {
                position: "asc",
            },
        });
    });
};

export const heroService = {
    getHero,
    listHeroes,
    createHero,
    updateHero,
    reorderHeroes,
};