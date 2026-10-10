import { withAuthentication } from "../shared/auth";
import {
    app,
    HttpRequest,
    HttpResponseInit,
    InvocationContext
} from "@azure/functions";

import {
    createHmac,
    randomBytes,
    timingSafeEqual
} from "node:crypto";

import {
    canPurgeData,
    getLocalActor
} from "../shared/permissions";

import {
    attachmentPrefix,
    deleteTaskBlobs,
    getTableClient,
    TEAM_PARTITION
} from "../shared/storage";

interface PurgeTask {
    EntityType?: string;
    TaskId?: string;
    Title?: string;
    Archived?: boolean;
    ArchivedAt?: string;
    Deleting?: boolean;
    DeletionReason?: string;
}

interface Candidate {
    taskId: string;
    etag: string;
}

interface PreviewPayload {
    version: number;
    months: number;
    cutoff: string;
    expiresAt: number;
    candidates: Candidate[];
}

const MAX_TASKS_PER_RUN = 50;

// Local preview tokens expire on API restart.
// Day 6 deployment will use configured identity/security.
const previewKey = randomBytes(32);

function reply(
    status: number,
    error: string
): HttpResponseInit {
    return {
        status,
        jsonBody: { error }
    };
}

function localOnly(): boolean {
    return (
        process.env.TABLES_CONNECTION_STRING ===
            "UseDevelopmentStorage=true" &&
        process.env.BLOBS_CONNECTION_STRING ===
            "UseDevelopmentStorage=true" &&
        !process.env.WEBSITE_INSTANCE_ID
    );
}

function cutoffForMonths(
    months: number,
    now: Date
): Date {
    // Calendar-month subtraction with end-of-month clamping.
    const day = now.getUTCDate();

    const cutoff = new Date(now);
    cutoff.setUTCDate(1);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - months);

    const lastDay = new Date(Date.UTC(
        cutoff.getUTCFullYear(),
        cutoff.getUTCMonth() + 1,
        0
    )).getUTCDate();

    cutoff.setUTCDate(Math.min(day, lastDay));

    return cutoff;
}

function eligible(
    task: PurgeTask,
    cutoffMs: number
): boolean {
    const archivedMs = Date.parse(
        String(task.ArchivedAt || "")
    );

    return (
        task.EntityType === "Task" &&
        task.Archived === true &&
        Number.isFinite(archivedMs) &&
        archivedMs < cutoffMs
    );
}

function signPreview(payload: PreviewPayload): string {
    const encoded = Buffer
        .from(JSON.stringify(payload))
        .toString("base64url");

    const signature = createHmac("sha256", previewKey)
        .update(encoded)
        .digest("base64url");

    return `${encoded}.${signature}`;
}

function readPreview(token: string): PreviewPayload {
    if (token.length > 60000) {
        throw new Error("Invalid preview token.");
    }

    const parts = token.split(".");

    if (parts.length !== 2) {
        throw new Error("Invalid preview token.");
    }

    const expected = createHmac("sha256", previewKey)
        .update(parts[0])
        .digest();

    const supplied = Buffer.from(parts[1], "base64url");

    if (
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
    ) {
        throw new Error("Invalid preview token.");
    }

    const payload = JSON.parse(
        Buffer.from(parts[0], "base64url").toString("utf8")
    ) as PreviewPayload;

    if (
        payload.version !== 1 ||
        ![1, 3, 6, 12].includes(payload.months) ||
        !Number.isFinite(Date.parse(payload.cutoff)) ||
        !Number.isFinite(payload.expiresAt) ||
        !Array.isArray(payload.candidates) ||
        payload.candidates.length > MAX_TASKS_PER_RUN
    ) {
        throw new Error("Invalid preview token.");
    }

    if (Date.now() >= payload.expiresAt) {
        throw new Error(
            "Preview expired. Generate a new preview."
        );
    }

    return payload;
}

export async function previewPurge(
    request: HttpRequest,
    context: InvocationContext
): Promise<HttpResponseInit> {
    if (!localOnly()) {
        return reply(503, "Local development only.");
    }

    const actor = getLocalActor(request);

    if (!canPurgeData(actor)) {
        return reply(403, "Only admins can preview a purge.");
    }

    let body: unknown;

    try {
        body = await request.json();
    } catch {
        return reply(400, "Request must contain valid JSON.");
    }

    if (
        !body ||
        typeof body !== "object" ||
        !("months" in body) ||
        typeof body.months !== "number" ||
        ![1, 3, 6, 12].includes(body.months)
    ) {
        return reply(400, "Months must be 1, 3, 6 or 12.");
    }

    const months = body.months;
    const cutoff = cutoffForMonths(months, new Date());
    const client = getTableClient();

    try {
        const candidates: Candidate[] = [];
        const tasks = [];

        let totalEligibleTasks = 0;
        let attachments = 0;
        let attachmentBytes = 0;

        for await (
            const task of client.listEntities<PurgeTask>({
                queryOptions: {
                    filter:
                        `PartitionKey eq '${TEAM_PARTITION}'` +
                        " and EntityType eq 'Task'" +
                        " and Archived eq true"
                }
            })
        ) {
            if (!eligible(task, cutoff.getTime())) {
                continue;
            }

            // Leave manually initiated deletion to its own endpoint.
            if (
                task.Deleting === true &&
                task.DeletionReason !== "Purge"
            ) {
                continue;
            }

            const taskId = String(task.TaskId || "");

            try {
                attachmentPrefix(taskId);
            } catch {
                continue;
            }

            totalEligibleTasks++;

            if (candidates.length >= MAX_TASKS_PER_RUN) {
                continue;
            }

            candidates.push({
                taskId,
                etag: String(task.etag)
            });

            tasks.push({
                taskId,
                title: task.Title || "",
                archivedAt: task.ArchivedAt,
                retryingCleanup: task.Deleting === true
            });

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
                attachments++;

                const size = Number(attachment.SizeBytes);

                if (Number.isFinite(size) && size > 0) {
                    attachmentBytes += size;
                }
            }
        }

        const expiresAt = Date.now() + 15 * 60 * 1000;

        return {
            status: 200,
            jsonBody: {
                months,
                cutoff: cutoff.toISOString(),
                totalEligibleTasks,
                selectedTasks: candidates.length,
                hasMore: totalEligibleTasks > candidates.length,
                attachments,
                attachmentBytes,
                tasks,
                expiresAt: new Date(expiresAt).toISOString(),
                previewToken: signPreview({
                    version: 1,
                    months,
                    cutoff: cutoff.toISOString(),
                    expiresAt,
                    candidates
                })
            }
        };
    } catch (error) {
        context.error("Purge preview failed", error);
        return reply(500, "Unable to preview purge.");
    }
}

