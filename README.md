# Azure Team Workload App

A lightweight internal application for distributing team tasks, monitoring workloads, and recording task changes.

Built with React, TypeScript, Azure Functions, Azure Table Storage, Azure Blob Storage, and Microsoft Entra authentication through Azure Static Web Apps.

## Features

- Team workload dashboard with active task counts
- Create, assign, and update tasks
- Task statuses: Open, In Progress, Blocked, Done
- In Scope classification: Yes, No, Grey
- Task descriptions and operational notes
- Task history with changes and timestamps
- File attachments (maximum 5 files per task, 5 MB each)
- Image and PDF attachment previews
- Task search and filtering
- Task archiving and retention controls
- Mobile-responsive interface
- Administrator Member Management page
- Enable/disable application access for individual members

## Technology Stack

| Component | Technology |
|---|---|
| Frontend | React, Vite, TypeScript |
| Backend | Azure Functions v4, Node.js, TypeScript |
| Task and member data | Azure Table Storage |
| File attachments | Azure Blob Storage |
| Authentication | Microsoft Entra ID via Azure Static Web Apps |
| Authorization | SWA roles plus application membership checks |
| Local storage emulator | Azurite |
| Source control | Git and GitHub |
| CI/CD | GitHub Actions |
| Hosting | Azure Static Web Apps |

## Project Structure

```text
azure-team-workload-app/
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── App.css
│   │   ├── AuthGate.tsx
│   │   ├── AdminMembers.tsx
│   │   └── Day5Controls.tsx
│   └── public/
│       └── staticwebapp.config.json
├── api/
│   ├── src/
│   │   ├── functions/
│   │   └── shared/
│   ├── tests/
│   └── local.settings.json
├── .github/
│   └── workflows/
│       └── deploy-swa.yml
└── README.md
```

`local.settings.json` contains local configuration and must not be committed to Git.

## Local Development

### Prerequisites

- Node.js and npm
- Azure Functions Core Tools v4
- Azurite
- Azure Static Web Apps CLI
- Git

### 1. Start Azurite

From the repository root:

```powershell
npx.cmd azurite --location "C:\projects\azure-team-workload-app\.azurite" --skipApiVersionCheck
```

### 2. Start Azure Functions

In a second PowerShell window:

```powershell
cd C:\projects\azure-team-workload-app\api
npm.cmd install
npm.cmd run build
func.cmd start
```

Ensure that `api/local.settings.json` contains the required local storage settings.

### 3. Start React

In a third PowerShell window:

```powershell
cd C:\projects\azure-team-workload-app\frontend
npm.cmd install
npm.cmd run dev
```

### 4. Start Static Web Apps Emulator

In a fourth PowerShell window:

```powershell
cd C:\projects\azure-team-workload-app
npx.cmd @azure/static-web-apps-cli start http://localhost:5173 --api-devserver-url http://localhost:7071
```

Open the application at:

`http://localhost:4280`

Use the Static Web Apps emulator for authentication testing. Direct access to port 7071 bypasses the authentication gateway and must not be treated as trusted.

## Authentication and Authorization

The application uses Microsoft Entra authentication through Azure Static Web Apps.

Two SWA application roles are used:

- `admin`: Member Management and administrator operations
- `member`: Regular task operations

Every protected API request checks:

1. The authenticated SWA principal and its roles.
2. The corresponding member record in Azure Table Storage.
3. Whether `Enabled` is Boolean `true`.

A member who is disabled or not registered is denied access to protected APIs.

Membership authorization is enforced by the backend, not just the React interface.

**Security boundary:** The Azure Functions backend must remain accessible through the trusted SWA-managed API integration. The `x-ms-client-principal` header must not be trusted from arbitrary direct requests.

## Adding a Member

1. Invite the user through Azure Static Web Apps with the `member` role.
2. Ask the user to accept the invitation and sign in.
3. Ask the user to open `/.auth/me` and provide their `clientPrincipal.userId`.
4. As an administrator, open **Manage Members**.
5. Enter the user's SWA User ID and display name.
6. Click **Add Member**.
7. Ask the user to refresh the application.

A user needs both the appropriate SWA role and an enabled application membership record.

Disabling a member blocks application API access but does not itself revoke their Microsoft sign-in session or SWA invitation.

## Task Permissions

- Members can create tasks and make permitted task updates.
- Task descriptions can be edited by the original creator.
- Task attachments are restricted by the application's backend permission rules.
- Task deletion is permitted to the creator or administrator within one hour of creation.
- Administrators can access retention controls and member-management operations.
- Administrators cannot disable their own application membership through the Member Management API.

## Storage

Azure Table Storage stores task, member, and task-history data.

The application uses:

- `WorkItems` table for task-related entities
- `Members` table for membership records
- `task-attachments` private Blob container for uploaded files

Local development uses Azurite. Azure production uses the configured storage account.

Attachments are served through authenticated backend endpoints rather than public Blob URLs.

## Deployment

Deployment uses `.github/workflows/deploy-swa.yml`.

The current deployment workflow is manually triggered using `workflow_dispatch` and restricted to the `feature/day8-mobile-admin` branch.

To deploy:

1. Commit and push the intended changes.
2. Open GitHub Actions.
3. Select **Deploy Team Workload App**.
4. Choose the authorized branch.
5. Click **Run workflow**.
6. Review the deployment result.
7. Test the application after deployment.

The workflow requires the GitHub repository secret `AZURE_STATIC_WEB_APPS_API_TOKEN`.

Do not commit deployment tokens, storage keys, connection strings, or other credentials.

## Testing

Backend automated tests:

```powershell
cd api
npm.cmd test
```

Frontend production build:

```powershell
cd frontend
npm.cmd run build
```

Before deploying, verify authentication, member authorization, administrator operations, task creation, attachment permissions, and mobile responsiveness.

## Production

Application URL:

https://blue-field-0bfd34400.4.azurestaticapps.net

Azure resources:

- Static Web App: `swa-team-workload-dev`
- Resource group: `rg-team-workload-dev`
- Storage account: `stteamworkload85131`
- Azure region: East Asia

## Additional Documentation

- `docs/ARCHITECTURE.md` — Solution architecture and security boundaries
- `docs/TROUBLESHOOTING.md` — Common errors and recovery steps
- `docs/ONBOARDING.md` — Teammate onboarding instructions
- `AGENTS.md` — AI-assisted development guidance

These additional documents are planned and will be added separately.
