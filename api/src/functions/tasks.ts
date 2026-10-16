import { withAuthentication } from "../shared/auth";
import {
    app,
    HttpRequest,
    HttpResponseInit,
    InvocationContext
} from "@azure/functions";

import {
    TableClient
} from "@azure/data-tables";

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

export async function tasks(
    request: HttpRequest,
    context: InvocationContext
): Promise<HttpResponseInit> {

    const connection =
        process.env.TABLES_CONNECTION_STRING;

    // Local development only until authentication is implemented.
    if (!connection?.trim()) {
        return {
            status: 503,
            jsonBody: {
                error:
                    "Table Storage is not configured."
            }
        };
    }

    try {

        const client =
            TableClient.fromConnectionString(
                connection,
                "WorkItems"
            );

        const includeArchived =
            request.query.get("includeArchived") === "true";

        // Iterate over every Table Storage page, not just the first 100 rows.
        // Dashboard totals must represent all retained tasks, regardless
        // of the current table view or filters.
        const tasks: TaskEntity[] = [];
        const summary = { active: 0, done: 0, archived: 0 };

        for await (const task of client.listEntities<TaskEntity>({
            queryOptions: {
                filter: "PartitionKey eq 'team:default' and EntityType eq 'Task'"
            }
        })) {
            const archived = task.Archived === true;
            const status = task.Status ?? "Open";

            if (archived) {
                summary.archived++;
            } else if (status === "Done") {
                summary.done++;
            } else {
                summary.active++;
            }

            if (includeArchived ? archived : !archived) {
                tasks.push({
                    ...task,
                    Description: task.Description ?? "",
                    Note: task.Note ?? "",
                    OwnerId: task.OwnerId ?? "",
                    Status: status,
                    Priority: task.Priority ?? "Normal",
                    InScope:
                        task.InScope === "Yes" ||
                        task.InScope === "No" ||
                        task.InScope === "Grey"
                            ? task.InScope : "Grey",
                    Archived: archived
                });
            }
        }

        return {
            status: 200,
            jsonBody: {

                tasks,
                summary,
                continuationToken: null
            }
        };

    } catch (error) {

        context.error(
            "Failed to read tasks",
            error
        );

        return {
            status: 500,
            jsonBody: {
                error:
                    "Unable to read tasks."
            }
        };
    }
}

app.http("tasks", {
    methods: ["GET"],
    authLevel: "anonymous",
    handler: withAuthentication(tasks)
});
