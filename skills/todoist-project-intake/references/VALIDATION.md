# Integration validation

Validated on 2026-11-27 with an authenticated Todoist connector.

This package records a successful use of existing Todoist tools. It contains original orchestration instructions, not a new connector or copied upstream implementation. Connector source reference: https://github.com/todoist/todoist-mcp . Availability and schemas must be discovered in the executing host.

## Observed result

- Read the account and all project names, including archived projects. The requested project did not exist.
- Created one personal project with a board view and favorite status. Readback confirmed that it was not shared.
- Created three requested workflow sections, then listed them by project and confirmed their identifiers and names.
- Queried existing project tasks before creation; the result was empty.
- Added one real unresolved action with a clear completion condition and blocker in the appropriate section.
- Read back the task and confirmed its project, section, incomplete state and nonrecurring status. No due date, reminder, deadline or assignment was requested.
- Recorded stable identifiers in the private local ledger, without including them in this public package.
- Detected a difference between account and user's working timezone. The task did not require scheduling, so no date was added and account settings were not changed.

## Limits

Verified scope: account/project reads, personal project/section/task creation, and readback. Existing-project reuse and deduplication of populated task lists are workflow safeguards, not claimed live test cases here. No reminders, notification delivery, recurring jobs, continuous synchronization, shared projects or account timezone changes were tested. A separate application's project-creation blocker remained unresolved and was recorded as a genuine pending task.

No personal identifiers, email addresses, local paths, customer data or account records are included. Future publication requires a user-authorized destination and verification of the actual upload.
