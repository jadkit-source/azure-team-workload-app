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

type InScopeValue = "Yes" | "No" | "Grey";

export async function createTask(
    request: HttpRequest,
    context: InvocationContext
): Promise<HttpResponseInit> {

    const connection = process.env.TABLES_CONNECTION_STRING;

    if (connection !== "UseDevelopmentStorage=true") {
        return {
            status: 503,
            jsonBody: {
                error: "Local development only."
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
        !("title" in body) ||
        typeof body.title !== "string" ||
        !body.title.trim() ||
        body.title.trim().length > 160
    ) {
        return {
            status: 400,
            jsonBody: {
                error: "Title must contain 1-160 characters."
            }
        };
    }

    const description =
        "description" in body && body.description !== undefined
            ? body.description
            : "";

    const note =
        "note" in body && body.note !== undefined
            ? body.note
            : "";

    if (
        typeof description !== "string" ||
        description.length > 4000
    ) {
        return {
            status: 400,
            jsonBody: {
                error: "Description must be a string of at most 4000 characters."
            }
        };
    }

    if (
        typeof note !== "string" ||
        note.length > 1000
    ) {
        return {
            status: 400,
            jsonBody: {
                error: "Note must be a string of at most 1000 characters."
            }
        };
    }

    let inScope: InScopeValue = "Grey";

    if (
        "inScope" in body &&
        body.inScope !== undefined
    ) {
        if (
            body.inScope !== "Yes" &&
            body.inScope !== "No" &&
            body.inScope !== "Grey"
        ) {
            return {
                status: 400,
                jsonBody: {
                    error: "InScope must be Yes, No, or Grey."
                }
            };
        }

        inScope = body.inScope;
    }

    const taskId = randomUUID();
    const now = new Date().toISOString();

    // Temporary identity until authentication is implemented.
    const actor = "local-developer";

    const task = {
        partitionKey: "team:default",
        rowKey: `task:${taskId}`,

        EntityType: "Task",
        TaskId: taskId,

        Title: body.title.trim(),
        Description: description.trim(),
        Note: note.trim(),

        OwnerId: "",
        Status: "Open",
        Priority: "Normal",
        InScope: inScope,
        Archived: false,

        CreatedBy: actor,
        CreatedAt: now,

        ModifiedBy: actor,
        ModifiedAt: now
    };

    const history = {
        partitionKey: "team:default",
        rowKey: `event:${taskId}:${randomUUID()}`,

        EntityType: "Event",
        TaskId: taskId,

        EventType: "TaskCreated",
        ActorMemberId: actor,
        OccurredAtUtc: now,

        ChangesJson: JSON.stringify({
            title: {
                oldValue: null,
                newValue: task.Title
            },

            description: {
                oldValue: null,
                newValue: task.Description
            },

            note: {
                oldValue: null,
                newValue: task.Note
            },

            ownerId: {
                oldValue: null,
                newValue: null
            },

            status: {
                oldValue: null,
                newValue: task.Status
            },

            priority: {
                oldValue: null,
                newValue: task.Priority
            },

            inScope: {
                oldValue: null,
                newValue: task.InScope
            }
        })
    };

    try {
        const client =
            TableClient.fromConnectionString(
                connection,
                "WorkItems"
            );

        const transaction =
            new TableTransaction();

        transaction.createEntity(task);
        transaction.createEntity(history);

        await client.submitTransaction(
            transaction.actions
        );

        return {
            status: 201,
            jsonBody: {
                task
            }
        };

    } catch (error) {

        context.error(
            "Failed to create task",
            error
        );

        return {
            status: 500,
            jsonBody: {
                error: "Unable to create task."
            }
        };
    }
}

app.http("createTask", {
    route: "tasks",
    methods: ["POST"],
    authLevel: "anonymous",
    handler: createTask
});
