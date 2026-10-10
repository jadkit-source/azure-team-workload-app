import { withAuthentication } from "../shared/auth";
import {
    app,
    HttpRequest,
    HttpResponseInit,
    InvocationContext
} from "@azure/functions";

import { TableTransaction } from "@azure/data-tables";
import { randomUUID } from "node:crypto";

import {
    canUploadAttachment,
    getLocalActor,
    TaskPermissions
} from "../shared/permissions";

import {
    attachmentBlobName,
    attachmentPrefix,
    getAttachmentContainer,
    getTableClient,
    MAX_ATTACHMENT_BYTES,
    MAX_ATTACHMENTS_PER_TASK,
    TEAM_PARTITION
} from "../shared/storage";

interface UploadTask extends TaskPermissions {
    EntityType?: string;
    Deleting?: boolean;
}

const allowedTypes: Record<string, string> = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".docx":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".txt": "text/plain"
};

export async function uploadAttachment(
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

    let fileName: string;

    try {
        fileName = decodeURIComponent(
            request.headers.get("x-file-name") || ""
        ).trim();
    } catch {
        return reply(400, "Invalid encoded filename.");
    }

    if (
        !fileName ||
        fileName.length > 180 ||
        /[\/\\\u0000-\u001f\u007f]/.test(fileName)
    ) {
        return reply(
            400,
            "Provide a filename of 1â€“180 characters without path separators."
        );
    }

    const extension = fileName
        .slice(fileName.lastIndexOf("."))
        .toLowerCase();

    const contentType = allowedTypes[extension];

    if (!contentType) {
        return reply(
            400,
            "Allowed file types: PDF, JPG, JPEG, PNG, DOCX, XLSX and TXT."
        );
    }

    const contentLength = Number(
        request.headers.get("content-length")
    );

    if (
        Number.isFinite(contentLength) &&
        contentLength > MAX_ATTACHMENT_BYTES
    ) {
        return reply(413, "Maximum attachment size is 5 MB.");
    }

    const actor = getLocalActor(request);
    const client = getTableClient();
    const attachmentId = randomUUID();
    const attachmentRowKey =
        `attachment:${taskId}:${attachmentId}`;

    const blob = getAttachmentContainer().getBlockBlobClient(
        attachmentBlobName(taskId, attachmentId)
    );

    let reserved = false;
    let completed = false;

    try {
        const task = await client.getEntity<UploadTask>(
            TEAM_PARTITION,
            `task:${taskId}`
        );

        if (task.EntityType !== "Task") {
            return reply(404, "Task not found.");
        }

        if (task.Deleting === true) {
            return reply(409, "Task deletion is in progress.");
        }

        if (!canUploadAttachment(task, actor)) {
            return reply(
                403,
                "Only the creator, owner or admin can upload attachments."
            );
        }

        const content = Buffer.from(
            await request.arrayBuffer()
        );

        if (content.length === 0) {
            return reply(400, "Empty files cannot be uploaded.");
        }

        if (content.length > MAX_ATTACHMENT_BYTES) {
            return reply(413, "Maximum attachment size is 5 MB.");
        }

        let attachmentCount = 0;

        for await (
            const entity of client.listEntities({
                queryOptions: {
                    filter:
                        `PartitionKey eq '${TEAM_PARTITION}'` +
                        " and EntityType eq 'Attachment'" +
                        ` and TaskId eq '${taskId}'`
                }
            })
        ) {
            attachmentCount++;
        }

        if (attachmentCount >= MAX_ATTACHMENTS_PER_TASK) {
            return reply(
                409,
                "A task can have at most five attachments."
            );
        }

        const now = new Date().toISOString();
        const reservation = new TableTransaction();

        // Updating the task ETag serializes reservations
        // and prevents uploads racing with task deletion.
        reservation.updateEntity({
            partitionKey: TEAM_PARTITION,
            rowKey: `task:${taskId}`,
            AttachmentActivityAt: now
        }, "Merge", { etag: task.etag });

        reservation.createEntity({
            partitionKey: TEAM_PARTITION,
            rowKey: attachmentRowKey,
            EntityType: "Attachment",
            TaskId: taskId,
            AttachmentId: attachmentId,
            FileName: fileName,
            ContentType: contentType,
            SizeBytes: content.length,
            UploadedBy: actor.id,
            UploadedAt: now,
            State: "Uploading"
        });

        await client.submitTransaction(reservation.actions);
        reserved = true;

        // No public access is enabled.
        await getAttachmentContainer().createIfNotExists();

        await blob.uploadData(content, {
            conditions: { ifNoneMatch: "*" },
            blobHTTPHeaders: {
                blobContentType: contentType
            }
        });

        const metadata = await client.getEntity(
            TEAM_PARTITION,
            attachmentRowKey
        );

        await client.updateEntity({
            partitionKey: TEAM_PARTITION,
            rowKey: attachmentRowKey,
            State: "Ready"
        }, "Merge", { etag: metadata.etag });

        completed = true;

        return {
            status: 201,
            jsonBody: {
                taskId,
                attachment: {
                    attachmentId,
                    fileName,
                    contentType,
                    sizeBytes: content.length,
                    uploadedBy: actor.id,
                    uploadedAt: now,
                    downloadUrl:
                        `/api/tasks/${taskId}/attachments/` +
                        attachmentId
                }
            }
        };
    } catch (error) {
        const status =
            (error as { statusCode?: number }).statusCode;

        context.error("Attachment upload failed", error);

        if (!reserved && status === 404) {
            return reply(404, "Task or required table not found.");
        }

        if (!reserved && (status === 409 || status === 412)) {
            return reply(
                409,
                "Task changed during upload preparation. Retry the upload."
            );
        }

        return reply(500, "Unable to upload attachment.");
    } finally {
        if (reserved && !completed) {
            try {
                // Remove any partial file before its metadata.
                await blob.deleteIfExists({
                    deleteSnapshots: "include"
                });

                await client.deleteEntity(
                    TEAM_PARTITION,
                    attachmentRowKey
                );
            } catch (cleanupError) {
                context.error(
                    "Incomplete attachment cleanup failed",
                    {
                        taskId,
                        attachmentId,
                        error: cleanupError
                    }
                );
            }
        }
    }
}

app.http("uploadAttachment", {
    route: "tasks/{id}/attachments",
    methods: ["POST"],
    authLevel: "anonymous",
    handler: withAuthentication(uploadAttachment)
});
