# brevity DICT: acme-shop (synthetic example; read with SPEC.md; state as of 2026-01-15)
owner = the human who owns this repo and merges every PR; sessions never merge. coord = the session titled «Checkout redesign coordinator»
base = main (origin/main); every PR targets main. Branches: f/X = fix/shop-X; ft/X = feat/shop-X; d/X = docs/changelog-X
Path prefixes (at the start of a path only): UI/ = packages/ui/src/; api/ = services/api/src/; wf/ = .github/workflows/
P.X = UI/pages/XPage.tsx (P.Cart, P.Checkout, P.Account)
Zones of a page: COPY = its `t('...')` strings in both locales; JSX = markup structure; HANDLERS = event handlers and logic; STYLE = styles
CL = docs/CHANGELOG.md; entry n = its section «## n.»; TAIL = its last section «## Known issues»
gates = `pnpm -C packages/ui typecheck` and `pnpm -C services/api typecheck`; `gates a/b` = their error counts; baseline 0/2 on main since #41; pass = error lists identical to main
mcmd N = `gh pr merge N --squash`, run by the owner only
ck.ui = CI check «ui: build + test»; docs-only PRs have no checks by design (ci=none)
R.num = CL entry numbers follow the merge order on main of the RECORDED PR; never reserved ahead
R.entry = write the entry as «## n.» in numeric order, right before TAIL; change no other section
R.ready = head pushed; ck.ui pass; OPEN, not draft, CLEAN; head contains current main; the owner's command is mcmd N; the sender does not merge
R.hand = coord re-checks order and CLEAN on the combined tree, then hands the owner mcmd N
R.copy = product copy in sentence case, no exclamation marks, both locales in the same PR
