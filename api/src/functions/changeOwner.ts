import { getAuthenticatedActor, withAuthentication } from "../shared/auth";
import {
    app, HttpRequest, HttpResponseInit, InvocationContext
} from "@azure/functions";
import { TableClient, TableTransaction } from "@azure/data-tables";
import { randomUUID } from "node:crypto";

export async function changeOwner(
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
        !("ownerId" in body) || typeof body.ownerId !== "string" ||
        (body.ownerId !== "" &&
            !/^[a-zA-Z0-9-]{1,64}$/.test(body.ownerId))
    ) {
        return reply(
            400,
            "Provide a valid ownerId, or an empty string for Unassigned."
        );
    }

    const ownerId = body.ownerId;
    const partition = "team:default";

    try {
        const tasks = TableClient.fromConnectionString(connection, "WorkItems");
        const members = TableClient.fromConnectionString(connection, "Members");
        const task = await tasks.getEntity(partition, `task:${taskId}`);

        if (task.Deleting === true) {
            return reply(409, "Task deletion is in progress.");
        }

        if (task.etag !== etag) {
            return reply(409, "Task changed. Refresh it and try again.");
        }

        if (task.Archived === true) {
            return reply(400, "Archived tasks cannot be reassigned.");
        }

        if (ownerId !== "") {
            try {
                const member = await members.getEntity(partition, ownerId);

                if (member.Enabled !== true) {
                    return reply(400, "Selected member is disabled.");
                }
            } catch (error) {
                if (
                    (error as { statusCode?: number }).statusCode === 404
                ) {
                    return reply(400, "Selected member does not exist.");
                }
                throw error;
            }
        }

        if (task.OwnerId === ownerId) {
            return { status: 200, jsonBody: { changed: false } };
        }

        const now = new Date().toISOString();
        const actor = getAuthenticatedActor(request).id;
        const transaction = new TableTransaction();

        transaction.updateEntity({
            partitionKey: partition,
            rowKey: `task:${taskId}`,
            OwnerId: ownerId,
            ModifiedBy: actor,
            ModifiedAt: now
        }, "Merge", { etag });

        transaction.createEntity({
            partitionKey: partition,
            rowKey: `event:${taskId}:${randomUUID()}`,
            EntityType: "Event",
            TaskId: taskId,
            EventType: "OwnerChanged",
            ActorMemberId: actor,
            OccurredAtUtc: now,
            ChangesJson: JSON.stringify({
                ownerId: {
                    oldValue: task.OwnerId || null,
                    newValue: ownerId || null
                }
            })
        });

        await tasks.submitTransaction(transaction.actions);

        return {
            status: 200,
            jsonBody: {
                changed: true,
                taskId,
                ownerId,
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

        context.error("Owner change failed", error);
        return reply(500, "Unable to change owner.");
    }
}

app.http("changeOwner", {
    route: "tasks/{id}/owner",
    methods: ["PATCH"],
    authLevel: "anonymous",
    handler: withAuthentication(changeOwner)
});
