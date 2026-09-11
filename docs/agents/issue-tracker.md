# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

- **Map and tickets**: a map is an issue labelled `wayfinder:map`; tickets are its child issues, created with `gh issue create` then linked as sub-issues (`gh issue develop`/the repo's usual sub-issue flow, or the `addSubIssue` GraphQL mutation).
- **Native blocking**: GitHub *does* expose a mutation for issue-dependency edges — `addBlockedBy`/`removeBlockedBy` via GraphQL (`gh api graphql`), even though there's no `gh issue edit` flag for it and the CLI docs don't mention it. Always wire blocking natively, not just as a **Blocked by** line in the ticket body — the native edge is what makes GitHub render the frontier visually (the "Blocked by" panel in the issue sidebar), which is the whole point of using native dependencies over a body convention.
  ```
  gh api graphql -f query='
    mutation($issueId: ID!, $blockingIssueId: ID!) {
      addBlockedBy(input: {issueId: $issueId, blockingIssueId: $blockingIssueId}) {
        issue { number }
        blockingIssue { number }
      }
    }' -f issueId=<node id of blocked issue> -f blockingIssueId=<node id of blocking issue>
  ```
  Get node ids with `gh api graphql -f query='{ repository(owner:"OWNER", name:"REPO") { issue(number: N) { id } } }'`.
- **Reading the frontier**: query `blockedBy`/`blocking` connections on `Issue` via GraphQL (not exposed in `gh issue view` JSON) to check what's actually wired, e.g. `repository(...) { issue(number: N) { subIssues(first: 50) { nodes { number title blockedBy(first: 10) { nodes { number } } } } } }`.
