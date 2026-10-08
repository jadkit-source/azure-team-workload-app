import {
    HttpRequest,
    HttpResponseInit,
    InvocationContext
} from "@azure/functions";

export type AuthenticatedActor = {
    id: string;
    displayName: string;
    identityProvider: string;
    roles: string[];
    isAdmin: boolean;
};

export class AuthorizationError extends Error {
    constructor(
        public readonly statusCode: number,
        message: string
    ) {
        super(message);
        this.name = "AuthorizationError";
    }
}

// This header is trusted only behind the SWA gateway.
// Locally, access APIs through the SWA emulator on port 4280.
// Production must use the SWA-managed API integration.
export function getAuthenticatedActor(
    request: HttpRequest
): AuthenticatedActor {
    const encoded = request.headers.get(
        "x-ms-client-principal"
    );

    if (!encoded || encoded.length > 32768) {
        throw new AuthorizationError(
            401,
            "Sign in to access the application."
        );
    }

    let principal: unknown;

    try {
        principal = JSON.parse(
            Buffer.from(encoded, "base64").toString("utf8")
        );
    } catch {
        throw new AuthorizationError(
            401,
            "Invalid authentication information."
        );
    }

    if (
        !principal ||
        typeof principal !== "object" ||
        !("identityProvider" in principal) ||
        principal.identityProvider !== "aad" ||
        !("userId" in principal) ||
        typeof principal.userId !== "string" ||
        !principal.userId.trim() ||
        !("userDetails" in principal) ||
        typeof principal.userDetails !== "string" ||
        !("userRoles" in principal) ||
        !Array.isArray(principal.userRoles) ||
        !principal.userRoles.every(
            role => typeof role === "string"
        )
    ) {
        throw new AuthorizationError(
            401,
            "A valid Microsoft sign-in is required."
        );
    }

    const roles = principal.userRoles as string[];

    if (!roles.includes("authenticated")) {
        throw new AuthorizationError(
            401,
            "Sign in to access the application."
        );
    }

    const isAdmin = roles.includes("admin");

    if (!isAdmin && !roles.includes("member")) {
        throw new AuthorizationError(
            403,
            "Your account has not been granted application access."
        );
    }

    return {
        id: principal.userId,
        displayName: principal.userDetails,
        identityProvider: principal.identityProvider,
        roles,
        isAdmin
    };
}

export function requireAdmin(
    actor: AuthenticatedActor
): void {
    if (!actor.isAdmin) {
        throw new AuthorizationError(
            403,
            "Administrator access is required."
        );
    }
}

type HttpHandler = (
    request: HttpRequest,
    context: InvocationContext
) => Promise<HttpResponseInit>;

export function withAuthentication(
    handler: HttpHandler
): HttpHandler {
    return async (request, context) => {
        try {
            getAuthenticatedActor(request);
            return await handler(request, context);
        } catch (error) {
            if (error instanceof AuthorizationError) {
                return {
                    status: error.statusCode,
                    jsonBody: { error: error.message }
                };
            }

            context.error("Authenticated request failed", error);

            return {
                status: 500,
                jsonBody: { error: "Unable to process request." }
            };
        }
    };
}
