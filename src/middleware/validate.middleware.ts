import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";

export const validate =
    (schema: ZodSchema) =>
    async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
        try {
            const parsed = (await schema.parseAsync({
                body: req.body,
                query: req.query,
                params: req.params,
            })) as Record<string, any>;

            if (parsed && typeof parsed === "object") {
                if ("body" in parsed && parsed.body !== undefined) req.body = parsed.body;
                if ("query" in parsed && parsed.query !== undefined) req.query = parsed.query;
                if ("params" in parsed && parsed.params !== undefined) req.params = parsed.params;
            }

            next();
        } catch (error) {
            next(error);
        }
    };
