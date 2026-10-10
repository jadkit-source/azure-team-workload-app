import {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import type { ReactNode } from "react";

type SignedInUser = {
  identityProvider: string;
  userId: string;
  userDetails: string;
  userRoles: string[];
};

const AuthContext = createContext<SignedInUser | null>(null);

export function useAuth() {
  const user = useContext(AuthContext);

  if (!user) {
    throw new Error("Authentication context is unavailable.");
  }

  return { user };
}

export default function AuthGate({
  children,
}: {
  children: ReactNode;
}) {
  const [user, setUser] = useState<SignedInUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  const [accessStatus, setAccessStatus] = useState<
    "checking" | "allowed" | "denied" | "unavailable"
  >("checking");

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setError("");

    fetch("/.auth/me", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Authentication HTTP ${response.status}`);
        }

        const data = await response.json();
        const principal = data.clientPrincipal;

        if (principal == null) {
          return null;
        }

        if (
          typeof principal !== "object" ||
          principal.identityProvider !== "aad" ||
          typeof principal.userId !== "string" ||
          !principal.userId ||
          typeof principal.userDetails !== "string" ||
          !Array.isArray(principal.userRoles) ||
          !principal.userRoles.every(
            (role: unknown) => typeof role === "string",
          )
        ) {
          throw new Error("Invalid Microsoft sign-in information.");
        }

        return principal as SignedInUser;
      })
      .then((principal) => {
        if (!controller.signal.aborted) {
          setUser(principal);
        }
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            failure instanceof Error
              ? failure.message
              : "Unable to check sign-in.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    if (!user) {
      setAccessStatus("checking");
      return;
    }

    const controller = new AbortController();

    setAccessStatus("checking");

    async function checkAccess() {
      try {
        const response = await fetch("/api/my-access", {
          cache: "no-store",
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        if (response.ok) {
          setAccessStatus("allowed");
        } else if (response.status === 403) {
          setAccessStatus("denied");
        } else {
          setAccessStatus("unavailable");
        }
      } catch {
        if (!controller.signal.aborted) {
          setAccessStatus("unavailable");
        }
      }
    }

    void checkAccess();

    return () => controller.abort();
  }, [user, attempt]);

  if (loading) {
    return <main className="app">Checking sign-in...</main>;
  }

  if (error) {
    return (
      <main className="app">
        <h1>Team Workload</h1>
        <div className="error" role="alert">{error}</div>
        <button
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Retry
        </button>
      </main>
    );
  }

  if (!user || !user.userRoles.includes("authenticated")) {
    return (
      <main className="app">
        <section className="detail-card">
          <h1>Team Workload</h1>
          <p>Sign in with your Microsoft account to continue.</p>
          <a href="/.auth/login/aad?post_login_redirect_uri=%2F">
            Sign in with Microsoft
          </a>
        </section>
      </main>
    );
  }

  if (accessStatus === "checking") {
    return <main className="app">Checking application access...</main>;
  }

  if (accessStatus === "denied") {
    return (
      <main className="app">
        <section className="detail-card">
          <h1>Application access disabled</h1>
          <p>
            Your account is disabled or has not been registered.
            Please contact your administrator to restore access.
          </p>
          <a href="/.auth/logout?post_logout_redirect_uri=%2F">
            Sign out
          </a>
        </section>
      </main>
    );
  }

  if (accessStatus === "unavailable") {
    return (
      <main className="app">
        <section className="detail-card">
          <h1>Application temporarily unavailable</h1>
          <p>
            We couldn't verify your membership.
            Please try again.
          </p>
          <button
            type="button"
            onClick={() => setAttempt(value => value + 1)}
          >
            Retry
          </button>
        </section>
      </main>
    );
  }

  const isAdmin = user.userRoles.includes("admin");
  const hasAccess = isAdmin || user.userRoles.includes("member");

  if (!hasAccess) {
    return (
      <main className="app">
        <section className="detail-card">
          <h1>Access not granted</h1>
          <p>Signed in as {user.userDetails}.</p>
          <p>
            Ask the administrator to grant your account
            member or admin access.
          </p>
          <a href="/.auth/logout?post_logout_redirect_uri=%2F">
            Sign out
          </a>
        </section>
      </main>
    );
  }

  return (
    <AuthContext.Provider value={user}>
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "12px 32px",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          gap: 12,
          borderBottom: "1px solid #ddd",
        }}
      >
        <span>
          {user.userDetails} · {isAdmin ? "Admin" : "Member"}
        </span>
        <a href="/.auth/logout?post_logout_redirect_uri=%2F">
          Sign out
        </a>
      </div>
      {children}
    </AuthContext.Provider>
  );
}
