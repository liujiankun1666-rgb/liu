---
name: todoist-project-intake
description: Set up or reconcile a personal project intake in an already connected Todoist account, reuse existing projects and sections, register actionable unfinished tasks, and verify the resulting objects. Use for project intake and task registration, not automatic scheduling or migration of unrelated projects.
---

# Todoist Project Intake

Use the connected Todoist tools directly. This skill adds workflow guidance, not a new task application or background sync service. Discover the available tool schemas before calling them; tool prefixes may differ between hosts.

## Reconcile before writing

Read the user's current request and any existing local project registry or status record. Confirm the intended account and project scope with `user-info` and project reads. A connected account does not authorize unrelated workspaces, collaborators, notifications, or account-setting changes.

Use `find-projects` to locate the intended project, following pagination as needed. Reuse a verified project ID. Check matching archived projects when relevant; do not silently restore them. If several projects remain plausible, resolve the ambiguity before writing.

For personal intake, create a personal project only when no suitable project exists. Preserve an existing layout. Add sections only when they help the actual workflow; no fixed section names or count are required. Read existing sections before adding any.

## Register real work

Read tasks in the selected project and compare their purpose, status and local identifiers before adding tasks. Reuse existing matches even if their titles differ slightly. Do not copy unfinished-looking historical entries without checking their current status.

Create only concrete, unfinished actions. Put acceptance criteria, dependencies and the next permitted action in task descriptions. Standing operating rules belong in the project description or local guide; completed setup work should not become a new open task. External dependencies may be recorded as waiting tasks without implying permission to perform the dependent action.

Do not invent dates, reminders, recurring schedules or assignees. When timing is requested, compare the account timezone with the user's intended timezone and make the interpretation explicit. Do not silently change account settings. Use the connector's rescheduling operation to move existing dates without replacing recurrence.

## Verify and retain the mapping

Inspect each mutation's success and failure counts. After a timeout or partial success, read the destination before retrying; retry only missing changes. Stop dependent writes on authentication, permission or quota failures and report the exact blocker.

Read back created or changed projects, sections and tasks. Confirm ownership/sharing, placement, content and requested timing. Record their stable IDs, returned links, verified state and verification time in the local registry when one is used. Keep operational mappings local; reusable packages should contain no account IDs, private paths or task contents.

Report actual changes and remaining blockers. Distinguish Todoist task state from local project documentation and from any separate application's project grouping. Do not claim automatic synchronization, reminder delivery or background execution unless that capability was separately configured and verified.

For the verified integration scope and untested cases, read [the validation record](references/VALIDATION.md).
