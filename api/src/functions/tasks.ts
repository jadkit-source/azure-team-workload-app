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

        const page =
            client
                .listEntities({
                    queryOptions: {
                        filter:
                            "PartitionKey eq 'team:default' and EntityType eq 'Task'"
                    }
                })
                .byPage({
                    maxPageSize: 100
                });

        const firstPage =
            await page.next();

        const rawTasks: TaskEntity[] =
            firstPage.done
                ? []
                : (
                    Array.from(
                        firstPage.value
                    ) as TaskEntity[]
                );

        const includeArchived =
    request.query.get("includeArchived") === "true";

        const tasks =
            rawTasks
                .map((task) => ({
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
            }))
            .filter((task) =>
                includeArchived ||
                task.Archived !== true
        );

        return {
            status: 200,
            jsonBody: {

                tasks,

                continuationToken:
                    firstPage.done
                        ? null
                        : firstPage.value
                              .continuationToken
                              ?? null
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
