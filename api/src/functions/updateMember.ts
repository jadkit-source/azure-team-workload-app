import {
    app,
    HttpRequest,
    HttpResponseInit,
    InvocationContext
} from "@azure/functions";

import { TableClient } from "@azure/data-tables";

import {
    getAuthenticatedActor,
    requireAdmin,
    withAuthentication
} from "../shared/auth";

import { TEAM_PARTITION } from "../shared/storage";

async function updateMember(
    request: HttpRequest,
    context: InvocationContext
): Promise<HttpResponseInit> {
    const actor = getAuthenticatedActor(request);
    requireAdmin(actor);

    const memberId = request.params.id;

    if (!memberId || !/^[a-zA-Z0-9._@-]{1,256}$/.test(memberId)) {
        return {
            status: 400,
            jsonBody: { error: "Invalid member ID." }
        };
    }

    let body: unknown;

    try {
        body = await request.json();
    } catch {
        return {
            status: 400,
            jsonBody: { error: "Invalid JSON request." }
        };
    }

    if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body)
    ) {
        return {
            status: 400,
            jsonBody: { error: "Invalid update information." }
        };
    }

    const input = body as Record<string, unknown>;

    const hasName = Object.prototype.hasOwnProperty.call(
        input,
        "displayName"
    );

    const hasEnabled = Object.prototype.hasOwnProperty.call(
        input,
        "enabled"
    );

    if (!hasName && !hasEnabled) {
        return {
            status: 400,
            jsonBody: { error: "No update fields provided." }
        };
    }

    if (
        (hasName &&
            (typeof input.displayName !== "string" ||
                !input.displayName.trim() ||
                input.displayName.trim().length > 100)) ||
        (hasEnabled && typeof input.enabled !== "boolean")
    ) {
        return {
            status: 400,
            jsonBody: { error: "Invalid update values." }
        };
    }

    if (memberId === actor.id && input.enabled === false) {
        return {
            status: 403,
            jsonBody: {
                error: "Administrators cannot disable their own account."
            }
        };
    }

    const connection = process.env.TABLES_CONNECTION_STRING;

    if (!connection?.trim()) {
        return {
            status: 503,
            jsonBody: { error: "Membership service is unavailable." }
        };
    }

    try {
        const client = TableClient.fromConnectionString(
            connection,
            "Members"
        );

        const existing = await client.getEntity(
            TEAM_PARTITION,
            memberId
        );

        // Update only the permitted properties.
        const changes: {
            partitionKey: string;
            rowKey: string;
            DisplayName?: string;
            Enabled?: boolean;
        } = {
            partitionKey: TEAM_PARTITION,
            rowKey: memberId
        };

        if (hasName) {
            changes.DisplayName =
                (input.displayName as string).trim();
        }

        if (hasEnabled) {
            changes.Enabled = input.enabled as boolean;
        }

        await client.updateEntity(changes, "Merge", {
            etag: existing.etag
        });

        return {
            status: 200,
            jsonBody: {
                memberId,
                displayName:
                    changes.DisplayName ??
                    String(existing.DisplayName),
                enabled:
                    changes.Enabled ??
                    (existing.Enabled === true)
            }
        };
    } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;

        if (status === 404) {
            return {
                status: 404,
                jsonBody: { error: "Member not found." }
            };
        }

        if (status === 412) {
            return {
                status: 409,
                jsonBody: {
                    error: "Member was modified by another administrator."
                }
            };
        }

        context.error("Failed to update member", error);

        return {
            status: 503,
            jsonBody: { error: "Unable to update member." }
        };
    }
}

app.http("updateMember", {
    methods: ["PATCH"],
    route: "management/members/{id}",
    authLevel: "anonymous",
    handler: withAuthentication(updateMember)
});
