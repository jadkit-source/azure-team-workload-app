import { withAuthentication } from "../shared/auth";
import {
    app,
    HttpRequest,
    HttpResponseInit,
    InvocationContext
} from "@azure/functions";

import {
    attachmentBlobName,
    attachmentPrefix,
    getAttachmentContainer,
    getTableClient,
    TEAM_PARTITION
} from "../shared/storage";

interface AttachmentEntity {
    EntityType?: string;
    TaskId?: string;
    AttachmentId?: string;
    FileName?: string;
    ContentType?: string;
    SizeBytes?: number;
    UploadedBy?: string;
    UploadedAt?: string;
    State?: string;
}

function reply(
    status: number,
    error: string
): HttpResponseInit {
    return {
        status,
        jsonBody: { error }
    };
}

function storageConfigured(): boolean {
    return Boolean(
        process.env.TABLES_CONNECTION_STRING?.trim() &&
        process.env.BLOBS_CONNECTION_STRING?.trim()
    );
}

export async function listAttachments(
    request: HttpRequest,
    context: InvocationContext
): Promise<HttpResponseInit> {
    if (!storageConfigured()) {
        return reply(503, "Storage is not configured.");
    }

    const taskId = request.params.id;

    try {
        attachmentPrefix(taskId);
    } catch {
        return reply(400, "Invalid task ID.");
    }

    try {
        const client = getTableClient();

        const task = await client.getEntity(
            TEAM_PARTITION,
            `task:${taskId}`
        );

        if (task.EntityType !== "Task") {
            return reply(404, "Task not found.");
        }

        if (task.Deleting === true) {
            return reply(409, "Task deletion is in progress.");
        }

        const attachments = [];

        for await (
            const entity of client.listEntities<AttachmentEntity>({
                queryOptions: {
                    filter:
                        `PartitionKey eq '${TEAM_PARTITION}'` +
                        " and EntityType eq 'Attachment'" +
                        ` and TaskId eq '${taskId}'`
                }
            })
        ) {
            // Incomplete uploads must not appear as usable files.
            if (entity.State !== "Ready") {
                continue;
            }

            attachments.push({
                attachmentId: entity.AttachmentId,
                fileName: entity.FileName,
                contentType: entity.ContentType,
                sizeBytes: entity.SizeBytes,
                uploadedBy: entity.UploadedBy,
                uploadedAt: entity.UploadedAt,
                downloadUrl:
                    `/api/tasks/${taskId}/attachments/` +
                    entity.AttachmentId
            });
        }

        attachments.sort((a, b) =>
            String(a.uploadedAt || "").localeCompare(
                String(b.uploadedAt || "")
            )
        );

        return {
            status: 200,
            jsonBody: {
                taskId,
                attachments
            }
        };
    } catch (error) {
        if (
            (error as { statusCode?: number }).statusCode === 404
        ) {
            return reply(404, "Task or required table not found.");
        }

        context.error("Attachment listing failed", error);
        return reply(500, "Unable to list attachments.");
    }
}

export async function downloadAttachment(
    request: HttpRequest,
    context: InvocationContext
): Promise<HttpResponseInit> {
    if (!storageConfigured()) {
        return reply(503, "Storage is not configured.");
    }

    const taskId = request.params.id;
    const attachmentId = request.params.attachmentId;

    let blobName: string;

    try {
        blobName = attachmentBlobName(taskId, attachmentId);
    } catch {
        return reply(400, "Invalid task or attachment ID.");
    }

    try {
        const client = getTableClient();

        const task = await client.getEntity(
            TEAM_PARTITION,
            `task:${taskId}`
        );

        if (task.EntityType !== "Task") {
            return reply(404, "Task not found.");
        }

        if (task.Deleting === true) {
            return reply(409, "Task deletion is in progress.");
        }

        const attachment =
            await client.getEntity<AttachmentEntity>(
                TEAM_PARTITION,
                `attachment:${taskId}:${attachmentId}`
            );

        if (
            attachment.EntityType !== "Attachment" ||
            attachment.TaskId !== taskId ||
            attachment.AttachmentId !== attachmentId
        ) {
            return reply(404, "Attachment not found.");
        }

        if (attachment.State !== "Ready") {
            return reply(409, "Attachment is not ready.");
        }

        const blob = getAttachmentContainer()
            .getBlockBlobClient(blobName);

        const content = await blob.downloadToBuffer();

        const safeFileName = String(
            attachment.FileName || "attachment"
        ).replace(/[\r\n]/g, "");

        const encodedFileName = encodeURIComponent(safeFileName)
            .replace(/['()*]/g, character =>
                "%" + character.charCodeAt(0)
                    .toString(16)
                    .toUpperCase()
            );

        return {
            status: 200,
            body: new Uint8Array(content),
            headers: {
                "Content-Type": "application/octet-stream",
                "Content-Disposition":
                    "attachment; filename=\"attachment\"; " +
                    `filename*=UTF-8''${encodedFileName}`,
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "no-store"
            }
        };
    } catch (error) {
        if (
            (error as { statusCode?: number }).statusCode === 404
        ) {
            return reply(
                404,
                "Task, attachment, or attachment file not found."
            );
        }

        context.error("Attachment download failed", error);
        return reply(500, "Unable to download attachment.");
    }
}

app.http("listAttachments", {
    route: "tasks/{id}/attachments",
    methods: ["GET"],
    authLevel: "anonymous",
    handler: withAuthentication(listAttachments)
});

app.http("downloadAttachment", {
    route: "tasks/{id}/attachments/{attachmentId}",
    methods: ["GET"],
    authLevel: "anonymous",
    handler: withAuthentication(downloadAttachment)
});
