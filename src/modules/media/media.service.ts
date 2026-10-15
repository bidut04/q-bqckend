import { imageKit } from "../../config/imagekit";
import { env } from "../../config/env";
import {
    BadRequestError,
    ConflictError,
} from "../../lib/errors";

import {
    mediaRepository,
} from "./media.repository";

import type {
    CompleteMediaUploadInput,
} from "./media.types";

const MAX_IMAGE_SIZE =
    25 * 1024 * 1024;

const MAX_VIDEO_SIZE =
    100 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES =
    new Set([
        "image/jpeg",
        "image/png",
        "image/webp",
    ]);

const ALLOWED_VIDEO_TYPES =
    new Set([
        "video/mp4",
        "video/webm",
    ]);

const getUploadAuthentication =
    () => {
        const {
            token,
            expire,
            signature,
        } =
            imageKit.helper
                .getAuthenticationParameters();

        return {
            token,
            expire,
            signature,
            publicKey:
                env.IMAGEKIT_PUBLIC_KEY,
        };
    };

const validateMedia =
    (input: CompleteMediaUploadInput) => {
        const isImage =
            input.type === "IMAGE";

        const allowedTypes =
            isImage
                ? ALLOWED_IMAGE_TYPES
                : ALLOWED_VIDEO_TYPES;

        if (
            !allowedTypes.has(input.mimeType)
        ) {
            throw new BadRequestError(
                "Unsupported media type",
            );
        }

        const maxSize =
            isImage
                ? MAX_IMAGE_SIZE
                : MAX_VIDEO_SIZE;

        if (input.sizeBytes > maxSize) {
            throw new BadRequestError(
                "Media file is too large",
            );
        }
    };

const completeUpload =
    async (
        input: CompleteMediaUploadInput,
        userId: string,
    ) => {
        validateMedia(input);

        const existing =
            await mediaRepository
                .findByProviderAssetId(
                    input.providerAssetId,
                );

        if (existing) {
            throw new ConflictError(
                "Media already exists",
            );
        }

        return mediaRepository.create({
            type: input.type,

            provider: "IMAGEKIT",

            providerAssetId:
                input.providerAssetId,

            url: input.url,

            thumbnailUrl:
                input.thumbnailUrl,

            fileName:
                input.fileName,

            mimeType:
                input.mimeType,

            sizeBytes:
                BigInt(input.sizeBytes),

            width: input.width,

            height: input.height,

            durationSeconds:
                input.durationSeconds,

            folder: input.folder,

            uploadedBy: {
                connect: {
                    id: userId,
                },
            },
        });
    };

export const mediaService = {
    getUploadAuthentication,
    completeUpload,
};