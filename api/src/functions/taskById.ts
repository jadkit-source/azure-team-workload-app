import {
    app,
    HttpRequest,
    HttpResponseInit,
    InvocationContext
} from "@azure/functions";

import { TableClient } from "@azure/data-tables";

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

    CompletedBy?: string;
    CompletedAt?: string;

    timestamp?: string;
}

export async function taskById(
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

    try {

        const client =
            TableClient.fromConnectionString(
                connection,
                "WorkItems"
            );

        const task =
            await client.getEntity<TaskEntity>(
                "team:default",
                `task:${taskId}`
            );

        if (task.EntityType !== "Task") {
            return {
                status: 404,
                jsonBody: {
                    error: "Task not found."
                }
            };
        }

        return {
            status: 200,
            jsonBody: {
                task: {
                    ...task,

                    Description:
                        task.Description ?? "",

                    Note:
                        task.Note ?? "",

                    OwnerId:
                        task.OwnerId ?? "",

                    Status:
                        task.Status ?? "Open",

                    Priority:
                        task.Priority ?? "Normal",

                    InScope:
                        task.InScope === "Yes" ||
                        task.InScope === "No" ||
                        task.InScope === "Grey"
                            ? task.InScope
                            : "Grey",

                    Archived:
                        task.Archived ?? false
                }
            }
        };

    } catch (error) {

        if (
            (error as { statusCode?: number })
                .statusCode === 404
        ) {
            return {
                status: 404,
                jsonBody: {
                    error: "Task not found."
                }
            };
        }

        context.error(
            "Failed to read task",
            error
        );

        return {
            status: 500,
            jsonBody: {
                error: "Unable to read task."
            }
        };
    }
}

app.http("taskById", {
    route: "tasks/{id}",
    methods: ["GET"],
    authLevel: "anonymous",
    handler: taskById
});
