import type {
    MediaType,
    MediaStatus,
} from "@prisma/client";

export type UploadAuthResponse = {
    token: string;
    expire: number;
    signature: string;
    publicKey: string;
};

export type CompleteMediaUploadInput = {
    providerAssetId: string;

    type: MediaType;

    url: string;
    thumbnailUrl?: string;

    fileName: string;
    mimeType: string;

    sizeBytes: number;

    width?: number;
    height?: number;
    durationSeconds?: number;

    folder?: string;
};

export type MediaResponse = {
    id: string;

    type: MediaType;
    status: MediaStatus;

    url: string;
    thumbnailUrl: string | null;

    fileName: string;
    mimeType: string;

    sizeBytes: string;

    width: number | null;
    height: number | null;
    durationSeconds: number | null;

    createdAt: Date;
};