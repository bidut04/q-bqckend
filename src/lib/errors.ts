import { AppError } from "../utils/app-error";

export { AppError };

export class BadRequestError extends AppError {
    constructor(message = "Bad request") {
        super(message, 400, "BAD_REQUEST");
    }
}

export class UnauthorizedError extends AppError {
    constructor(message = "Unauthorized access") {
        super(message, 401, "UNAUTHORIZED");
    }
}

export class ForbiddenError extends AppError {
    constructor(message = "Access forbidden") {
        super(message, 403, "FORBIDDEN");
    }
}

export class NotFoundError extends AppError {
    constructor(message = "Resource not found") {
        super(message, 404, "NOT_FOUND");
    }
}

export class ConflictError extends AppError {
    constructor(message = "Resource conflict") {
        super(message, 409, "CONFLICT");
    }
}

export class InternalServerError extends AppError {
    constructor(message = "Internal server error") {
        super(message, 500, "INTERNAL_SERVER_ERROR");
    }
}
