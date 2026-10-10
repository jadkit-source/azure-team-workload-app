import { useEffect, useState } from "react";

type AdminMember = {
  memberId: string;
  displayName: string;
  enabled: boolean;
  activeTasks: number;
};

type Props = {
  currentUserId: string;
  onBack: () => void;
};

export default function AdminMembers({
  currentUserId,
  onBack,
}: Props) {
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [newMemberId, setNewMemberId] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");

  async function loadMembers() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/management/members");

      if (!response.ok) {
        throw new Error(`Unable to load members (${response.status}).`);
      }

      const data = await response.json();
      setMembers(data.members);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to load members."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadMembers();
  }, []);

  async function addMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setBusyId("create");

    try {
      const response = await fetch("/api/management/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: newMemberId.trim(),
          displayName: newDisplayName.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to create member.");
      }

      setNewMemberId("");
      setNewDisplayName("");
      setMessage("Member created successfully.");
      await loadMembers();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Unable to add member."
      );
    } finally {
      setBusyId("");
    }
  }

  async function updateMember(
    member: AdminMember,
    changes: { displayName?: string; enabled?: boolean }
  ) {
    setError("");
    setMessage("");
    setBusyId(member.memberId);

    try {
      const response = await fetch(
        `/api/management/members/${encodeURIComponent(member.memberId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(changes),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to update member.");
      }

      setMessage("Member updated successfully.");
      await loadMembers();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to update member."
      );
    } finally {
      setBusyId("");
    }
  }

  function editName(member: AdminMember) {
    const name = window.prompt("Display name", member.displayName);

    if (name === null || name.trim() === member.displayName) {
      return;
    }

    void updateMember(member, { displayName: name.trim() });
  }

  function toggleMember(member: AdminMember) {
    if (member.memberId === currentUserId && member.enabled) {
      return;
    }

    const action = member.enabled ? "disable" : "enable";

    if (
      !window.confirm(
        `Are you sure you want to ${action} ${member.displayName}?`
      )
    ) {
      return;
    }

    void updateMember(member, { enabled: !member.enabled });
  }

  return (
    <main className="app">
      <header className="header">
        <div>
          <button type="button" onClick={onBack}>
            ← Back to Dashboard
          </button>
          <h1>Member Management</h1>
          <p>Manage team members and application access.</p>
        </div>
      </header>

      {error && <div className="error" role="alert">{error}</div>}
      {message && <p role="status">{message}</p>}

      <section className="create-section">
        <h2>Add Member</h2>

        <form onSubmit={addMember}>
          <label htmlFor="member-id">Microsoft SWA User ID</label>
          <input
            id="member-id"
            value={newMemberId}
            onChange={(event) => setNewMemberId(event.target.value)}
            placeholder="User ID from /.auth/me"
            maxLength={256}
            required
          />

          <label htmlFor="member-name">Display Name</label>
          <input
            id="member-name"
            value={newDisplayName}
            onChange={(event) => setNewDisplayName(event.target.value)}
            placeholder="Member name"
            maxLength={100}
            required
          />

          <button type="submit" disabled={busyId !== ""}>
            {busyId === "create" ? "Adding..." : "Add Member"}
          </button>
        </form>

        <p>
          The member also requires a Static Web Apps invitation
          with the member role.
        </p>
      </section>

      <section className="create-section">
        <h2>Team Members</h2>

        {loading ? (
          <p>Loading members...</p>
        ) : (
          <div className="admin-member-list">
            {members.map((member) => (
              <article className="admin-member-card" key={member.memberId}>
                <div>
                  <h3>{member.displayName}</h3>
                  <p className="admin-member-id">{member.memberId}</p>
                  <p>
                    {member.activeTasks} active tasks ·{" "}
                    {member.enabled ? "Enabled" : "Disabled"}
                  </p>
                </div>

                <div className="admin-member-actions">
                  <button
                    type="button"
                    onClick={() => editName(member)}
                    disabled={busyId !== ""}
                  >
                    Edit Name
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleMember(member)}
                    disabled={
                      busyId !== "" ||
                      (member.memberId === currentUserId && member.enabled)
                    }
                  >
                    {member.memberId === currentUserId && member.enabled
                      ? "Current Admin"
                      : member.enabled
                        ? "Disable"
                        : "Enable"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
