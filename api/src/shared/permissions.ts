import { HttpRequest } from "@azure/functions";
import { getAuthenticatedActor } from "./auth";

export type Actor = {
    id: string;
    isAdmin: boolean;
};

export type TaskPermissions = {
    CreatedBy?: unknown;
    CreatedAt?: unknown;
    OwnerId?: unknown;
};

// Compatibility name for existing Day 5 handlers.
// No simulated identity or caller-supplied admin role is used.
export function getLocalActor(request: HttpRequest): Actor {
    return getAuthenticatedActor(request);
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

export function canEditDescription(
    task: TaskPermissions,
    actor: Actor
): boolean {
    return (
        typeof task.CreatedBy === "string" &&
        task.CreatedBy.length > 0 &&
        task.CreatedBy === actor.id
    );
}
