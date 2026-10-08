import { useAuth } from "./AuthGate";
import { useEffect, useState } from "react";

type Task = {
  TaskId: string;
  Title: string;
  OwnerId: string;
  CreatedBy?: string;
  CreatedAt: string;
  etag: string;
  Deleting?: boolean;
};

type Attachment = {
  attachmentId: string;
  fileName: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedAt: string;
  downloadUrl: string;
};

type PurgePreview = {
  previewToken: string;
  cutoff: string;
  expiresAt: string;
  selectedTasks: number;
  totalEligibleTasks: number;
  attachments: number;
  attachmentBytes: number;
  hasMore: boolean;
  tasks: {
    taskId: string;
    title: string;
    archivedAt: string;
  }[];
};

type PurgeResult = {
  complete: boolean;
  deletedTasks: number;
  deletedBlobs: number;
  skipped: { taskId: string; reason: string }[];
  failed: { taskId: string; error: string }[];
};

type Props = {
  task?: Task;
  onChanged: () => Promise<void>;
  onDeleted?: () => Promise<void>;
};

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error || `HTTP ${response.status}`);
  }

  return body as T;
}

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    : `${Math.ceil(bytes / 1024)} KB`;
}

export default function Day5Controls({
  task,
  onChanged,
  onDeleted,
}: Props) {

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(Date.now());

  const [months, setMonths] = useState(3);
  const [preview, setPreview] = useState<PurgePreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const { user } = useAuth();
  const actorId = user.userId;
  const isAdmin = user.userRoles.includes("admin");

  const taskId = task?.TaskId;
  const taskEtag = task?.etag;

  // SWA supplies identity to the API; the browser does not.
  const headers: Record<string, string> = {};
  const canUpload =
    !!task &&
    !task.Deleting &&
    (isAdmin ||
      task.CreatedBy === actorId ||
      task.OwnerId === actorId);

  const canRemove =
    !!task &&
    !task.Deleting &&
    (isAdmin || task.OwnerId === actorId);

  const age = task ? now - Date.parse(task.CreatedAt) : NaN;

  const canDelete =
    !!task &&
    !task.Deleting &&
    age >= 0 &&
    age < 60 * 60 * 1000 &&
    (isAdmin || task.CreatedBy === actorId);

  const canRetryDelete =
    !!task &&
    task.Deleting === true &&
    (isAdmin || task.CreatedBy === actorId);

  const previewExpired =
    !!preview && now >= Date.parse(preview.expiresAt);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setAttachments([]);
    setFile(null);
    setInputKey((value) => value + 1);
    setError("");
    setMessage("");
  }, [taskId]);

  useEffect(() => {
    if (!taskId) return;

    const controller = new AbortController();
    setLoadingFiles(true);

    fetch(`/api/tasks/${taskId}/attachments`, {
      signal: controller.signal,
    })
      .then((response) =>
        readResponse<{ attachments: Attachment[] }>(response),
      )
      .then((data) => {
        if (!controller.signal.aborted) {
          setAttachments(data.attachments);
        }
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            failure instanceof Error
              ? failure.message
              : "Unable to load attachments.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingFiles(false);
      });

    return () => controller.abort();
  }, [taskId, taskEtag]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Operation failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function uploadFile() {
    if (!task || !file) return;

    if (file.size === 0 || file.size > 5 * 1024 * 1024) {
      setError("Choose a nonempty file of at most 5 MB.");
      return;
    }

    await run(async () => {
      await readResponse<unknown>(
        await fetch(`/api/tasks/${task.TaskId}/attachments`, {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/octet-stream",
            "x-file-name": encodeURIComponent(file.name),
          },
          body: file,
        }),
      );

      setFile(null);
      setInputKey((value) => value + 1);
      await onChanged();
      setMessage("Attachment uploaded.");
    });
  }

  async function removeFile(attachment: Attachment) {
    if (!task) return;

    if (
      !window.confirm(
        `Permanently remove "${attachment.fileName}"?`,
      )
    ) {
      return;
    }

    await run(async () => {
      await readResponse<unknown>(
        await fetch(
          `/api/tasks/${task.TaskId}/attachments/${attachment.attachmentId}`,
          {
            method: "DELETE",
            headers,
          },
        ),
      );

      await onChanged();
      setMessage("Attachment removed.");
    });
  }

  async function deleteTask() {
    if (!task) return;

    if (
      !window.confirm(
        `Permanently delete "${task.Title}", its history and all attachments?`,
      )
    ) {
      return;
    }

    await run(async () => {
      // Refresh the ETag because attachment operations update it.
      const current = await readResponse<{ task: Task }>(
        await fetch(`/api/tasks/${task.TaskId}`),
      );

      await readResponse<unknown>(
        await fetch(`/api/tasks/${task.TaskId}`, {
          method: "DELETE",
          headers: {
            ...headers,
            "If-Match": current.task.etag,
          },
        }),
      );

      if (onDeleted) await onDeleted();
    });
  }

  async function previewPurge() {
    setPreview(null);
    setConfirmed(false);

    await run(async () => {
      const result = await readResponse<PurgePreview>(
        await fetch("/api/maintenance/purge/preview", {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ months }),
        }),
      );

      setPreview(result);
    });
  }

  async function executePurge() {
    if (!preview || !confirmed || previewExpired) return;

    if (
      !window.confirm(
        `Permanently purge ${preview.selectedTasks} archived tasks and their attachments?`,
      )
    ) {
      return;
    }

    await run(async () => {
      const result = await readResponse<PurgeResult>(
        await fetch("/api/maintenance/purge/execute", {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            previewToken: preview.previewToken,
            confirm: true,
          }),
        }),
      );

      setPreview(null);
      setConfirmed(false);
      await onChanged();

      setMessage(
        `Deleted ${result.deletedTasks} tasks and ` +
          `${result.deletedBlobs} files. ` +
          `Skipped: ${result.skipped.length}. ` +
          `Failed: ${result.failed.length}.`,
      );

      if (!result.complete) {
        const details = [
          ...result.skipped.map(
            (item) => `${item.taskId}: ${item.reason}`,
          ),
          ...result.failed.map(
            (item) => `${item.taskId}: ${item.error}`,
          ),
        ];

        setError(details.join("\n"));
      }
    });
  }

  return (
    <section className="detail-card">
      <h2>{task ? "Attachments & Deletion" : "Data Retention"}</h2>



      {error && (
        <div className="error" role="alert" style={{ whiteSpace: "pre-wrap" }}>
          {error}
        </div>
      )}

      {message && <p role="status">{message}</p>}

      {task ? (
        <>
          <p>Up to five files per task, 5 MB per file.</p>

          {loadingFiles && <p>Loading attachments...</p>}

          {!loadingFiles && attachments.length === 0 && (
            <p>No attachments.</p>
          )}

          <ul>
            {attachments.map((attachment) => (
              <li
                key={attachment.attachmentId}
                style={{ marginBottom: 12, overflowWrap: "anywhere" }}
              >
                <a href={attachment.downloadUrl}>
                  {attachment.fileName}
                </a>{" "}
                — {sizeLabel(attachment.sizeBytes)}
                {canRemove && (
                  <button
                    type="button"
                    disabled={busy}
                    style={{ marginLeft: 12 }}
                    onClick={() => void removeFile(attachment)}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>

          {canUpload && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                marginTop: 16,
              }}
            >
              <input
                key={inputKey}
                type="file"
                aria-label="Choose attachment"
                accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx,.txt"
                disabled={busy || loadingFiles || attachments.length >= 5}
                onChange={(event) => {
                  setFile(event.target.files?.[0] || null);
                  setError("");
                }}
              />

              <button
                type="button"
                disabled={
                  busy || loadingFiles || !file || attachments.length >= 5
                }
                onClick={() => void uploadFile()}
              >
                Upload Attachment
              </button>
            </div>
          )}

          <hr style={{ margin: "24px 0" }} />

          {canDelete || canRetryDelete ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void deleteTask()}
            >
              {canRetryDelete ? "Retry Task Deletion" : "Delete Task"}
            </button>
          ) : (
            <p>
              Task deletion is available to the creator or admin
              within one hour of creation.
            </p>
          )}
        </>
      ) : (
        <>
          {!isAdmin ? (
            <p>Only admins can preview and execute a purge.</p>
          ) : (
            <>
              <label htmlFor="purge-months">
                Purge tasks archived more than{" "}
              </label>

              <select
                id="purge-months"
                value={months}
                disabled={busy}
                onChange={(event) => {
                  setMonths(Number(event.target.value));
                  setPreview(null);
                  setConfirmed(false);
                  setMessage("");
                }}
              >
                <option value={1}>1 month</option>
                <option value={3}>3 months</option>
                <option value={6}>6 months</option>
                <option value={12}>1 year</option>
              </select>

              <button
                type="button"
                disabled={busy}
                style={{ marginLeft: 12 }}
                onClick={() => void previewPurge()}
              >
                Preview Purge
              </button>

              {preview && (
                <div style={{ marginTop: 20 }}>
                  <p>
                    This run: <strong>{preview.selectedTasks} tasks</strong>,
                    {" "}{preview.attachments} attachments,
                    {" "}{sizeLabel(preview.attachmentBytes)}.
                  </p>

                  <p>
                    Archive cutoff:{" "}
                    {new Date(preview.cutoff).toLocaleString()}
                  </p>

                  {preview.hasMore && (
                    <p>
                      {preview.totalEligibleTasks} tasks qualify.
                      Generate another preview after this run
                      to process the remaining tasks.
                    </p>
                  )}

                  <ul>
                    {preview.tasks.map((item) => (
                      <li key={item.taskId}>
                        {item.title} — archived{" "}
                        {new Date(item.archivedAt).toLocaleDateString()}
                      </li>
                    ))}
                  </ul>

                  {previewExpired && (
                    <p>Preview expired. Generate a new preview.</p>
                  )}

                  <label style={{ display: "block", margin: "16px 0" }}>
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={busy || previewExpired}
                      onChange={(event) =>
                        setConfirmed(event.target.checked)
                      }
                    />{" "}
                    I understand these tasks, their history and attachments
                    will be permanently deleted.
                  </label>

                  <button
                    type="button"
                    disabled={
                      busy ||
                      !confirmed ||
                      previewExpired ||
                      preview.selectedTasks === 0
                    }
                    onClick={() => void executePurge()}
                  >
                    Confirm Purge
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {busy && <p role="status">Working...</p>}
    </section>
  );
}
