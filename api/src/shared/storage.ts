import { TableClient } from "@azure/data-tables";
import {
    BlobServiceClient,
    ContainerClient
} from "@azure/storage-blob";

export const TEAM_PARTITION = "team:default";
export const ATTACHMENT_CONTAINER = "task-attachments";

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_TASK = 5;

export function getTableClient(): TableClient {
    const connection = process.env.TABLES_CONNECTION_STRING;

    if (!connection) {
        throw new Error("TABLES_CONNECTION_STRING is missing.");
    }

    return TableClient.fromConnectionString(
        connection,
        "WorkItems"
    );
}

export function getAttachmentContainer(): ContainerClient {
    const connection = process.env.BLOBS_CONNECTION_STRING;

    if (!connection) {
        throw new Error("BLOBS_CONNECTION_STRING is missing.");
    }

    return BlobServiceClient
        .fromConnectionString(connection)
        .getContainerClient(ATTACHMENT_CONTAINER);
}

export function attachmentPrefix(taskId: string): string {
    if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
            .test(taskId)
    ) {
        throw new Error("Invalid task ID.");
    }

    return `${TEAM_PARTITION}/${taskId}/`;
}

export function attachmentBlobName(
    taskId: string,
    attachmentId: string
): string {
    if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
            .test(attachmentId)
    ) {
        throw new Error("Invalid attachment ID.");
    }

    return attachmentPrefix(taskId) + attachmentId;
}

// Call only after the task has been locked against changes/uploads.
// A failure propagates to the caller so it can retain records for retry.
export async function deleteTaskBlobs(
    taskId: string
): Promise<number> {
    const prefix = attachmentPrefix(taskId);
    const container = getAttachmentContainer();

    if (!(await container.exists())) {
        return 0;
    }

    let deleted = 0;

    for await (
        const blob of container.listBlobsFlat({ prefix })
    ) {
        const result = await container
            .getBlobClient(blob.name)
            .deleteIfExists({
                deleteSnapshots: "include"
            });

        if (result.succeeded) {
            deleted++;
        }
    }

    return deleted;
}
