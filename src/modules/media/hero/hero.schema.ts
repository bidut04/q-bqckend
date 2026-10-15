import { z } from "zod";

export const createHeroSchema =
    z.object({
        festivalId:
            z.string().cuid(),

        title:
            z.string()
                .trim()
                .min(1)
                .max(120),

        subtitle:
            z.string()
                .trim()
                .max(200)
                .optional(),

        description:
            z.string()
                .trim()
                .max(2000)
                .optional(),

        desktopMediaId:
            z.string()
                .cuid()
                .optional(),

        mobileMediaId:
            z.string()
                .cuid()
                .optional(),

        ctaLabel:
            z.string()
                .trim()
                .max(50)
                .optional(),

        ctaUrl:
            z.string()
                .max(500)
                .optional(),

        position:
            z.number()
                .int()
                .min(1),

        startsAt:
            z.coerce.date()
                .optional(),

        endsAt:
            z.coerce.date()
                .optional(),
    });

export const updateHeroSchema =
    createHeroSchema
        .omit({
            festivalId: true,
        })
        .partial()
        .extend({
            isVisible:
                z.boolean().optional(),
        });

export const reorderHeroSchema =
    z.object({
        items:
            z.array(
                z.object({
                    id:
                        z.string().cuid(),

                    position:
                        z.number()
                            .int()
                            .min(1),
                }),
            )
                .min(1),
    });