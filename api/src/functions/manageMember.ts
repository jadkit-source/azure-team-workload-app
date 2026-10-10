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

async function createMember(
    request: HttpRequest,
    context: InvocationContext
): Promise<HttpResponseInit> {
    const actor = getAuthenticatedActor(request);
    requireAdmin(actor);

    let body: unknown;

    try {
        body = await request.json();
    } catch {
        return {
            status: 400,
            jsonBody: { error: "Invalid JSON request." }
        };
    }

    if (!body || typeof body !== "object") {
        return {
            status: 400,
            jsonBody: { error: "Invalid member information." }
        };
    }

    const input = body as Record<string, unknown>;

    const memberId = input.memberId;
    const displayName = input.displayName;

    if (
        typeof memberId !== "string" ||
        !memberId.trim() ||
        memberId.length > 256 ||
        typeof displayName !== "string" ||
        !displayName.trim() ||
        displayName.trim().length > 100
    ) {
        return {
            status: 400,
            jsonBody: {
                error: "Valid memberId and displayName are required."
            }
        };
    }

    const id = memberId.trim();
    const name = displayName.trim();

    // Member IDs must be Azure SWA principal user IDs.
    // We will obtain them from /.auth/me after invitation.
    if (
        !/^[a-zA-Z0-9._@-]+$/.test(id)
    ) {
        return {
            status: 400,
            jsonBody: { error: "Invalid member ID format." }
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

        // createEntity rejects duplicate IDs, so existing
        // memberships cannot be silently overwritten.
        await client.createEntity({
            partitionKey: TEAM_PARTITION,
            rowKey: id,
            MemberId: id,
            DisplayName: name,
            Enabled: true
        });

        return {
            status: 201,
            jsonBody: {
                memberId: id,
                displayName: name,
                enabled: true
            }
        };
    } catch (error) {
        if (
            (error as { statusCode?: number }).statusCode === 409
        ) {
            return {
                status: 409,
                jsonBody: { error: "Member already exists." }
            };
        }

        context.error("Failed to create member", error);

        return {
            status: 503,
            jsonBody: { error: "Unable to create member." }
        };
    }
}

app.http("createMember", {
    methods: ["POST"],
    route: "management/members",
    authLevel: "anonymous",
    handler: withAuthentication(createMember)
});
