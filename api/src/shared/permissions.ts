import { HttpRequest } from "@azure/functions";

export type Actor = {
    id: string;
    isAdmin: boolean;
};

export type TaskPermissions = {
    CreatedBy?: unknown;
    CreatedAt?: unknown;
    OwnerId?: unknown;
};

// Simulated identity for local Azurite testing.
// Replace with verified authentication on Day 6.
export function getLocalActor(request: HttpRequest): Actor {
    if (
        process.env.TABLES_CONNECTION_STRING !==
            "UseDevelopmentStorage=true" ||
        process.env.WEBSITE_INSTANCE_ID
    ) {
        throw new Error(
            "Local identity is unavailable outside local development."
        );
    }

    return {
        id:
            request.headers.get("x-local-user")?.trim() ||
            "local-developer",
        isAdmin:
            request.headers.get("x-local-admin") === "true"
    };
}

export function canDeleteTask(
    task: TaskPermissions,
    actor: Actor,
    nowMs: number = Date.now()
): boolean {
    const createdMs = Date.parse(
        String(task.CreatedAt || "")
    );

    const ageMs = nowMs - createdMs;

    const withinOneHour =
        Number.isFinite(createdMs) &&
        ageMs >= 0 &&
        ageMs < 60 * 60 * 1000;

    const isCreator =
        String(task.CreatedBy || "") === actor.id;

    return withinOneHour && (isCreator || actor.isAdmin);
}

export function canUploadAttachment(
    task: TaskPermissions,
    actor: Actor
): boolean {
    return (
        actor.isAdmin ||
        String(task.CreatedBy || "") === actor.id ||
        String(task.OwnerId || "") === actor.id
    );
}

export function canDeleteAttachment(
    task: TaskPermissions,
    actor: Actor
): boolean {
    return (
        actor.isAdmin ||
        String(task.OwnerId || "") === actor.id
    );
}

export function canPurgeData(actor: Actor): boolean {
    return actor.isAdmin;
}
