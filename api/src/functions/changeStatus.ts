import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { TableClient, TableTransaction } from "@azure/data-tables";
import { randomUUID } from "node:crypto";

export async function changeStatus(
    request: HttpRequest,
    context: InvocationContext
): Promise<HttpResponseInit> {
    const reply = (status: number, error: string): HttpResponseInit => ({
        status,
        jsonBody: { error }
    });

    const connection = process.env.TABLES_CONNECTION_STRING;

    if (connection !== "UseDevelopmentStorage=true") {
        return reply(503, "Local development only.");
    }

    const taskId = request.params.id;
    const etag = request.headers.get("if-match");

    if (!taskId || !/^[0-9a-f-]{36}$/i.test(taskId)) {
        return reply(400, "Invalid task ID.");
    }

    if (!etag || etag.trim() === "*") {
        return reply(400, "A specific task ETag is required in If-Match.");
    }

    let body: unknown;

    try {
        body = await request.json();
    } catch {
        return reply(400, "Request must contain valid JSON.");
    }

    if (
        !body ||
        typeof body !== "object" ||
        !("status" in body) ||
        typeof body.status !== "string" ||
        !["Open", "In Progress", "Done"].includes(body.status)
    ) {
        return reply(400, "Status must be Open, In Progress or Done.");
    }

    const newStatus = body.status;
    const partition = "team:default";

    try {
        const client = TableClient.fromConnectionString(connection, "WorkItems");
        const task = await client.getEntity(partition, `task:${taskId}`);

        if (task.etag !== etag) {
            return reply(409, "Task changed. Refresh it and try again.");
        }

        if (task.Archived === true) {
            return reply(400, "Archived tasks cannot be updated.");
        }

        if (task.Status === newStatus) {
            return { status: 200, jsonBody: { changed: false } };
        }

        const now = new Date().toISOString();
        const actor = "local-developer";

        const eventType = newStatus === "Done"
            ? "TaskCompleted"
            : task.Status === "Done"
                ? "TaskReopened"
                : "StatusChanged";

        const transaction = new TableTransaction();

        transaction.updateEntity({
            partitionKey: partition,
            rowKey: `task:${taskId}`,
            Status: newStatus,
            ModifiedBy: actor,
            ModifiedAt: now,
            CompletedBy: newStatus === "Done" ? actor : "",
            CompletedAt: newStatus === "Done" ? now : ""
        }, "Merge", { etag });

        transaction.createEntity({
            partitionKey: partition,
            rowKey: `event:${taskId}:${randomUUID()}`,
            EntityType: "Event",
            TaskId: taskId,
            EventType: eventType,
            ActorMemberId: actor,
            OwnerIdAtEvent: String(task.OwnerId || ""),
            OccurredAtUtc: now,
            ChangesJson: JSON.stringify({
                status: {
                    oldValue: task.Status,
                    newValue: newStatus
                }
            })
        });

        await client.submitTransaction(transaction.actions);

        return {
            status: 200,
            jsonBody: {
                changed: true,
                taskId,
                status: newStatus,
                changedBy: actor,
                time: now
            }
        };
    } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;

        if (status === 412) {
            return reply(409, "Task changed. Refresh it and try again.");
        }

        if (status === 404) {
            return reply(404, "Task or required table not found.");
        }

        context.error("Status change failed", error);
        return reply(500, "Unable to change status.");
    }
}

app.http("changeStatus", {
    route: "tasks/{id}/status",
    methods: ["PATCH"],
    authLevel: "anonymous",
    handler: changeStatus
});