export async function executePurge(
    request: HttpRequest,
    context: InvocationContext
): Promise<HttpResponseInit> {
    if (!localOnly()) {
        return reply(503, "Local development only.");
    }

    const actor = getLocalActor(request);

    if (!canPurgeData(actor)) {
        return reply(403, "Only admins can execute a purge.");
    }

    let body: unknown;

    try {
        body = await request.json();
    } catch {
        return reply(400, "Request must contain valid JSON.");
    }

    if (
        !body ||
        typeof body !== "object" ||
        !("confirm" in body) ||
        body.confirm !== true ||
        !("previewToken" in body) ||
        typeof body.previewToken !== "string"
    ) {
        return reply(
            400,
            "Provide previewToken and confirm: true."
        );
    }

    let preview: PreviewPayload;

    try {
        preview = readPreview(body.previewToken);
    } catch (error) {
        return reply(400, (error as Error).message);
    }

    const client = getTableClient();
    const cutoffMs = Date.parse(preview.cutoff);

    let deletedTasks = 0;
    let deletedBlobs = 0;
    let deletedRelatedRecords = 0;

    const skipped: { taskId: string; reason: string }[] = [];
    const failed: { taskId: string; error: string }[] = [];

    for (const candidate of preview.candidates) {
        const taskId = candidate.taskId;
        const rowKey = `task:${taskId}`;

        let cleanupStarted = false;

        try {
            attachmentPrefix(taskId);

            let task = await client.getEntity<PurgeTask>(
                TEAM_PARTITION,
                rowKey
            );

            if (!eligible(task, cutoffMs)) {
                skipped.push({
                    taskId,
                    reason: "Task is no longer eligible."
                });
                continue;
            }

            const resuming =
                task.Deleting === true &&
                task.DeletionReason === "Purge";

            if (task.Deleting === true && !resuming) {
                skipped.push({
                    taskId,
                    reason: "Manual task deletion is in progress."
                });
                continue;
            }

            if (!resuming && task.etag !== candidate.etag) {
                skipped.push({
                    taskId,
                    reason: "Task changed since preview."
                });
                continue;
            }

            let uploadPending = false;

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
                    uploadPending = true;
                    break;
                }
            }

            if (uploadPending) {
                skipped.push({
                    taskId,
                    reason: "Attachment upload is pending."
                });
                continue;
            }

            if (!resuming) {
                await client.updateEntity({
                    partitionKey: TEAM_PARTITION,
                    rowKey,
                    Deleting: true,
                    DeletionReason: "Purge",
                    DeletionStartedAt: new Date().toISOString(),
                    DeletionStartedBy: actor.id
                }, "Merge", { etag: task.etag });

                task = await client.getEntity<PurgeTask>(
                    TEAM_PARTITION,
                    rowKey
                );
            }

            cleanupStarted = true;

            deletedBlobs += await deleteTaskBlobs(taskId);

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

                    deletedRelatedRecords++;
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

            deletedTasks++;
        } catch (error) {
            const status =
                (error as { statusCode?: number }).statusCode;

            if (status === 404 && !cleanupStarted) {
                skipped.push({
                    taskId,
                    reason: "Task already removed."
                });
                continue;
            }

            if (status === 412 && !cleanupStarted) {
                skipped.push({
                    taskId,
                    reason: "Task changed during purge preparation."
                });
                continue;
            }

            context.error("Purge task cleanup failed", {
                taskId,
                error
            });

            failed.push({
                taskId,
                error: cleanupStarted
                    ? "Cleanup incomplete. Generate a new preview and retry."
                    : "Unable to start cleanup."
            });
        }
    }

    return {
        status: 200,
        jsonBody: {
            complete:
                failed.length === 0 &&
                skipped.length === 0,
            months: preview.months,
            cutoff: preview.cutoff,
            selectedTasks: preview.candidates.length,
            deletedTasks,
            deletedBlobs,
            deletedRelatedRecords,
            skipped,
            failed
        }
    };
}

app.http("previewPurge", {
    route: "maintenance/purge/preview",
    methods: ["POST"],
    authLevel: "anonymous",
    handler: withAuthentication(previewPurge)
});

app.http("executePurge", {
    route: "maintenance/purge/execute",
    methods: ["POST"],
    authLevel: "anonymous",
    handler: withAuthentication(executePurge)
});
