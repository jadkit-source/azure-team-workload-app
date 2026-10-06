import {
    app,
    HttpRequest,
    HttpResponseInit,
    InvocationContext
} from "@azure/functions";

import {
    TableClient,
    TableTransaction
} from "@azure/data-tables";

import { randomUUID } from "node:crypto";

interface TaskEntity {
    partitionKey: string;
    rowKey: string;
    etag?: string;

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

    CreatedBy?: string;
    CreatedAt?: string;

    ModifiedBy?: string;
    ModifiedAt?: string;

    timestamp?: string;
}

export async function changeNote(
    request: HttpRequest,
    context: InvocationContext
): Promise<HttpResponseInit> {

    const connection =
        process.env.TABLES_CONNECTION_STRING;

    if (
        connection !==
        "UseDevelopmentStorage=true"
    ) {
        return {
            status: 503,
            jsonBody: {
                error: "Local development only."
            }
        };
    }

    const taskId = request.params.id;

    if (
        !taskId ||
        !/^[0-9a-f-]{36}$/i.test(taskId)
    ) {
        return {
            status: 400,
            jsonBody: {
                error: "Invalid task ID."
            }
        };
    }

    let body: unknown;

    try {
        body = await request.json();
    } catch {
        return {
            status: 400,
            jsonBody: {
                error: "Request must contain valid JSON."
            }
        };
    }

    if (
        !body ||
        typeof body !== "object" ||
        !("note" in body) ||
        typeof body.note !== "string" ||
        body.note.length > 4000
    ) {
        return {
            status: 400,
            jsonBody: {
                error: "Note must be a string of at most 4000 characters."
            }
        };
    }

    const newNote = body.note.trim();

    const now = new Date().toISOString();

    // Temporary local identity.
    const actor = "local-developer";

    try {

        const client =
            TableClient.fromConnectionString(
                connection,
                "WorkItems"
            );

        const existingTask =
            await client.getEntity<TaskEntity>(
                "team:default",
                `task:${taskId}`
            );

        if (
            existingTask.EntityType !== "Task"
        ) {
            return {
                status: 404,
                jsonBody: {
                    error: "Task not found."
                }
            };
        }

        const oldNote =
            existingTask.Note ?? "";

        if (oldNote === newNote) {
            return {
                status: 200,
                jsonBody: {
                    task: existingTask,
                    changed: false
                }
            };
        }

        const updatedTask = {
            partitionKey:
                existingTask.partitionKey,

            rowKey:
                existingTask.rowKey,

            EntityType:
                existingTask.EntityType,

            TaskId:
                existingTask.TaskId,

            Title:
                existingTask.Title ?? "",

            Description:
                existingTask.Description ?? "",

            Note:
                newNote,

            OwnerId:
                existingTask.OwnerId ?? "",

            Status:
                existingTask.Status ?? "Open",

            Priority:
                existingTask.Priority ?? "Normal",

            InScope:
                existingTask.InScope ?? "Grey",

            Archived:
                existingTask.Archived ?? false,

            CreatedBy:
                existingTask.CreatedBy ?? "",

            CreatedAt:
                existingTask.CreatedAt ?? "",

            ModifiedBy:
                actor,

            ModifiedAt:
                now
        };

        const history = {
            partitionKey:
                "team:default",

            rowKey:
                `event:${taskId}:${randomUUID()}`,

            EntityType:
                "Event",

            TaskId:
                taskId,

            EventType:
                "NoteChanged",

            ActorMemberId:
                actor,

            OwnerIdAtEvent:
                existingTask.OwnerId ?? "",

            OccurredAtUtc:
                now,

            ChangesJson:
                JSON.stringify({
                    note: {
                        oldValue:
                            oldNote,

                        newValue:
                            newNote
                    }
                })
        };

        const transaction =
            new TableTransaction();

        /*
         * updateEntity with "Merge" changes only the supplied
         * properties and keeps the other task properties.
         *
         * The ETag prevents silently overwriting another user's
         * update if the task changed after we read it.
         */
        transaction.updateEntity(
            updatedTask,
            "Merge",
            {
                etag:
                    existingTask.etag
            }
        );

        transaction.createEntity(
            history
        );

        await client.submitTransaction(
            transaction.actions
        );

        const savedTask =
            await client.getEntity<TaskEntity>(
                "team:default",
                `task:${taskId}`
            );

        return {
            status: 200,
            jsonBody: {
                task: {
                    ...savedTask,

                    Description:
                        savedTask.Description ?? "",

                    Note:
                        savedTask.Note ?? "",

                    OwnerId:
                        savedTask.OwnerId ?? "",

                    Status:
                        savedTask.Status ?? "Open",

                    Priority:
                        savedTask.Priority ?? "Normal",

                    InScope:
                        savedTask.InScope ?? "Grey",

                    Archived:
                        savedTask.Archived ?? false
                },

                changed: true
            }
        };

    } catch (error) {

        const statusCode =
            (error as {
                statusCode?: number
            }).statusCode;

        if (statusCode === 404) {
            return {
                status: 404,
                jsonBody: {
                    error: "Task not found."
                }
            };
        }

        if (
            statusCode === 409 ||
            statusCode === 412
        ) {
            return {
                status: 409,
                jsonBody: {
                    error:
                        "The task was modified by another request. Reload the task and try again."
                }
            };
        }

        context.error(
            "Failed to update task note",
            error
        );

        return {
            status: 500,
            jsonBody: {
                error:
                    "Unable to update task note."
            }
        };
    }
}

app.http("changeNote", {
    route: "tasks/{id}/note",
    methods: ["PATCH"],
    authLevel: "anonymous",
    handler: changeNote
});
