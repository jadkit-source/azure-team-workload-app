# Team Workload App — Troubleshooting Guide

## 1. Purpose

This guide describes common issues, diagnostic procedures, and recovery steps for the Azure Team Workload App.

It covers local development, authentication, Azure Functions, storage, frontend errors, and deployment.

## 2. Local Development Services

The application normally uses four running services during local development.

| Service | Port | Purpose |
|---|---|---|
| Azurite Blob | 10000 | Local attachments |
| Azurite Queue | 10001 | Local Functions storage |
| Azurite Table | 10002 | Local task and member data |
| Azure Functions | 7071 | Backend APIs |
| Vite | 5173 | React development server |
| Static Web Apps CLI | 4280 | Authentication gateway |

### Check listening ports

```powershell
Get-NetTCPConnection -State Listen `
  -LocalPort 4280,5173,7071,10000,10001,10002 `
  -ErrorAction SilentlyContinue |
  Select-Object LocalPort, OwningProcess |
  Sort-Object LocalPort
```

### Startup order

Start Azurite first, followed by Azure Functions, Vite and the Static Web Apps emulator.

**Azurite**

```powershell
cd C:\projects\azure-team-workload-app
npx.cmd azurite --location "C:\projects\azure-team-workload-app\.azurite" --skipApiVersionCheck
```

**Azure Functions**

```powershell
cd C:\projects\azure-team-workload-app\api
npm.cmd run build
func.cmd start
```

**Vite**

```powershell
cd C:\projects\azure-team-workload-app\frontend
npm.cmd run dev
```

**Static Web Apps CLI**

```powershell
cd C:\projects\azure-team-workload-app
npx.cmd @azure/static-web-apps-cli start http://localhost:5173 --api-devserver-url http://localhost:7071
```

Use `http://localhost:4280` to access the complete application locally.

## 3. Azure Functions Cannot Access Storage

**Symptoms**

- Functions fail during startup or execution.
- Errors mention `AzureWebJobsStorage`.
- Task or attachment requests fail.

**Checks**

1. Confirm Azurite is running.
2. Confirm ports 10000, 10001 and 10002 are listening.
3. Check local storage configuration.
4. Restart Azure Functions after restoring Azurite.

Do not delete Azurite data files simply to fix a startup error; they may contain local test tasks.

## 4. Azure Functions Endpoint Returns HTTP 404

**Symptoms**

A newly added endpoint returns HTTP 404 even though `npm.cmd run build` succeeds.

**Checks**

1. Confirm the compiled JavaScript exists under `api/dist/src/functions`.
2. Check the Functions startup list.
3. Start Functions with verbose logging:

```powershell
cd C:\projects\azure-team-workload-app\api
func.cmd start --verbose
```

4. Look for function loading, registration or route-conflict errors.

**Known issue encountered**

The route `/api/admin/members` conflicted with a built-in Azure Functions route.

The solution was to use:

`/api/management/members`

Avoid using reserved Functions management routes for custom APIs.

## 5. HTTP 401 — Authentication Required

**Possible causes**

- The user has not signed in.
- The authentication session is missing or invalid.
- An API was called directly without the Static Web Apps gateway.

**Checks**

Open:

`http://localhost:4280/.auth/me`

Verify that a valid principal is returned.

For normal application access, use port 4280 locally, not port 7071.

In production, use the deployed Static Web Apps hostname.

## 6. HTTP 403 — Access Denied

**Possible causes**

- The user lacks the required `member` or `admin` role.
- The user's membership record does not exist.
- `Enabled` is not Boolean `true`.
- A member attempts an administrator-only action.
- The user lacks permission for a particular task operation.

**Checks**

1. Verify `/.auth/me`.
2. Confirm the user's `userId`.
3. Verify the matching record in the `Members` table.
4. Confirm `Enabled` is a Boolean value.
5. Check whether the requested operation requires administrator privileges.

An administrator cannot disable their own account through the Member Management API.

## 7. Account Disabled Screen Appears

The application checks membership through `/api/my-access`.

If the backend rejects the user's membership, the frontend shows an access-disabled message.

**Recovery**

An enabled administrator can open **Manage Members** and re-enable the user's account.

The user can then refresh the application.

If membership storage is unavailable, the frontend should display a temporary service error rather than treating the account as disabled.

## 8. HTTP 503 — Membership or Storage Unavailable

**Symptoms**

- Membership verification fails.
- API requests return a service-unavailable response.
- The application cannot retrieve member information.

**Checks**

1. Verify storage availability.
2. Check Azure Functions logs.
3. Confirm the required application settings exist.
4. Check connectivity between the API and Azure Storage.

