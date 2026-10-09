import { withAuthentication } from "../shared/auth";
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { TableClient } from "@azure/data-tables";

export async function taskHistory(
    request: HttpRequest,
    context: InvocationContext
): Promise<HttpResponseInit> {
    const connection = process.env.TABLES_CONNECTION_STRING;

    if (!connection?.trim()) {
        return {
            status: 503,
            jsonBody: { error: "Table Storage is not configured." }
        };
    }

    const taskId = request.params.id;

    if (!taskId || !/^[0-9a-f-]{36}$/i.test(taskId)) {
        return {
            status: 400,
            jsonBody: { error: "Invalid task ID." }
        };
    }

    try {
        const client = TableClient.fromConnectionString(connection, "WorkItems");

        await client.getEntity("team:default", `task:${taskId}`);

        const history: {
            eventId: string;
            eventType: string;
            changedBy: string;
            time: string;
            ownerIdAtEvent: string | null;
            changes: unknown;
        }[] = [];

        for await (const event of client.listEntities({
            queryOptions: {
                filter:
                    "PartitionKey eq 'team:default' and EntityType eq 'Event'" +
                    ` and TaskId eq '${taskId}'`
            }
        })) {
            history.push({
                eventId: String(event.rowKey),
                eventType: String(event.EventType),
                changedBy: String(event.ActorMemberId),
                time: String(event.OccurredAtUtc),
                ownerIdAtEvent: event.OwnerIdAtEvent
                    ? String(event.OwnerIdAtEvent)
                    : null,
                changes: JSON.parse(String(event.ChangesJson))
            });
        }

        history.sort((a, b) =>
            a.time.localeCompare(b.time) ||
            a.eventId.localeCompare(b.eventId)
        );

        return {
            status: 200,
            jsonBody: { taskId, history }
        };
    } catch (error) {
        if ((error as { statusCode?: number }).statusCode === 404) {
            return {
                status: 404,
                jsonBody: { error: "Task or required table not found." }
            };
        }

        context.error("Failed to read task history", error);

        return {
            status: 500,
            jsonBody: { error: "Unable to read task history." }
        };
    }
}

app.http("taskHistory", {
    route: "tasks/{id}/history",
    methods: ["GET"],
    authLevel: "anonymous",
    handler: withAuthentication(taskHistory)
});
