# Security

## Reporting a problem

Report security problems privately, not in a public issue: open the repository's **Security** tab and choose
**Report a vulnerability**. Only the maintainer sees the report.

Include what you found, how to reproduce it, and which version and surface (Claude Code plugin, skill, AGENTS.md
block, Gemini extension, Cursor rule or tools) it affects. You will get an answer as soon as possible, and a fix
ships as a **critical** release (see [RELEASING.md](RELEASING.md)).

## What counts

- The hook injecting content other than the files its README section lists, reading other files or variables,
  writing files, or reaching the network.
- A way for a brevity message to be read as permission or as the owner's consent, against SPEC section 1.
- A notation that decodes to the opposite of what the sender wrote, in a way that could cause a wrong action.
- Anything in the tools that reads or sends data the user did not pass them.

## Supported versions

Only the latest release gets fixes. The [CHANGELOG](CHANGELOG.md) lists the releases.
