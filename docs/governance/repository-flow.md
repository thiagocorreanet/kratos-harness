# Repository integration and release flow

Feature, fix, documentation, and refactor branches target `developer` through
pull requests. `developer` remains green and is promoted to `main` by a release
pull request. Emergency hotfixes target `main`, publish a patch release, and
merge back into `developer` immediately.

Both branches prohibit force push and deletion and require pull requests,
successful checks, resolved conversations, and controlled bypass. `main` also
requires release approval. Squash merge is the default so one reviewed change
maps to one changelog entry; release pull requests may use a merge commit to
preserve the promotion boundary.

The expected ruleset declaration lives in
`quality/github-rulesets.expected.json`. Run `npm run rulesets:verify --
--repository OWNER/REPOSITORY` with authenticated `gh` access to compare active
rulesets and exact required job names. Source declarations do not activate
GitHub protections by themselves.
