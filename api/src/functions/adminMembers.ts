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

async function adminMembers(
    request: HttpRequest,
    context: InvocationContext
): Promise<HttpResponseInit> {
    // Authentication and enabled-member checks
    // are performed by withAuthentication().
    const actor = getAuthenticatedActor(request);
    requireAdmin(actor);

    const connection = process.env.TABLES_CONNECTION_STRING;

    if (!connection?.trim()) {
        return {
            status: 503,
            jsonBody: { error: "Membership service is unavailable." }
        };
    }

    try {
        const memberClient = TableClient.fromConnectionString(
            connection,
            "Members"
        );

        const taskClient = TableClient.fromConnectionString(
            connection,
            "WorkItems"
        );

        const members: {
            memberId: string;
            displayName: string;
            enabled: boolean;
            activeTasks: number;
        }[] = [];

        for await (const member of memberClient.listEntities({
            queryOptions: {
                filter: `PartitionKey eq '${TEAM_PARTITION}'`
            }
        })) {
            members.push({
                memberId: String(member.MemberId ?? member.rowKey),
                displayName: String(member.DisplayName ?? ""),
                enabled: member.Enabled === true,
                activeTasks: 0
            });
        }

        const counts = new Map<string, number>();

        for await (const task of taskClient.listEntities({
            queryOptions: {
                filter:
                    `PartitionKey eq '${TEAM_PARTITION}' and EntityType eq 'Task'`
            }
        })) {
            if (
                task.Archived === true ||
                (task.Status !== "Open" &&
                    task.Status !== "In Progress")
            ) {
                continue;
            }

            const ownerId = String(task.OwnerId ?? "");

            if (ownerId) {
                counts.set(
                    ownerId,
                    (counts.get(ownerId) ?? 0) + 1
                );
            }
        }

        for (const member of members) {
            member.activeTasks =
                counts.get(member.memberId) ?? 0;
        }

        members.sort((a, b) =>
            a.displayName.localeCompare(b.displayName)
        );

        return {
            status: 200,
            jsonBody: { members }
        };
    } catch (error) {
        context.error("Unable to list admin members", error);

        return {
            status: 503,
            jsonBody: {
                error: "Unable to retrieve member information."
            }
        };
    }
}

app.http("adminMembers", {
    methods: ["GET"],
    route: "management/members",
    authLevel: "anonymous",
    handler: withAuthentication(adminMembers)
});
