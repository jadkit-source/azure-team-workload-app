import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { TableClient } from "@azure/data-tables";

export async function members(
    request: HttpRequest,
    context: InvocationContext
): Promise<HttpResponseInit> {
    const connection = process.env.TABLES_CONNECTION_STRING;

    if (connection !== "UseDevelopmentStorage=true") {
        return {
            status: 503,
            jsonBody: { error: "Local development only." }
        };
    }

    try {
        const memberClient = TableClient.fromConnectionString(connection, "Members");
        const taskClient = TableClient.fromConnectionString(connection, "WorkItems");

        const team: {
            memberId: string;
            displayName: string;
            activeTasks: number;
        }[] = [];

        for await (const member of memberClient.listEntities({
            queryOptions: {
                filter: "PartitionKey eq 'team:default' and Enabled eq true"
            }
        })) {
            team.push({
                memberId: String(member.MemberId),
                displayName: String(member.DisplayName),
                activeTasks: 0
            });
        }

        const counts = new Map<string, number>();
        let unassigned = 0;
        let totalActive = 0;

        for await (const task of taskClient.listEntities({
            queryOptions: {
                filter: "PartitionKey eq 'team:default' and EntityType eq 'Task'"
            }
        })) {
            if (
                task.Archived === true ||
                (task.Status !== "Open" && task.Status !== "In Progress")
            ) {
                continue;
            }

            totalActive++;

            const ownerId = String(task.OwnerId || "");

            if (!ownerId) {
                unassigned++;
            } else {
                counts.set(ownerId, (counts.get(ownerId) || 0) + 1);
            }
        }

        for (const member of team) {
            member.activeTasks = counts.get(member.memberId) || 0;
        }

        team.sort((a, b) =>
            a.activeTasks - b.activeTasks ||
            a.displayName.localeCompare(b.displayName)
        );

        const enabledIds = new Set(team.map(member => member.memberId));
        let inactiveOwnerTasks = 0;

        for (const [ownerId, count] of counts) {
            if (!enabledIds.has(ownerId)) {
                inactiveOwnerTasks += count;
            }
        }

        return {
            status: 200,
            jsonBody: {
                members: team,
                unassigned,
                inactiveOwnerTasks,
                totalActive
            }
        };
    } catch (error) {
        context.error("Failed to read team workload", error);

        return {
            status: 500,
            jsonBody: { error: "Unable to read team workload." }
        };
    }
}

app.http("members", {
    methods: ["GET"],
    authLevel: "anonymous",
    handler: members
});
