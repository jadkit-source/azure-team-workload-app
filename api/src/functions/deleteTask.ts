import { withAuthentication } from "../shared/auth";
import {
    app,
    HttpRequest,
    HttpResponseInit,
    InvocationContext
} from "@azure/functions";

import {
    canDeleteTask,
    getLocalActor,
    TaskPermissions
} from "../shared/permissions";

import {
    attachmentPrefix,
    deleteTaskBlobs,
    getTableClient,
    TEAM_PARTITION
} from "../shared/storage";

interface DeletionTask extends TaskPermissions {
    EntityType?: string;
    TaskId?: string;
    Deleting?: boolean;
    DeletionStartedAt?: string;
    DeletionStartedBy?: string;
}

export async function deleteTask(
    request: HttpRequest,
    context: InvocationContext
): Promise<HttpResponseInit> {
    const reply = (
        status: number,
        error: string
    ): HttpResponseInit => ({
        status,
        jsonBody: { error }
    });

    if (
        !process.env.TABLES_CONNECTION_STRING?.trim() ||
        !process.env.BLOBS_CONNECTION_STRING?.trim()
    ) {
        return reply(503, "Storage is not configured.");
    }

    const taskId = request.params.id;

    try {
        attachmentPrefix(taskId);
    } catch {
        return reply(400, "Invalid task ID.");
    }

    const requestedEtag = request.headers.get("if-match");

    if (!requestedEtag || requestedEtag.trim() === "*") {
        return reply(
            400,
            "A specific task ETag is required in If-Match."
        );
    }

    const actor = getLocalActor(request);
    const client = getTableClient();
    const rowKey = `task:${taskId}`;

    let cleanupStarted = false;

    try {
        let task = await client.getEntity<DeletionTask>(
            TEAM_PARTITION,
            rowKey
        );

        if (task.EntityType !== "Task") {
            return reply(404, "Task not found.");
        }

        if (task.etag !== requestedEtag) {
            return reply(
                409,
                "Task changed. Refresh it and try again."
            );
        }

        if (task.Deleting === true) {
            const isCreator =
                String(task.CreatedBy || "") === actor.id;

            if (!isCreator && !actor.isAdmin) {
                return reply(403, "Deletion is not allowed.");
            }

            const startedMs = Date.parse(
                String(task.DeletionStartedAt || "")
            );

            if (!canDeleteTask(task, actor, startedMs)) {
                return reply(
                    409,
                    "The deletion authorization is invalid."
                );
            }
        } else {
            if (!canDeleteTask(task, actor)) {
                return reply(
                    403,
                    "Only the creator or admin can delete " +
                    "a task within one hour of creation."
                );
            }
        }

        // An upload reservation must finish before cleanup.
        for await (
            const attachment of client.listEntities({
                queryOptions: {
                    filter:
                        `PartitionKey eq '${TEAM_PARTITION}'` +
                        " and EntityType eq 'Attachment'" +
                        ` and TaskId eq '${taskId}'`
                }
            })
        ) {
            if (attachment.State === "Uploading") {
                return reply(
                    409,
                    "An attachment upload is pending. " +
                    "Wait for it to finish and retry."
                );
            }
        }

        if (task.Deleting !== true) {
            const nowMs = Date.now();

            // Recheck after listing attachments.
            if (!canDeleteTask(task, actor, nowMs)) {
                return reply(
                    403,
                    "The one-hour deletion window has ended."
                );
            }

            await client.updateEntity({
                partitionKey: TEAM_PARTITION,
                rowKey,
                Deleting: true,
                DeletionStartedAt:
                    new Date(nowMs).toISOString(),
                DeletionStartedBy: actor.id
            }, "Merge", { etag: task.etag });

            task = await client.getEntity<DeletionTask>(
                TEAM_PARTITION,
                rowKey
            );
        }

        cleanupStarted = true;

        const blobsDeleted = await deleteTaskBlobs(taskId);
        let relatedRecordsDeleted = 0;

        for await (
            const entity of client.listEntities({
                queryOptions: {
                    filter:
                        `PartitionKey eq '${TEAM_PARTITION}'` +
                        ` and TaskId eq '${taskId}'` +
                        " and (EntityType eq 'Event'" +
                        " or EntityType eq 'Attachment')"
                }
            })
        ) {
            try {
                await client.deleteEntity(
                    TEAM_PARTITION,
                    String(entity.rowKey),
                    { etag: entity.etag }
                );

                relatedRecordsDeleted++;
            } catch (error) {
                if (
                    (error as { statusCode?: number })
                        .statusCode !== 404
                ) {
                    throw error;
                }
            }
        }

        await client.deleteEntity(
            TEAM_PARTITION,
            rowKey,
            { etag: task.etag }
        );

        return {
            status: 200,
            jsonBody: {
                deleted: true,
                taskId,
                blobsDeleted,
                relatedRecordsDeleted
            }
        };
    } catch (error) {
        const status =
            (error as { statusCode?: number }).statusCode;

        if (status === 412) {
            return reply(
                409,
                "Task or related data changed. Refresh and retry."
            );
        }

        if (status === 404 && !cleanupStarted) {
            return reply(
                404,
                "Task or required table not found."
            );
        }

        context.error("Task deletion failed", error);

        return reply(
            500,
            cleanupStarted
                ? "Cleanup did not complete. Refresh the task " +
                  "and retry deletion."
                : "Unable to start task deletion."
        );
    }
}

app.http("deleteTask", {
    route: "tasks/{id}",
    methods: ["DELETE"],
    authLevel: "anonymous",
    handler: withAuthentication(deleteTask)
});
