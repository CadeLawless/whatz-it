# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Make an issue a sub-issue of a parent**: `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` afterwards (`gh` 2.94+). Older `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>`.
- **Blocking**: Use GitHub's native issue dependencies. Add an edge with `gh issue create --blocked-by <n>,<n> ...` or `gh issue edit <child> --add-blocked-by <blocker>` (`gh` 2.94+). Where dependencies aren't available, use a `Blocked by: #<n>, #<n>` line at the top of the child body.
- **Count open blockers**: `gh api repos/<owner>/<repo>/issues/<n> --jq .issue_dependencies_summary.blocked_by`.
- **Comment on an issue**: `gh issue comment <number> --body "..."`.
- **Apply or remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`.
- **Close**: Post the explanation with `gh issue comment <number> --body "..."`, then run `gh issue close <number>`.

Infer the repo from `git remote -v`; `gh` normally does this automatically when run inside a clone.

File issues only into the user's own repo. Never file into `mattpocock/skills` unless the user owns it. Before the first `gh issue create` of a session, check the target with `gh repo view --json nameWithOwner` and confirm it if it is not the user's repo.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Read it using the convention above.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with child issues as tickets.

- **Map**: A single issue labelled `wayfinder:map`, holding Notes, Decisions-so-far, and Fog.
- **Child ticket**: An issue linked to the map as a GitHub sub-issue. Labels use `wayfinder:<type>` (`research`, `prototype`, `grilling`, or `task`).
- **Blocking**: Use the blocking convention above.
- **Frontier query**: Find the first open, unassigned child without open blockers.
- **Claim**: `gh issue edit <n> --add-assignee @me`.
- **Resolve**: Comment with the answer, close the issue, then append a context pointer to the map's Decisions-so-far.
