import { getAuthenticatedActor, withAuthentication } from "../shared/auth";
import {
    app, HttpRequest, HttpResponseInit, InvocationContext
} from "@azure/functions";
import { TableClient, TableTransaction } from "@azure/data-tables";
import { randomUUID } from "node:crypto";

export async function changePriority(
    request: HttpRequest,
    context: InvocationContext
): Promise<HttpResponseInit> {
    const reply = (status: number, error: string): HttpResponseInit =>
        ({ status, jsonBody: { error } });

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
        !body || typeof body !== "object" ||
        !("priority" in body) || typeof body.priority !== "string" ||
        !["Low", "Normal", "High", "Critical"].includes(body.priority)
    ) {
        return reply(
            400,
            "Priority must be Low, Normal, High or Critical."
        );
    }

    const newPriority = body.priority;
    const partition = "team:default";

    try {
        const client = TableClient.fromConnectionString(connection, "WorkItems");
        const task = await client.getEntity(partition, `task:${taskId}`);

        if (task.Deleting === true) {
            return reply(409, "Task deletion is in progress.");
        }

        if (task.etag !== etag) {
            return reply(409, "Task changed. Refresh it and try again.");
        }

        if (task.Archived === true) {
            return reply(400, "Archived tasks cannot be updated.");
        }

        const oldPriority =
            typeof task.Priority === "string" ? task.Priority : "Normal";

        if (oldPriority === newPriority) {
            return { status: 200, jsonBody: { changed: false } };
        }

        const now = new Date().toISOString();
        const actor = getAuthenticatedActor(request).id;
        const transaction = new TableTransaction();

        transaction.updateEntity({
            partitionKey: partition,
            rowKey: `task:${taskId}`,
            Priority: newPriority,
            ModifiedBy: actor,
            ModifiedAt: now
        }, "Merge", { etag });

        transaction.createEntity({
            partitionKey: partition,
            rowKey: `event:${taskId}:${randomUUID()}`,
            EntityType: "Event",
            TaskId: taskId,
            EventType: "PriorityChanged",
            ActorMemberId: actor,
            OwnerIdAtEvent: String(task.OwnerId || ""),
            OccurredAtUtc: now,
            ChangesJson: JSON.stringify({
                priority: {
                    oldValue: oldPriority,
                    newValue: newPriority
                }
            })
        });

        await client.submitTransaction(transaction.actions);

        return {
            status: 200,
            jsonBody: {
                changed: true,
                taskId,
                priority: newPriority,
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
            return reply(404, "Task not found.");
        }

        context.error("Priority change failed", error);
        return reply(500, "Unable to change priority.");
    }
}

app.http("changePriority", {
    route: "tasks/{id}/priority",
    methods: ["PATCH"],
    authLevel: "anonymous",
    handler: withAuthentication(changePriority)
});
