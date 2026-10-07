import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";

type Member = {
  memberId: string;
  displayName: string;
  activeTasks: number;
};

type InScopeValue = "Yes" | "No" | "Grey";

type Task = {
  etag: string;
  TaskId: string;
  Title: string;
  Description: string;
  Note: string;
  OwnerId: string;
  Status: string;
  Priority: string;
  InScope: InScopeValue;
  Archived: boolean;
  CreatedBy?: string;
  CreatedAt: string;
  ModifiedBy?: string;
  ModifiedAt: string;
  CompletedBy?: string;
  CompletedAt?: string;
};

type HistoryChange = {
  oldValue: unknown;
  newValue: unknown;
};

type HistoryEvent = {
  eventId: string;
  eventType: string;
  changedBy: string;
  time: string;
  ownerIdAtEvent: string | null;
  changes: Record<string, HistoryChange>;
};

function App() {
  const [members, setMembers] = useState<Member[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [newTitle, setNewTitle] = useState("");
  const [newInScope, setNewInScope] =
    useState<InScopeValue>("Grey");

  const [creating, setCreating] = useState(false);

  const [selectedTaskId, setSelectedTaskId] =
    useState<string | null>(null);

  const [selectedTask, setSelectedTask] =
    useState<Task | null>(null);

  const [taskHistory, setTaskHistory] =
    useState<HistoryEvent[]>([]);

  const [detailLoading, setDetailLoading] =
    useState(false);

  const [noteDraft, setNoteDraft] =
    useState("");

  const [savingNote, setSavingNote] =
    useState(false);

  const [searchText, setSearchText] =
    useState("");

  const [ownerFilter, setOwnerFilter] =
    useState("All");

  const [statusFilter, setStatusFilter] =
    useState("All");

  const [inScopeFilter, setInScopeFilter] =
    useState("All");

  const [showArchived, setShowArchived] =
  useState(false);

  const filteredTasks = useMemo(() => {
    const search =
      searchText
        .trim()
        .toLowerCase();

    return tasks.filter((task) => {
      const matchesSearch =
        !search ||
        task.Title
          .toLowerCase()
          .includes(search) ||
        (task.Note ?? "")
          .toLowerCase()
          .includes(search);

      const matchesOwner =
        ownerFilter === "All" ||
        (ownerFilter === "Unassigned"
          ? !task.OwnerId
          : task.OwnerId === ownerFilter);

      const matchesStatus =
        statusFilter === "All" ||
        task.Status === statusFilter;

      const matchesInScope =
        inScopeFilter === "All" ||
        task.InScope === inScopeFilter;

      const matchesArchived =
        showArchived
          ? task.Archived === true
          : task.Archived !== true;

      return (
        matchesSearch &&
        matchesOwner &&
        matchesStatus &&
        matchesInScope &&
        matchesArchived
      );
    });
  }, [
    tasks,
    searchText,
    ownerFilter,
    statusFilter,
    inScopeFilter,
    showArchived,
  ]);

  async function loadData() {
    try {
      setLoading(true);
      setError("");

      const [membersResponse, tasksResponse] =
        await Promise.all([
          fetch("/api/members"),
          fetch(
                showArchived
                  ? "/api/tasks?includeArchived=true"
                  : "/api/tasks"
              ),
        ]);

      if (!membersResponse.ok) {
        throw new Error(
          `Members API HTTP ${membersResponse.status}`
        );
      }

      if (!tasksResponse.ok) {
        throw new Error(
          `Tasks API HTTP ${tasksResponse.status}`
        );
      }

      const membersData =
        await membersResponse.json();

      const tasksData =
        await tasksResponse.json();

      setMembers(membersData.members);
      setTasks(tasksData.tasks);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load data"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
  loadData();
  }, [showArchived]);

  async function loadTaskDetail(taskId: string) {
    try {
      setDetailLoading(true);
      setError("");

      const [taskResponse, historyResponse] =
        await Promise.all([
          fetch(`/api/tasks/${taskId}`),
          fetch(`/api/tasks/${taskId}/history`),
        ]);

      if (!taskResponse.ok) {
        const errorBody =
          await taskResponse
            .json()
            .catch(() => null);

        throw new Error(
          errorBody?.error ??
            `Task API HTTP ${taskResponse.status}`
        );
      }

      if (!historyResponse.ok) {
        const errorBody =
          await historyResponse
            .json()
            .catch(() => null);

        throw new Error(
          errorBody?.error ??
            `History API HTTP ${historyResponse.status}`
        );
      }

      const taskData =
        await taskResponse.json();

      const historyData =
        await historyResponse.json();

      setSelectedTask(taskData.task);

      setNoteDraft(
        taskData.task.Note ?? ""
      );

      setTaskHistory(
        historyData.history ?? []
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load task detail"
      );
    } finally {
      setDetailLoading(false);
    }
  }

  async function openTask(taskId: string) {
    setSelectedTaskId(taskId);
    await loadTaskDetail(taskId);
  }

  function closeTaskDetail() {
    setSelectedTaskId(null);
    setSelectedTask(null);
    setTaskHistory([]);
    setNoteDraft("");
    setError("");
  }

  async function handleInScopeChange(
    task: Task,
    inScope: InScopeValue
  ) {
    try {
      setError("");

      const response = await fetch(
        `/api/tasks/${task.TaskId}/inscope`,
        {
          method: "PATCH",
          headers: {
            "Content-Type":
              "application/json",
            "If-Match": task.etag,
          },
          body: JSON.stringify({
            inScope,
          }),
        }
      );

      if (!response.ok) {
        const errorBody =
          await response
            .json()
            .catch(() => null);

        throw new Error(
          errorBody?.error ??
            `InScope update HTTP ${response.status}`
        );
      }

      await loadData();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to change InScope"
      );
    }
  }

  async function handleStatusChange(
    task: Task,
    status: string
  ) {
    try {
      setError("");

      const response = await fetch(
        `/api/tasks/${task.TaskId}/status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type":
              "application/json",
            "If-Match": task.etag,
          },
          body: JSON.stringify({
            status,
          }),
        }
      );

      if (!response.ok) {
        const errorBody =
          await response
            .json()
            .catch(() => null);

        throw new Error(
          errorBody?.error ??
            `Status update HTTP ${response.status}`
        );
      }

      await loadData();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to change status"
      );
    }
  }

  async function handleArchiveChange(
    task: Task,
    archived: boolean
  ) {
    try {
      setError("");

      const response = await fetch(
        `/api/tasks/${task.TaskId}/archive`,
        {
          method: "PATCH",

          headers: {
            "Content-Type":
              "application/json",

            "If-Match":
              task.etag,
          },

          body: JSON.stringify({
            archived,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(
          `Archive update HTTP ${response.status}`
        );
      }

      await loadData();

      if (
        selectedTaskId === task.TaskId
      ) {
        await loadTaskDetail(
          task.TaskId
        );
      }

    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to change archive state"
      );
    }
  }

  async function handleOwnerChange(
    task: Task,
    ownerId: string
  ) {
    try {
      setError("");

      const response = await fetch(
        `/api/tasks/${task.TaskId}/owner`,
        {
          method: "PATCH",
          headers: {
            "Content-Type":
              "application/json",
            "If-Match": task.etag,
          },
          body: JSON.stringify({
            ownerId,
          }),
        }
      );

      if (!response.ok) {
        const errorBody =
          await response
            .json()
            .catch(() => null);

        throw new Error(
          errorBody?.error ??
            `Owner update HTTP ${response.status}`
        );
      }

      await loadData();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to change owner"
      );
    }
  }

  async function handleCreateTask(
    event: FormEvent
  ) {
    event.preventDefault();

    const title = newTitle.trim();

    if (!title) {
      setError(
        "Task title is required."
      );
      return;
    }

    try {
      setCreating(true);
      setError("");

      const response =
        await fetch("/api/tasks", {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            title,
            inScope: newInScope,
          }),
        });

      if (!response.ok) {
        const errorBody =
          await response
            .json()
            .catch(() => null);

        throw new Error(
          errorBody?.error ??
            `Create task HTTP ${response.status}`
        );
      }

      setNewTitle("");
      setNewInScope("Grey");

      await loadData();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to create task"
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveNote() {
    if (!selectedTask) {
      return;
    }

    if (noteDraft.length > 1000) {
      setError(
        "Note must be at most 1000 characters."
      );
      return;
    }

    try {
      setSavingNote(true);
      setError("");

      const response = await fetch(
        `/api/tasks/${selectedTask.TaskId}/note`,
        {
          method: "PATCH",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            note: noteDraft,
          }),
        }
      );

      if (!response.ok) {
        const errorBody =
          await response
            .json()
            .catch(() => null);

        throw new Error(
          errorBody?.error ??
            `Note update HTTP ${response.status}`
        );
      }

      await Promise.all([
        loadTaskDetail(
          selectedTask.TaskId
        ),
        loadData(),
      ]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to save note"
      );
    } finally {
      setSavingNote(false);
    }
  }

  function clearFilters() {
    setSearchText("");
    setOwnerFilter("All");
    setStatusFilter("All");
    setInScopeFilter("All");
  }

  function getOwnerName(
    ownerId: string
  ) {
    if (!ownerId) {
      return "Unassigned";
    }

    const member =
      members.find(
        (item) =>
          item.memberId === ownerId
      );

    return (
      member?.displayName ??
      ownerId
    );
  }

  function formatDateTime(
    value?: string
  ) {
    if (!value) {
      return "-";
    }

    const date = new Date(value);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return value;
    }

    return date.toLocaleString();
  }

  function formatChangeValue(
    value: unknown
  ) {
    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
      return "None";
    }

    if (
      typeof value === "boolean"
    ) {
      return value
        ? "Yes"
        : "No";
    }

    if (
      typeof value === "object"
    ) {
      return JSON.stringify(value);
    }

    return String(value);
  }

  function getNotePreview(
    note: string
  ) {
    if (!note) {
      return "";
    }

    const cleanNote =
      note.replace(/\s+/g, " ").trim();

    if (cleanNote.length <= 60) {
      return cleanNote;
    }

    return `${cleanNote.slice(0, 60)}...`;
  }

  const activeCount =
    tasks.filter(
      (task) =>
        !task.Archived &&
        task.Status !== "Done"
    ).length;

  const doneCount =
    tasks.filter(
      (task) =>
        !task.Archived &&
        task.Status === "Done"
    ).length;

  const archivedCount =
    tasks.filter(
      (task) =>
        task.Archived
    ).length;

  if (selectedTaskId) {
    return (
      <div className="app">
        <header className="header">
          <div>
            <button
              className="back-button"
              type="button"
              onClick={closeTaskDetail}
            >
              ← Back to Tasks
            </button>

            <h1>Task Detail</h1>

            <p>
              Task information, notes,
              and audit history
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              loadTaskDetail(
                selectedTaskId
              )
            }
            disabled={detailLoading}
          >
            {detailLoading
              ? "Refreshing..."
              : "Refresh"}
          </button>
        </header>

        {error && (
          <div className="error">
            {error}
          </div>
        )}

        {detailLoading &&
          !selectedTask && (
            <p>
              Loading task...
            </p>
          )}

        {selectedTask && (
          <>
            <section className="detail-card">
              <div className="detail-heading">
                <div>
                  <span className="task-id">
                    {
                      selectedTask.TaskId
                    }
                  </span>

                  <h2>
                    {
                      selectedTask.Title
                    }
                  </h2>
                </div>

                <span
                  className={`status-badge status-${selectedTask.Status
                    .toLowerCase()
                    .replaceAll(" ", "-")}`}
                >
                  {
                    selectedTask.Status
                  }
                </span>
              </div>

              <button
                type="button"
                onClick={() =>
                  handleArchiveChange(
                    selectedTask,
                    !selectedTask.Archived
                  )
                }
              >
                {selectedTask.Archived
                  ? "Restore Task"
                  : "Archive Task"}
              </button>

              <div className="detail-grid">
                <div className="detail-item">
                  <span className="detail-label">
                    Owner
                  </span>

                  <strong>
                    {getOwnerName(
                      selectedTask.OwnerId
                    )}
                  </strong>
                </div>

                <div className="detail-item">
                  <span className="detail-label">
                    Priority
                  </span>

                  <strong>
                    {
                      selectedTask.Priority
                    }
                  </strong>
                </div>

                <div className="detail-item">
                  <span className="detail-label">
                    In Scope
                  </span>

                  <strong>
                    {
                      selectedTask.InScope
                    }
                  </strong>
                </div>

                <div className="detail-item">
                  <span className="detail-label">
                    Created
                  </span>

                  <strong>
                    {formatDateTime(
                      selectedTask.CreatedAt
                    )}
                  </strong>
                </div>

                <div className="detail-item">
                  <span className="detail-label">
                    Modified
                  </span>

                  <strong>
                    {formatDateTime(
                      selectedTask.ModifiedAt
                    )}
                  </strong>
                </div>

                <div className="detail-item">
                  <span className="detail-label">
                    Created By
                  </span>

                  <strong>
                    {selectedTask.CreatedBy ??
                      "-"}
                  </strong>
                </div>
              </div>

              <div className="description-block">
                <h3>Description</h3>

                <p>
                  {selectedTask.Description ||
                    "No description provided."}
                </p>
              </div>
            </section>

            <section className="note-section">
              <div className="section-heading">
                <div>
                  <h2>Note</h2>

                  <p>
                    Current operational
                    update for this task
                  </p>
                </div>

                <span className="character-count">
                  {noteDraft.length}
                  /1000
                </span>
              </div>

              <textarea
                value={noteDraft}
                maxLength={1000}
                onChange={(event) =>
                  setNoteDraft(
                    event.target.value
                  )
                }
                placeholder="Add an operational note..."
              />

              <div className="note-actions">
                <button
                  className="save-button"
                  type="button"
                  disabled={
                    savingNote ||
                    noteDraft ===
                      selectedTask.Note
                  }
                  onClick={
                    handleSaveNote
                  }
                >
                  {savingNote
                    ? "Saving..."
                    : "Save Note"}
                </button>
              </div>
            </section>

            <section className="history-section">
              <div className="section-heading">
                <div>
                  <h2>
                    Activity History
                  </h2>

                  <p>
                    Audit trail for this
                    task
                  </p>
                </div>
              </div>

              {taskHistory.length ===
              0 ? (
                <p>
                  No history found.
                </p>
              ) : (
                <div className="timeline">
                  {[...taskHistory]
                    .reverse()
                    .map(
                      (historyEvent) => (
                        <article
                          className="timeline-item"
                          key={
                            historyEvent.eventId
                          }
                        >
                          <div className="timeline-marker" />

                          <div className="timeline-content">
                            <div className="timeline-header">
                              <strong>
                                {
                                  historyEvent.eventType
                                }
                              </strong>

                              <span>
                                {formatDateTime(
                                  historyEvent.time
                                )}
                              </span>
                            </div>

                            <div className="timeline-actor">
                              Changed by{" "}
                              <strong>
                                {
                                  historyEvent.changedBy
                                }
                              </strong>
                            </div>

                            <div className="change-list">
                              {Object.entries(
                                historyEvent.changes
                              ).map(
                                ([
                                  field,
                                  change,
                                ]) => (
                                  <div
                                    className="change-row"
                                    key={
                                      field
                                    }
                                  >
                                    <span className="change-field">
                                      {
                                        field
                                      }
                                    </span>

                                    <span className="old-value">
                                      {formatChangeValue(
                                        change.oldValue
                                      )}
                                    </span>

                                    <span className="change-arrow">
                                      →
                                    </span>

                                    <span className="new-value">
                                      {formatChangeValue(
                                        change.newValue
                                      )}
                                    </span>
                                  </div>
                                )
                              )}
                            </div>
                          </div>
                        </article>
                      )
                    )}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>
            Team Workload
          </h1>

          <p>
            Current team task
            distribution
          </p>
        </div>

        <button
          type="button"
          onClick={loadData}
        >
          Refresh
        </button>
      </header>

      {loading && (
        <p>
          Loading workload...
        </p>
      )}

      {error && (
        <div className="error">
          {error}
        </div>
      )}

      {!loading && (
        <>
          <section className="summary-grid">
            <div className="summary-card">
              <div className="summary-number">
                {activeCount}
              </div>
              <span>Active</span>
            </div>

            <div className="summary-card">
              <div className="summary-number">
                {doneCount}
              </div>
              <span>Done</span>
            </div>

            <div className="summary-card">
              <div className="summary-number">
                {archivedCount}
              </div>
              <span>Archived</span>
            </div>
          </section>

          <section className="member-grid">
            {[...members]
              .sort(
                (a, b) =>
                  a.activeTasks -
                    b.activeTasks ||
                  a.displayName.localeCompare(
                    b.displayName
                  )
              )
              .map((member) => (
                <div
                  className="member-card"
                  key={
                    member.memberId
                  }
                >
                  <h2>
                    {
                      member.displayName
                    }
                  </h2>

                  <div className="task-count">
                    {
                      member.activeTasks
                    }
                  </div>

                  <span>
                    Active tasks
                  </span>
                </div>
              ))}
          </section>

          <section className="create-section">
            <h2>
              Create Task
            </h2>

            <form
              className="create-task-form"
              onSubmit={
                handleCreateTask
              }
            >
              <div className="form-field title-field">
                <label htmlFor="task-title">
                  Title
                </label>

                <input
                  id="task-title"
                  type="text"
                  maxLength={160}
                  value={newTitle}
                  onChange={(event) =>
                    setNewTitle(
                      event.target.value
                    )
                  }
                  placeholder="Enter task title"
                />
              </div>

              <div className="form-field">
                <label htmlFor="in-scope">
                  In Scope
                </label>

                <select
                  id="in-scope"
                  value={newInScope}
                  onChange={(event) =>
                    setNewInScope(
                      event.target
                        .value as InScopeValue
                    )
                  }
                >
                  <option value="Grey">
                    Grey
                  </option>

                  <option value="Yes">
                    Yes
                  </option>

                  <option value="No">
                    No
                  </option>
                </select>
              </div>

              <button
                className="create-button"
                type="submit"
                disabled={creating}
              >
                {creating
                  ? "Creating..."
                  : "Create Task"}
              </button>
            </form>
          </section>

          <section className="tasks-section">
            <div className="tasks-heading">
              <h2>Tasks</h2>

              <span className="task-result-count">
                {filteredTasks.length}
                {" of "}
                {tasks.length}
                {" tasks"}
              </span>
            </div>

            <div className="filter-bar">
              <div className="filter-field search-field">
                <label htmlFor="task-search">
                  Search
                </label>

                <input
                  id="task-search"
                  type="search"
                  value={searchText}
                  onChange={(event) =>
                    setSearchText(
                      event.target.value
                    )
                  }
                  placeholder="Search task or note"
                />
              </div>

              <div className="filter-field">
                <label htmlFor="owner-filter">
                  Owner
                </label>

                <select
                  id="owner-filter"
                  value={ownerFilter}
                  onChange={(event) =>
                    setOwnerFilter(
                      event.target.value
                    )
                  }
                >
                  <option value="All">
                    All
                  </option>

                  <option value="Unassigned">
                    Unassigned
                  </option>

                  {members.map(
                    (member) => (
                      <option
                        key={
                          member.memberId
                        }
                        value={
                          member.memberId
                        }
                      >
                        {
                          member.displayName
                        }
                      </option>
                    )
                  )}
                </select>
              </div>

              <div className="filter-field">
                <label htmlFor="status-filter">
                  Status
                </label>

                <select
                  id="status-filter"
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(
                      event.target.value
                    )
                  }
                >
                  <option value="All">
                    All
                  </option>

                  <option value="Open">
                    Open
                  </option>

                  <option value="In Progress">
                    In Progress
                  </option>

                  <option value="Done">
                    Done
                  </option>
                </select>
              </div>

              <div className="filter-field">
                <label htmlFor="scope-filter">
                  In Scope
                </label>

                <select
                  id="scope-filter"
                  value={inScopeFilter}
                  onChange={(event) =>
                    setInScopeFilter(
                      event.target.value
                    )
                  }
                >
                  <option value="All">
                    All
                  </option>

                  <option value="Yes">
                    Yes
                  </option>

                  <option value="No">
                    No
                  </option>

                  <option value="Grey">
                    Grey
                  </option>
                </select>
              </div>

              <div className="filter-field">
                <label htmlFor="archive-filter">
                  View
                </label>

                <select
                  id="archive-filter"
                  value={showArchived ? "Archived" : "Active"}
                  onChange={(event) =>
                    setShowArchived(
                      event.target.value === "Archived"
                    )
                  }
                >
                  <option value="Active">
                    Active
                  </option>

                  <option value="Archived">
                    Archived
                  </option>
                </select>
              </div>

              <button
                type="button"
                className="clear-filters-button"
                onClick={clearFilters}
              >
                Clear Filters
              </button>
            </div>

            {filteredTasks.length ===
            0 ? (
              <div className="no-results">
                No tasks match the current filters.
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="task-table">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Owner</th>
                      <th>Status</th>
                      <th>Note</th>
                      <th>
                        In Scope
                      </th>
                      <th>
                        Created
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredTasks.map(
                      (task) => (
                        <tr
                          key={
                            task.TaskId
                          }
                        >
                          <td>
                            <button
                              type="button"
                              className="task-link"
                              onClick={() =>
                                openTask(
                                  task.TaskId
                                )
                              }
                            >
                              {
                                task.Title
                              }
                            </button>
                          </td>

                          <td>
                            <select
                              value={
                                task.OwnerId
                              }
                              disabled={task.Archived}
                              onChange={(
                                event
                              ) =>
                                handleOwnerChange(
                                  task,
                                  event
                                    .target
                                    .value
                                )
                              }
                            >
                              <option value="">
                                Unassigned
                              </option>

                              {members.map(
                                (
                                  member
                                ) => (
                                  <option
                                    key={
                                      member.memberId
                                    }
                                    value={
                                      member.memberId
                                    }
                                  >
                                    {
                                      member.displayName
                                    }
                                  </option>
                                )
                              )}
                            </select>
                          </td>

                          <td>
                            <select
                              value={
                                task.Status
                              }
                              disabled={task.Archived}
                              onChange={(
                                event
                              ) =>
                                handleStatusChange(
                                  task,
                                  event
                                    .target
                                    .value
                                )
                              }
                            >
                              <option value="Open">
                                Open
                              </option>

                              <option value="In Progress">
                                In Progress
                              </option>

                              <option value="Done">
                                Done
                              </option>
                            </select>
                          </td>

                          <td className="note-preview-cell">
                            {task.Note ? (
                              <span
                                title={
                                  task.Note
                                }
                                style={{
                                  display: "block",
                                  maxWidth: "240px",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {getNotePreview(
                                  task.Note
                                )}
                              </span>
                            ) : (
                              <span className="empty-note">
                                No note
                              </span>
                            )}
                          </td>

                          <td>
                            <select
                              value={
                                task.InScope
                              }
                              disabled={task.Archived}
                              onChange={(
                                event
                              ) =>
                                handleInScopeChange(
                                  task,
                                  event
                                    .target
                                    .value as InScopeValue
                                )
                              }
                            >
                              <option value="Grey">
                                Grey
                              </option>

                              <option value="Yes">
                                Yes
                              </option>

                              <option value="No">
                                No
                              </option>
                            </select>
                          </td>

                          <td>
                            {new Date(
                              task.CreatedAt
                            ).toLocaleDateString()}
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default App;
