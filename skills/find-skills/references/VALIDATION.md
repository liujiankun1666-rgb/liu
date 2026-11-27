# Verified reuse record

Version: upstream snapshot e7fd0e9e52f029fe87729d8185cb8caf7049f678
Source: https://github.com/vercel-labs/skills/tree/e7fd0e9e52f029fe87729d8185cb8caf7049f678/skills/find-skills
License: MIT; copyright notice retained in ../LICENSE.
Adaptation: SKILL.md is unchanged. This record documents a tested integration, not new authorship.

## Actual task validation

Date: 2026-11-27 (Asia/Shanghai).
Purpose: discover reusable skills for an existing personal task-management workflow.
1. Installed the pinned source with the official Codex skill-installer.
2. Ran the official skill-creator quick_validate.py: Skill is valid!
3. Installed Skills CLI 1.9.1 using npm --ignore-scripts in an isolated directory.
4. Executed a real network search:

    DISABLE_TELEMETRY=1 DO_NOT_TRACK=1 node <cli-directory>/node_modules/skills/bin/cli.mjs find 'context compression'

Exit code: 0. Search returned muratcankoylan/agent-skills-for-context-engineering@context-compression and other candidates. The first source was then inspected for license, dependencies and behavior before installation.

## Reproduction and limits

Requires a supported Node runtime; CLI 1.9.1 package.json declares Node >=22.20.0. Use the host's installer for this skill; for the tested CLI use npm install --prefix <cli-directory> --ignore-scripts --no-audit --no-fund skills@1.9.1. Pin exact skill revisions when installing candidates. Search results are leads, not proof of correctness. Disable telemetry as above. Read candidates before executing their scripts.

Verified scope: skill discovery, candidate inspection, installation and static validation. No claim that every found skill works or that task reminders/background jobs are running. Search rankings and compatibility can change.

