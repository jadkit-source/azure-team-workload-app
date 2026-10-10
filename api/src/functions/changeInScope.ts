import { getAuthenticatedActor, withAuthentication } from "../shared/auth";
import {
    app, HttpRequest, HttpResponseInit, InvocationContext
} from "@azure/functions";
import { TableClient, TableTransaction } from "@azure/data-tables";
import { randomUUID } from "node:crypto";

export async function changeInScope(
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
        !("inScope" in body) || typeof body.inScope !== "string" ||
        !["Yes", "No", "Grey"].includes(body.inScope)
    ) {
        return reply(400, "InScope must be Yes, No or Grey.");
    }

    const newInScope = body.inScope;
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

        const oldInScope =
            task.InScope === "Yes" ||
            task.InScope === "No" ||
            task.InScope === "Grey"
                ? String(task.InScope)
                : "Grey";

        if (oldInScope === newInScope) {
            return { status: 200, jsonBody: { changed: false } };
        }

        const now = new Date().toISOString();
        const actor = getAuthenticatedActor(request).id;
        const transaction = new TableTransaction();

        transaction.updateEntity({
            partitionKey: partition,
            rowKey: `task:${taskId}`,
            InScope: newInScope,
            ModifiedBy: actor,
            ModifiedAt: now
        }, "Merge", { etag });

        transaction.createEntity({
            partitionKey: partition,
            rowKey: `event:${taskId}:${randomUUID()}`,
            EntityType: "Event",
            TaskId: taskId,
            EventType: "InScopeChanged",
            ActorMemberId: actor,
            OwnerIdAtEvent: String(task.OwnerId || ""),
            OccurredAtUtc: now,
            ChangesJson: JSON.stringify({
                inScope: {
                    oldValue: oldInScope,
                    newValue: newInScope
                }
            })
        });

        await client.submitTransaction(transaction.actions);

        return {
            status: 200,
            jsonBody: {
                changed: true,
                taskId,
                inScope: newInScope,
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

        context.error("InScope change failed", error);
        return reply(500, "Unable to change InScope.");
    }
}

app.http("changeInScope", {
    route: "tasks/{id}/inscope",
    methods: ["PATCH"],
    authLevel: "anonymous",
    handler: withAuthentication(changeInScope)
});
