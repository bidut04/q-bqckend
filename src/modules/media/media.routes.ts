import { Router } from "express";

import {
    getUploadAuthentication,
    completeUpload,
} from "./media.controller";

import { requireAuth } from "../../middleware/auth.middleware";
import { requireAdmin } from "../../middleware/admin.middleware";
import { validate } from "../../middleware/validate.middleware";

import { completeMediaSchema } from "./media.schema";

const router = Router();

router.get(
    "/upload-auth",
    requireAuth,
    requireAdmin,
    getUploadAuthentication,
);

router.post(
    "/complete",
    requireAuth,
    requireAdmin,
    validate(completeMediaSchema),
    completeUpload,
);

export default router;