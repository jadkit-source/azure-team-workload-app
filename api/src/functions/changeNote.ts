import {
    app, HttpRequest, HttpResponseInit, InvocationContext
} from "@azure/functions";
import { TableClient, TableTransaction } from "@azure/data-tables";
import { randomUUID } from "node:crypto";

interface TaskEntity {
    partitionKey: string;
    rowKey: string;
    EntityType?: string;
    TaskId?: string;
    Title?: string;
    Description?: string;
    Note?: string;
    OwnerId?: string;
    Status?: string;
    Priority?: string;
    InScope?: string;
    Archived?: boolean;
    Deleting?: boolean;
    CreatedBy?: string;
    CreatedAt?: string;
    ModifiedBy?: string;
    ModifiedAt?: string;
}

export async function changeNote(
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

    if (!taskId || !/^[0-9a-f-]{36}$/i.test(taskId)) {
        return reply(400, "Invalid task ID.");
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return reply(400, "Request must contain valid JSON.");
    }

    if (
        !body || typeof body !== "object" ||
        !("note" in body) || typeof body.note !== "string" ||
        body.note.length > 1000
    ) {
        return reply(
            400,
            "Note must be a string of at most 1000 characters."
        );
    }

    const newNote = body.note.trim();
    const partition = "team:default";

    try {
        const client = TableClient.fromConnectionString(connection, "WorkItems");
        const task = await client.getEntity<TaskEntity>(
            partition,
            `task:${taskId}`
        );

        if (task.EntityType !== "Task") {
            return reply(404, "Task not found.");
        }

        if (task.Deleting === true) {
            return reply(409, "Task deletion is in progress.");
        }

        const oldNote = task.Note ?? "";

        if (oldNote === newNote) {
            return {
                status: 200,
                jsonBody: { task, changed: false }
            };
        }

        const now = new Date().toISOString();
        const actor = "local-developer";
        const transaction = new TableTransaction();

        transaction.updateEntity({
            partitionKey: partition,
            rowKey: `task:${taskId}`,
            Note: newNote,
            ModifiedBy: actor,
            ModifiedAt: now
        }, "Merge", { etag: task.etag });

        transaction.createEntity({
            partitionKey: partition,
            rowKey: `event:${taskId}:${randomUUID()}`,
            EntityType: "Event",
            TaskId: taskId,
            EventType: "NoteChanged",
            ActorMemberId: actor,
            OwnerIdAtEvent: task.OwnerId ?? "",
            OccurredAtUtc: now,
            ChangesJson: JSON.stringify({
                note: {
                    oldValue: oldNote,
                    newValue: newNote
                }
            })
        });

        await client.submitTransaction(transaction.actions);

        const savedTask = await client.getEntity<TaskEntity>(
            partition,
            `task:${taskId}`
        );

        return {
            status: 200,
            jsonBody: {
                task: {
                    ...savedTask,
                    Description: savedTask.Description ?? "",
                    Note: savedTask.Note ?? "",
                    OwnerId: savedTask.OwnerId ?? "",
                    Status: savedTask.Status ?? "Open",
                    Priority: savedTask.Priority ?? "Normal",
                    InScope: savedTask.InScope ?? "Grey",
                    Archived: savedTask.Archived ?? false
                },
                changed: true
            }
        };
    } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;

        if (status === 404) {
            return reply(404, "Task not found.");
        }
        if (status === 409 || status === 412) {
            return reply(
                409,
                "The task was modified by another request. " +
                "Reload the task and try again."
            );
        }

        context.error("Failed to update task note", error);
        return reply(500, "Unable to update task note.");
    }
}

app.http("changeNote", {
    route: "tasks/{id}/note",
    methods: ["PATCH"],
    authLevel: "anonymous",
    handler: changeNote
});