The backend is designed to deny protected operations when it cannot verify membership.

Avoid bypassing membership checks to resolve an outage.

## 9. Members Missing From the Dashboard

The regular Members API returns enabled members.

If a member has been disabled, they may no longer appear in the workload distribution list.

Administrators can use the **Manage Members** page to view both enabled and disabled members.

Existing tasks remain stored even when a member is disabled.

## 10. Azure Table Storage Data Type Problems

**Known issue encountered**

Using Azure CLI to insert `Enabled=true` can create the property as a string instead of a Boolean.

The application requires:

`Enabled === true`

**Recommended approach**

Use the Azure Tables SDK when creating or updating membership records.

Verify that the stored property is Boolean, not the string `"true"`.

Do not share storage keys or connection strings in troubleshooting messages.

## 11. Azurite Connection String Fails in Azure CLI

**Symptoms**

Azure CLI reports:

`Connection string missing required connection details.`

**Cause**

The CLI command does not accept the shorthand `UseDevelopmentStorage=true` in the same way as the application's Azure SDK.

**Workaround**

Use the installed `@azure/data-tables` Node.js SDK to query local Azurite.

For production queries, use appropriate Azure authentication or a securely supplied connection string.

Never commit storage credentials.

## 12. Task Attachments Fail

**Checks**

- Confirm that the private Blob container exists.
- Confirm `BLOBS_CONNECTION_STRING` is configured.
- Confirm the user is authenticated and enabled.
- Verify that the operation is permitted for the task.
- Check the five-file and 5 MB-per-file limits.
- Review Azure Functions logs for storage failures.

Image and PDF previews are provided through authenticated application endpoints.

A disabled member should receive HTTP 403 when attempting to access attachments.

## 13. Frontend Shows a Blank Page

**Possible causes**

- Vite is not running.
- Azure Functions or Azurite is unavailable.
- JavaScript runtime error.
- An API request has failed.

**Checks**

1. Open browser Developer Tools.
2. Review Console errors.
3. Review failed requests in the Network tab.
4. Verify backend and emulator ports.
5. Run the frontend production build.

```powershell
cd C:\projects\azure-team-workload-app\frontend
npm.cmd run build
```

## 14. PowerShell Blocks npm or npx

**Symptoms**

PowerShell blocks script execution because `.ps1` execution is restricted.

**Workaround**

Use Windows command shims:

- `npm.cmd`
- `npx.cmd`
- `func.cmd`

This avoids changing system-wide execution policy merely to run development tools.

## 15. GitHub Actions Deployment Does Not Run

**Checks**

1. Open `.github/workflows/deploy-swa.yml`.
2. Confirm `workflow_dispatch` is enabled.
3. Select the intended branch in GitHub Actions.
4. Check the workflow job's branch condition.
5. Check the job logs if it is skipped or fails.

At the time of this documentation, deployment is restricted to:

`feature/day8-mobile-admin`

A Git push does not automatically start the manual deployment workflow.

## 16. Deployment Succeeds but Changes Are Not Visible

**Checks**

1. Confirm the deployed branch and commit.
2. Verify GitHub Actions reports successful deployment.
3. Refresh the browser.
4. Try a hard refresh if necessary.
5. Inspect the deployed app and API behavior.

Verify the actual production application rather than assuming the workflow's success means every feature works correctly.

## 17. Git Line-Ending and Whitespace Warnings

**Known warning**

`LF will be replaced by CRLF`

This is generally informational on Windows.

**Whitespace validation**

```powershell
git diff --check
git diff --cached --check
```

Fix trailing-whitespace errors before committing.

## 18. Backend Automated Tests

Run:

```powershell
cd C:\projects\azure-team-workload-app\api
npm.cmd test
```

The current permission test suite covers task deletion, attachment permissions, administrative purge permission and description editing.

Passing automated tests does not replace production integration and security testing.

## 19. Production Incident Checklist

When users report an issue:

1. Identify the affected user and function.
2. Determine whether the problem affects one user or everyone.
3. Check authentication and membership.
4. Check the browser Network tab for HTTP status codes.
5. Review Azure Functions and storage errors.
6. Confirm whether a recent deployment occurred.
7. Preserve relevant logs before making changes.
8. Validate the fix with a non-destructive test.

Avoid deleting tasks, resetting storage or relaxing authentication while troubleshooting.

## 20. Escalation and Recovery

If a production deployment causes failures, review the last known working Git commit and deployment workflow.

A code rollback may restore the application, but it does not automatically reverse data modifications made after deployment.

Test access, task retrieval, member management and attachments after any rollback.

