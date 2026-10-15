export type CreateHeroInput = {
    festivalId: string;

    title: string;
    subtitle?: string;
    description?: string;

    desktopMediaId?: string;
    mobileMediaId?: string;

    ctaLabel?: string;
    ctaUrl?: string;

    position: number;

    startsAt?: Date;
    endsAt?: Date;
};

export type UpdateHeroInput =
    Partial<
        Omit<
            CreateHeroInput,
            "festivalId"
        >
    > & {
        isVisible?: boolean;
    };

export type ReorderHeroInput = {
    id: string;
    position: number;
};