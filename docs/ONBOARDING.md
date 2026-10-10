# Team Workload App — Member Onboarding Guide

## Purpose

This guide explains how an administrator invites a new teammate, registers their application membership, verifies access, and manages their account afterward.

**Application:** https://blue-field-0bfd34400.4.azurestaticapps.net

## Part 1 — Administrator: Invite a New Member

1. Sign in to the Azure Portal.
2. Open the Static Web App named `swa-team-workload-dev` in resource group `rg-team-workload-dev`.
3. Navigate to **Role management**.
4. Create a user invitation using the teammate's Microsoft account email address.
5. Assign the `member` role.
6. Send the invitation link to the teammate.

The user must accept the invitation before completing onboarding.

Do not assign the `admin` role unless the teammate requires administrator privileges.

## Part 2 — Teammate: Accept Invitation

1. Open the invitation link received from the administrator.
2. Accept the invitation using the intended Microsoft account.
3. Open the Team Workload application.
4. Sign in with Microsoft.

The application may initially show an access-denied message because the administrator has not yet registered the user's application membership.

This is expected during onboarding.

## Part 3 — Teammate: Obtain SWA User ID

After signing in, open:

https://blue-field-0bfd34400.4.azurestaticapps.net/.auth/me

The response contains a `clientPrincipal` object.

Example:

```json
{
  "clientPrincipal": {
    "identityProvider": "aad",
    "userId": "example-principal-id",
    "userDetails": "user@example.com",
    "userRoles": [
      "anonymous",
      "authenticated",
      "member"
    ]
  }
}
```

Copy only the `userId` value and send it to the administrator.

Do not send access tokens, passwords, or other sensitive authentication information.

## Part 4 — Administrator: Register Application Membership

1. Sign in to the Team Workload application using the administrator account.
2. Click **Manage Members**.
3. Under **Add Member**, enter:
   - **Microsoft SWA User ID:** The `userId` supplied by the teammate.
   - **Display Name:** The teammate's preferred display name.
4. Click **Add Member**.
5. Confirm that the new member appears in the member list with status **Enabled**.

The membership record must use the actual SWA principal ID.

Adding a member record does not create a Microsoft account or issue an SWA invitation. Both steps are necessary.

## Part 5 — Teammate: Verify First Login

1. Return to the Team Workload application.
2. Refresh the page.
3. Confirm that the dashboard loads.
4. Verify that the teammate's display name appears in the member list.
5. Open a task and review its details.
6. Create a simple test task if the administrator requests one.
7. Confirm that the teammate can perform permitted task operations.

A regular member should not see the **Manage Members** navigation button.

If access is denied, contact the administrator for verification.

## Part 6 — Administrator: Manage Existing Members

### Change Display Name

1. Open **Manage Members**.
2. Locate the member.
3. Click **Edit Name**.
4. Enter the new display name.
5. Confirm the change.

Changing the display name does not change the member's identity ID.

### Disable a Member

1. Open **Manage Members**.
2. Locate the member.
3. Click **Disable**.
4. Confirm the action.

The disabled member can no longer access protected application APIs.

Their existing tasks and history remain stored.

Disabling application membership does not automatically revoke the Microsoft session or SWA invitation.

### Re-enable a Member

1. Open **Manage Members**.
2. Locate the disabled account.
3. Click **Enable**.
4. Confirm the action.

The member can refresh the application and resume working, provided their SWA role and authentication remain valid.

## Part 7 — Troubleshooting Access

| Problem | What to check |
|---|---|
| Microsoft sign-in fails | Account and invitation acceptance |
| Access not granted | SWA `member`/`admin` role |
| Application access disabled | Membership record and `Enabled` status |
| User does not appear | Verify the registered SWA User ID |
| User can sign in but APIs return 403 | Membership and permissions |
| Application temporarily unavailable | Backend or storage availability |
| Manage Members is missing | User may not have the `admin` role |

For additional diagnostics, see `docs/TROUBLESHOOTING.md`.

## Part 8 — Security Notes

- Each teammate must use their own Microsoft identity.
- Do not share administrator accounts.
- Grant `member` instead of `admin` unless elevated privileges are necessary.
- Do not copy another user's SWA principal ID.
- Do not expose Azure storage keys or deployment credentials.
- Use the application's Admin page for normal membership changes.
- If a teammate permanently leaves, disable application membership and separately revoke their SWA role/invitation as appropriate.

## Part 9 — Onboarding Checklist

- [ ] Administrator has issued an SWA invitation.
- [ ] Teammate has accepted the invitation.
- [ ] Teammate can authenticate with Microsoft.
- [ ] Teammate has supplied the correct `clientPrincipal.userId`.
- [ ] Administrator has created the application membership.
- [ ] Member status is Enabled.
- [ ] Teammate can open the dashboard.
- [ ] Teammate can access permitted task features.
- [ ] Teammate understands task ownership and update rules.
- [ ] Teammate knows who to contact for support.
