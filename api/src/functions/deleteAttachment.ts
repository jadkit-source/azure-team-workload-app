import {
    app,
    HttpRequest,
    HttpResponseInit,
    InvocationContext
} from "@azure/functions";

import { TableTransaction } from "@azure/data-tables";

import {
    canDeleteAttachment,
    getLocalActor,
    TaskPermissions
} from "../shared/permissions";

import {
    attachmentBlobName,
    getAttachmentContainer,
    getTableClient,
    TEAM_PARTITION
} from "../shared/storage";

interface AttachmentTask extends TaskPermissions {
    EntityType?: string;
    Deleting?: boolean;
}

interface AttachmentEntity {
    EntityType?: string;
    TaskId?: string;
    AttachmentId?: string;
    State?: string;
}

export async function deleteAttachment(
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
        process.env.TABLES_CONNECTION_STRING !==
            "UseDevelopmentStorage=true" ||
        process.env.BLOBS_CONNECTION_STRING !==
            "UseDevelopmentStorage=true" ||
        process.env.WEBSITE_INSTANCE_ID
    ) {
        return reply(503, "Local development only.");
    }

    const taskId = request.params.id;
    const attachmentId = request.params.attachmentId;

    let blobName: string;

    try {
        blobName = attachmentBlobName(taskId, attachmentId);
    } catch {
        return reply(400, "Invalid task or attachment ID.");
    }

    const actor = getLocalActor(request);
    const client = getTableClient();

    const attachmentRowKey =
        `attachment:${taskId}:${attachmentId}`;

    let removalStarted = false;

    try {
        const task = await client.getEntity<AttachmentTask>(
            TEAM_PARTITION,
            `task:${taskId}`
        );

        if (task.EntityType !== "Task") {
            return reply(404, "Task not found.");
        }

        if (task.Deleting === true) {
            return reply(409, "Task deletion is in progress.");
        }

        if (!canDeleteAttachment(task, actor)) {
            return reply(
                403,
                "Only the task owner or admin can remove attachments."
            );
        }

        const attachment =
            await client.getEntity<AttachmentEntity>(
                TEAM_PARTITION,
                attachmentRowKey
            );

        if (
            attachment.EntityType !== "Attachment" ||
            attachment.TaskId !== taskId ||
            attachment.AttachmentId !== attachmentId
        ) {
            return reply(404, "Attachment not found.");
        }

        if (attachment.State === "Uploading") {
            return reply(
                409,
                "The attachment upload has not finished."
            );
        }

        if (
            attachment.State !== "Ready" &&
            attachment.State !== "Removing"
        ) {
            return reply(
                409,
                "The attachment is in an unsupported state."
            );
        }

        const now = new Date().toISOString();
        const transaction = new TableTransaction();

        // Check the task version atomically with the
        // attachment transition. This protects against
        // concurrent owner changes and task deletion.
        transaction.updateEntity({
            partitionKey: TEAM_PARTITION,
            rowKey: `task:${taskId}`,
            AttachmentActivityAt: now
        }, "Merge", { etag: task.etag });

        transaction.updateEntity({
            partitionKey: TEAM_PARTITION,
            rowKey: attachmentRowKey,
            State: "Removing"
        }, "Merge", { etag: attachment.etag });

        await client.submitTransaction(transaction.actions);
        removalStarted = true;

        // Keep metadata until the actual file is removed.
        const result = await getAttachmentContainer()
            .getBlockBlobClient(blobName)
            .deleteIfExists({
                deleteSnapshots: "include"
            });

        try {
            await client.deleteEntity(
                TEAM_PARTITION,
                attachmentRowKey
            );
        } catch (error) {
            // Concurrent task cleanup may have removed it.
            if (
                (error as { statusCode?: number })
                    .statusCode !== 404
            ) {
                throw error;
            }
        }

        return {
            status: 200,
            jsonBody: {
                deleted: true,
                taskId,
                attachmentId,
                blobDeleted: result.succeeded
            }
        };
    } catch (error) {
        const status =
            (error as { statusCode?: number }).statusCode;

        if (status === 412) {
            return reply(
                409,
                "Task or attachment changed. Refresh and retry."
            );
        }

        if (status === 404 && !removalStarted) {
            return reply(
                404,
                "Task or attachment not found."
            );
        }

        context.error("Attachment removal failed", error);

        return reply(
            500,
            removalStarted
                ? "Attachment cleanup did not complete. " +
                  "Retry removing the attachment."
                : "Unable to start attachment removal."
        );
    }
}

app.http("deleteAttachment", {
    route: "tasks/{id}/attachments/{attachmentId}",
    methods: ["DELETE"],
    authLevel: "anonymous",
    handler: deleteAttachment
});
