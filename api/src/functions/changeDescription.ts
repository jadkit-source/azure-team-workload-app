
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { TableClient, TableTransaction } from "@azure/data-tables";
import { randomUUID } from "node:crypto";
import { getAuthenticatedActor, withAuthentication } from "../shared/auth";
import { canEditDescription } from "../shared/permissions";

export async function changeDescription(
    request: HttpRequest,
    context: InvocationContext
): Promise<HttpResponseInit> {
    const reply = (status: number, error: string): HttpResponseInit =>
        ({ status, jsonBody: { error } });

    const connection = process.env.TABLES_CONNECTION_STRING;
    if (!connection?.trim()) {
        return reply(503, "Table Storage is not configured.");
    }

    const taskId = request.params.id;
    if (!taskId || !/^[0-9a-f-]{36}$/i.test(taskId)) {
        return reply(400, "Invalid task ID.");
    }

    const etag = request.headers.get("if-match");
    if (!etag || etag === "*") {
        return reply(400, "A specific task ETag is required.");
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return reply(400, "Request must contain valid JSON.");
    }

    if (
        !body || typeof body !== "object" ||
        !("description" in body) ||
        typeof body.description !== "string" ||
        body.description.length > 4000
    ) {
        return reply(400, "Description must be at most 4000 characters.");
    }

    const description = body.description.trim();
    const actor = getAuthenticatedActor(request);
    const partition = "team:default";

    try {
        const client = TableClient.fromConnectionString(
            connection, "WorkItems"
        );

        const task = await client.getEntity<{
            CreatedBy?: string;
            EntityType?: string;
            Description?: string;
            OwnerId?: string;
            Archived?: boolean;
            Deleting?: boolean;
        }>(
            partition, `task:${taskId}`
        );

        if (task.EntityType !== "Task") {
            return reply(404, "Task not found.");
        }

        // Authorization must be enforced by the API,
        // not only by the frontend.
        if (!canEditDescription(task, actor)) {
            return reply(403, "Only the task creator can edit Description.");
        }

        if (task.Deleting === true || task.Archived === true) {
            return reply(409, "This task cannot be edited.");
        }

        if (task.etag !== etag) {
            return reply(409, "Task changed. Refresh and try again.");
        }

        const oldDescription = String(task.Description ?? "");

        if (oldDescription === description) {
            return { status: 200, jsonBody: { changed: false } };
        }

        const now = new Date().toISOString();
        const transaction = new TableTransaction();

        transaction.updateEntity({
            partitionKey: partition,
            rowKey: `task:${taskId}`,
            Description: description,
            ModifiedBy: actor.id,
            ModifiedAt: now
        }, "Merge", { etag });

        transaction.createEntity({
            partitionKey: partition,
            rowKey: `event:${taskId}:${randomUUID()}`,
            EntityType: "Event",
            TaskId: taskId,
            EventType: "DescriptionChanged",
            ActorMemberId: actor.id,
            OwnerIdAtEvent: String(task.OwnerId ?? ""),
            OccurredAtUtc: now,
            ChangesJson: JSON.stringify({
                description: {
                    oldValue: oldDescription,
                    newValue: description
                }
            })
        });

        await client.submitTransaction(transaction.actions);

        return {
            status: 200,
            jsonBody: { changed: true }
        };
    } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;

        if (status === 404) {
            return reply(404, "Task not found.");
        }

        if (status === 409 || status === 412) {
            return reply(409, "Task changed. Refresh and try again.");
        }

        context.error("Description update failed", error);
        return reply(500, "Unable to update Description.");
    }
}

app.http("changeDescription", {
    route: "tasks/{id}/description",
    methods: ["PATCH"],
    authLevel: "anonymous",
    handler: withAuthentication(changeDescription)
});
