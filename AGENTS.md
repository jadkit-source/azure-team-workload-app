# AI Development Guidelines — Team Workload App

## Project Overview

This repository contains an internal Azure Team Workload application.

Its purpose is to help a small team distribute tasks, track ownership, update work status and manage application membership.

The application is already deployed to Azure and contains production data. Changes must preserve existing functionality and stored records.

## Technology Stack

- Frontend: React, Vite, TypeScript
- Backend: Azure Functions v4, Node.js, TypeScript
- Database: Azure Table Storage
- Attachments: Azure Blob Storage
- Authentication: Microsoft Entra ID through Azure Static Web Apps
- Local development: Azurite and Static Web Apps CLI
- CI/CD: GitHub Actions

Do not introduce additional frameworks, databases, cloud services or paid dependencies without explaining the benefits, operational implications and costs.

## Development Principles

1. Prefer simple solutions appropriate for a small internal team.
2. Make incremental changes that are easy to review and test.
3. Reuse existing components, helpers and coding conventions.
4. Preserve existing task and membership data.
5. Avoid unnecessary architectural complexity.
6. Keep the interface responsive on desktop and mobile.
7. Do not modify production infrastructure without explicit approval.

## Security Requirements

All protected Azure Functions endpoints must use the existing `withAuthentication()` middleware.

The middleware validates the authenticated SWA principal and verifies that the user has an enabled record in the `Members` table.

An authorized application user must have:

- A valid Microsoft identity
- The appropriate SWA `member` or `admin` role
- A matching membership record
- `Enabled` stored as Boolean `true`

Do not weaken or bypass these requirements to fix development issues.

Never trust authentication headers supplied directly by an arbitrary client. The API must remain behind the trusted Static Web Apps gateway.

Administrative endpoints must enforce `requireAdmin()` on the backend.

Administrators must not be able to disable their own account through Member Management.

## Member Management

The application provides these endpoints:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/management/members` | GET | List all members |
| `/api/management/members` | POST | Add member |
| `/api/management/members/{id}` | PATCH | Edit name or enabled status |
| `/api/my-access` | GET | Verify current user's application access |

Adding a member record does not issue an Azure Static Web Apps invitation.

Membership IDs must correspond to the user's actual SWA principal ID.

Disabling a member must not delete their historical tasks or activity.

Do not add mandatory audit services or complex approval workflows unless explicitly requested.

## Task Permissions

Preserve the existing permission rules.

- Task creators can edit their task descriptions.
- Ownership and status changes must follow existing backend authorization.
- Task deletion is time-limited and permission-controlled.
- Attachment operations require authenticated, authorized access.
- Administrative retention operations require the `admin` role.

Do not rely only on frontend controls for authorization.

## Storage Guidelines

Use the existing Azure Tables SDK and storage helpers.

Current tables:

- `WorkItems`
- `Members`

Current private Blob container:

- `task-attachments`

Preserve the `team:default` partition convention unless a deliberate migration is approved.

Use correct property types, particularly Boolean values for membership status.

Avoid destructive storage changes and schema migrations without a tested rollback or recovery plan.

## Frontend Guidelines

- Use React functional components and TypeScript.
- Follow existing UI conventions and CSS patterns.
- Keep new features modular when practical.
- Preserve mobile responsiveness.
- Use understandable error messages.
- Provide loading states for asynchronous operations.
- Avoid exposing administrator controls to regular members.
- Remember that frontend authorization is not a substitute for backend enforcement.

## Local Testing

Start local services in this order:

1. Azurite
2. Azure Functions
3. Vite
4. Static Web Apps CLI

Test the integrated application through:

`http://localhost:4280`

Do not rely on direct requests to port 7071 to validate authentication security.

Before committing backend changes:

```powershell
cd api
npm.cmd test
```

Before committing frontend changes:

```powershell
cd frontend
npm.cmd run build
```

Also run:

```powershell
git diff --check
```

For authentication or membership changes, test enabled, disabled, non-admin and unauthorized scenarios.

## Git and Deployment Rules

Use feature branches for development.

Do not merge into `main` without explicit approval.

Deployment uses:

`.github/workflows/deploy-swa.yml`

The workflow is manually triggered and currently restricted to:

`feature/day8-mobile-admin`

Do not remove deployment branch restrictions, enable automatic production deployment, or rotate production credentials without approval.

Always verify the selected branch and commit before running deployment.

After deploying, test:

- Microsoft authentication
- Administrator access
- Task dashboard
- Member Management
- Task creation and updates
- Attachment access
- Mobile layout

## Secrets and Sensitive Data

Never commit:

- Azure storage keys
- Connection strings
- Static Web Apps deployment tokens
- Personal access tokens
- Local authentication secrets
- `api/local.settings.json`

Use environment variables, local configuration ignored by Git, and GitHub Actions secrets.

Never print secrets in build logs or user-facing responses.

## AI-Assisted Development Workflow

For each new feature:

1. Understand the business requirement.
2. Inspect the existing implementation.
3. Explain the proposed change and affected files.
4. Implement the smallest suitable change.
5. Build and test locally.
6. Review security and data impact.
7. Review Git changes before committing.
8. Deploy only after explicit approval.
9. Verify the feature in the deployed application.

When uncertain, request the relevant current source code rather than inventing functions, files or configuration.

Prefer clear, step-by-step instructions and verify results before proceeding to the next major change.

## Documentation

Update project documentation when making meaningful architectural or operational changes.

Relevant files:

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/TROUBLESHOOTING.md`
- `docs/ONBOARDING.md`

Keep the documentation consistent with the actual implementation.

## Future Development

Potential future enhancements include identity onboarding improvements, operational monitoring, automated security tests and Infrastructure as Code.

Treat these as optional improvements rather than requirements for the current application.
