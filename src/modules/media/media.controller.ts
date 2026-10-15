import type { Request, Response } from "express";
import { mediaService } from "./media.service";
import { UnauthorizedError } from "../../lib/errors";

export const getUploadAuthentication = (
    _req: Request,
    res: Response
) => {
    const data = mediaService.getUploadAuthentication();

    return res.status(200).json({
        success: true,
        data,
    });
};

export const completeUpload = async (
    req: Request,
    res: Response
) => {
    if (!req.user) {
        throw new UnauthorizedError("User is not authenticated");
    }

    const media = await mediaService.completeUpload(
        req.body,
        req.user.id
    );

    return res.status(201).json({
        success: true,
        data: media,
    });
};