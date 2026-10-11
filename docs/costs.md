# What multi-agent setups cost in tokens

This guide explains what shared context and messages cost when several coding-agent sessions work together, and
when a shared protocol such as brevity pays for itself. It applies to any context that every session carries: a
protocol spec, a dictionary, a long `CLAUDE.md`, tool definitions.

The stakes are large. Anthropic reports that its multi-agent research system used about 15 times the tokens of a
chat ([multi-agent research system][ma]), and Claude Code's documentation puts agent teams at about 7 times the
tokens of a standard session when teammates run in plan mode ([Manage costs][cc-costs]).

The numbers below come from [tools/cost-model.mjs](../tools/cost-model.mjs), on synthetic teams. Every price has a
source under [Sources](#sources), and every assumption is marked as one. To measure what brevity actually cost and
saved in your own Claude Code sessions instead, run [tools/meter.mjs](../tools/meter.mjs) on their transcripts.

## Prices and inputs

The model counts everything in **input-token equivalents**: an uncached input token is 1, and every other kind of
token is weighted by its price relative to that.

| token | weight | source |
|---|---|---|
| uncached input | 1 | the unit |
| output | 5 | [Pricing][pricing]: on every model listed, output costs 5 times input (for example $4 and $20 per million tokens on Claude Opus 5.5, $1 and $5 on Claude Haiku 4.5) |
| cache write, 5-minute lifetime | 1.25 | [Pricing][pricing], prompt caching section |
| cache write, 1-hour lifetime | 2 | [Pricing][pricing], prompt caching section |
| cache read | 0.1; 0.05 on Claude Opus 5.5; 0.025 on Claude Fable 5.1 and Claude Mythos 5.1 | [Pricing][pricing], prompt caching section |

Prices were checked on 2026-09-30. By default the tool prices output at 5 and cache writes at 2, the 1-hour rate:
Claude Code paid it for every cache write in the 1,088 calls measured in
[issue #11](https://github.com/nsalloums/brevity/issues/11). Cache reads follow `--model`, which defaults to
`claude-opus-5-5`, the model of all of those calls: 0.05 on it, 0.025 on `claude-fable-5-1` and
`claude-mythos-5-1`, and 0.1 on any other model, the prices [tools/meter.mjs](../tools/meter.mjs) uses. Claude Code
writes 5-minute entries on usage credits, an API key or a cloud provider ([Manage costs][cc-costs]): pass
`--write 1.25` there. `--output`, `--write` and `--read` override each price, and the output says which prices ran.
Until [issue #40](https://github.com/nsalloums/brevity/issues/40), the defaults were 1.25 for writes and 0.1 for
reads.

| input | value | source |
|---|---|---|
| spec plus a small dictionary, loaded per session | 3,200 tokens | [eval/RESULTS.md](../eval/RESULTS.md#break-even): the spec is 2,674 tokens, and a small dictionary adds about 500 |
| tokens one message saves | 60 | [eval/RESULTS.md](../eval/RESULTS.md): 60.0 on average over 268 measured messages |
| stub | 138 tokens | the brevity skill's name and description, which a session carries so it can load brevity on demand; the default in `tools/cost-model.mjs` |
| skill entry | 143 tokens | the Claude Code plugin's line in the skill listing, which every session carries ([issue #40](https://github.com/nsalloums/brevity/issues/40)); `--skill-entry`, 0 by default |

The worked examples below use the audited 60 tokens per message. A session that writes each message once saves
about 37 ([single writing pass](../eval/RESULTS.md#single-writing-pass-pilot-2026-10-04)), and at that saving a
200-call session needs 104 to 149 messages to break even, not 64 to 92
(`node tools/cost-model.mjs --saving 37 --load-tokens 3200 --turns 200`). At 37, no reader card keeps the hub team
in example 2 ahead, even one of 0 tokens.

### Assumptions

- **Assumption: plan limits weigh tokens as the API prices do.** On a Claude subscription, Claude Code usage draws
  on plan limits instead of a per-token bill, and long context counts against those limits at the cached rate
  ([Manage costs][cc-costs]). How plan limits weigh each kind of token is not published.
- **Assumption, by default: the cache stays warm and a session holds one copy.** Loaded context is written once
  and read on every later call. A cache entry lives 5 minutes by default, and every read refreshes it
  ([Prompt caching][caching]). In Claude Code the lifetime is 1 hour on a subscription, and 5 minutes on usage
  credits, an API key or a cloud provider ([Manage costs][cc-costs]). A session that sits idle for longer writes its
  whole context again at its next call, and the hook loads the spec again after each compaction and resume, so the
  defaults understate what loaded context costs. The options under
  [Costs the defaults leave out](#costs-the-defaults-leave-out) add these costs.
- **Assumption: messages are spread evenly** over a session's calls, unless the sessions file says when the first
  one arrives.
- **Assumption: messages stay in context until the session ends.** A compaction, or a resume that rebuilds the
  conversation shorter, drops them sooner, and that cuts the saving. The model leaves this out.
- **Assumption: the token counts carry over to current models.** eval/RESULTS.md counts with Anthropic's legacy
  public tokenizer, and current models produce about 30% more tokens for the same text ([Pricing][pricing]). The spec
  and the saving grow together, so break-even counts move little, but the absolute numbers grow.
- **Assumption: every message saves 60 tokens.** Delegation prompts and subagent results are often longer than
  peer messages, and in eval/RESULTS.md long messages saved more (29.7%).

### Costs the defaults leave out

Each of these is an option whose default adds nothing. Only the rows below that name them use them.

| option | what it adds | default |
|---|---|---|
| `--reinject N` | N extra copies per session: the hook loads the spec again after each compaction and resume. A copy is one more cache write of what the session carries. The compaction or resume drops the old copy, so the reads do not change. Copies fall evenly over a session's calls, so a session that loads at call F pays N x (T - F) / T of them | 0 |
| `--reinject-every N` | one extra copy at calls N, 2N, ... before a session's last call, as when its context fills every N calls | none |
| `--idle-misses R` | the share of calls, from 0 to 1, that follow an idle gap longer than the cache lifetime. Such a call writes its whole prefix again, so loaded context and carried messages both cost read + R x (write - read) per call | 0 |
| `--skill-entry N` | the plugin's entry in the skill listing, 143 tokens for the Claude Code plugin. The plugin lists the skill in every session, so each session carries it under every policy, and net 0 then means no plugin. Where a policy carries the stub, the stub is that entry and counts once | 0 |

How often sessions compact, resume or sit idle depends on the team. For a real team, measure these costs instead
of guessing them: [tools/meter.mjs](../tools/meter.mjs) prices every copy call by call from your transcripts,
including re-injections, rewrites after an idle miss, the skill entry, and messages dropped at a compaction. In this
project's own sessions, these costs came to about 70,000 input-token equivalents, against a measured spec cost of
about 300,000 ([issue #40](https://github.com/nsalloums/brevity/issues/40)).

## The model in plain words

The examples use the default prices: Claude Opus 5.5's cache reads (0.05) and 1-hour cache writes (2).

- **Loaded context is paid on every call, not once.** When a session loads something (a spec, a dictionary,
  `CLAUDE.md`), its first model call writes it to the prompt cache (2). Every later call reads it again (0.05),
  because each request sends the whole context ([Manage costs][cc-costs]). A 3,200-token spec in a session of 200
  calls costs 3,200 x (2 + 0.05 x 200) = 38,400 equivalents, and 83% of that is reads.
- **A message is paid three times.** Its writer pays for it as output (5). Its reader takes it in, as a cache write
  (2). Then both sessions carry it: each reads it again on every later call (0.05 per call, in each session).

So, for a session that loads L tokens and then makes T calls, and a message made s tokens shorter:

```
cost of the loaded context  = L x (2 + 0.05 x T)
saving of the shorter message = s x (5 + 2 + 0.05 x R_writer + 0.05 x R_reader)
```

R is the number of calls left in each session after the message. This is the formula in the header of
`tools/cost-model.mjs`, with the default prices and without the costs the defaults leave out. Like eval/RESULTS.md,
it leaves out the writer's cache write of its own message.

Three things follow.

1. **A session needs about 2 x L / s messages to break even.** In a long session, reads dominate both sides: the
   loaded context is read on all T calls, and a message on about T/2 calls on average. With L = 3,200 and s = 60,
   that is about 107 messages, and fewer for a session that mostly writes, since output weighs 5:

   ```
   node tools/cost-model.mjs --saving 60 --load-tokens 3200 --turns 200
   ```

   ```
   break-even for a session with 200 calls that loads at its first call:
     64 messages if it sends them all, 92 if it receives them all, 76 half and half
   ```

   With `--turns 2000` the range is 99 to 105 messages.
2. **The prices move the count, not the conclusion.** A cache read's price cuts the cost of loaded context and the
   saving on carried messages alike. The same session needs 79 to 98 messages at the read price of other models
   (`--model claude-sonnet-5-5`, 0.1), 50 to 83 on Claude Fable 5.1 (`--model claude-fable-5-1`, 0.025), and 60 to
   96 with 5-minute cache writes (`--write 1.25`). With 0.1 reads and 5-minute writes, the defaults before
   issue #40, it needs 76 to 101.
3. **The team's net is the sum over sessions.** A session that loads the context and exchanges few messages loses
   almost all of its load cost, and one busy session cannot pay for many such sessions.

## Three team shapes

The sessions files are in [docs/teams/](teams/). Run the commands from the repository root. The outputs are real,
and `…` marks where a long table or the list of assumptions was cut.

### 1. Two long sessions that talk a lot

[teams/pair.json](teams/pair.json): two sessions with 800 calls each, which send each other 100 messages each way.

```
node tools/cost-model.mjs docs/teams/pair.json --saving 60 --load-tokens 3200
```

```
brevity cost model, in input-token equivalents (output 5x, cache write 2x, cache read 0.05x an input token)
prices: cache read for claude-opus-5-5 (the default; --model names another), cache write at the 1-hour rate (--write 1.25 for 5-minute caching)
extra costs: no re-injected copies (--reinject N per session, --reinject-every N calls), no idle cache misses (--idle-misses R), no skill entry (--skill-entry 143 for the Claude Code plugin)
tools/meter.mjs measures these costs from a team's own transcripts, call by call: for a real team, use it.
loaded per session: 3,200 tokens (--load-tokens)
saving per message: 60 tokens (--saving)

break-even for a session with 800 calls that loads at its first call:
  90 messages if it sends them all, 102 if it receives them all, 96 half and half

team: 2 sessions, 200 messages sent, 200 received
hub: a session with at least its own break-even in messages (--threshold N sets one count); 2 of 2
stub: the 138 tokens a session carries so it can load on its first message (the skill's name and description)
policy                                            sessions that load    saved     cost       net
always-on                                              2 from call 0  564,000  268,800  +295,200
hub-only                                               2 from call 0  563,999  268,800  +295,199
first-message                 2 from first message; 2 carry the stub  564,000  279,118  +284,882
hub+first      2 from call 0, 0 from first message; 0 carry the stub  564,000  268,800  +295,200
highest net: always-on (+295,200). A model, not a decision: check the assumptions below.

net per session (0 = no brevity):
session  calls  sent  received  break-even  hub  always-on  hub-only  first-message  hub+first
api        800   100       100          96  yes   +147,600  +147,600       +142,441   +147,600
web        800   100       100          96  yes   +147,600  +147,600       +142,441   +147,600
total                                             +295,200  +295,199       +284,882   +295,200
…
```

Each session exchanges 200 messages, about twice its break-even of 96, so both come out ahead. Loading the spec
from the start (always-on) is best here. Loading it at the first message costs a little more, because each session
carries the 138-token stub from its first call and its messages start early anyway. This is the shape brevity is
built for.

### 2. A hub with many short-lived peers

[teams/hub.json](teams/hub.json): the team from [issue #23](https://github.com/nsalloums/brevity/issues/23), shaped
like the project in eval/RESULTS.md. One hub makes 2,000 calls, sends 158 messages and receives 110. Eighty peers
make 150 calls each and exchange 1 to 14 messages each (30 peers with 1, 14 with 2, 14 with 3, 8 with 4, 4 with 8,
4 with 9, 3 with 10, 2 with 12 and 1 with 14; median 2). Each peer receives half of its messages, rounded up.

```
node tools/cost-model.mjs docs/teams/hub.json --saving 60 --load-tokens 3200 --reader-tokens 300
```

```
brevity cost model, in input-token equivalents (output 5x, cache write 2x, cache read 0.05x an input token)
prices: cache read for claude-opus-5-5 (the default; --model names another), cache write at the 1-hour rate (--write 1.25 for 5-minute caching)
extra costs: no re-injected copies (--reinject N per session, --reinject-every N calls), no idle cache misses (--idle-misses R), no skill entry (--skill-entry 143 for the Claude Code plugin)
tools/meter.mjs measures these costs from a team's own transcripts, call by call: for a real team, use it.
loaded per session: 3,200 tokens (--load-tokens)
saving per message: 60 tokens (--saving)

break-even for a session with 150 calls that loads at its first call:
  58 messages if it sends them all, 89 if it receives them all, 70 half and half

team: 81 sessions, 268 messages sent, 268 received
hub: a session with at least its own break-even in messages (--threshold N sets one count); 1 of 81
stub: the 138 tokens a session carries so it can load on its first message (the skill's name and description)
reader card: 300 tokens (--reader-tokens), to read only: readers write in prose
policy                                                               sessions that load    saved       cost         net
always-on                                                                81 from call 0  976,860  2,758,400  -1,781,540
hub-only                                                                  1 from call 0        0    326,400    -326,400
first-message                                  81 from first message; 81 carry the stub  976,860  2,249,662  -1,272,802
hub+first                       1 from call 0, 80 from first message; 80 carry the stub  976,860  2,236,776  -1,259,916
hub+reader     1 from call 0, 80 readers from first received message; 80 carry the stub  575,890    587,931     -12,041
every policy costs more than it saves: not loading brevity (net 0) beats the best, hub+reader (-12,041).
hub+reader stays above 0 with a reader card of up to 276 tokens.
hub-only saves nothing with one hub: a message saves only between two sessions that loaded the spec.

net per session (0 = no brevity):
session  calls  sent  received  break-even  hub   always-on  hub-only  first-message   hub+first  hub+reader
hub      2,000   158       110         102  yes    +538,200  -326,400       +525,314    +538,200    +195,000
peer-01    150     0         1          89          -30,055         0        -19,366     -19,366      -2,691
…
peer-31    150     1         1          70          -29,530         0        -22,841     -22,841      -2,691
…
peer-80    150     7         7          70          -24,310         0        -24,021     -24,021      -1,466
total                                            -1,781,540  -326,400     -1,272,802  -1,259,916     -12,041
…
```

- **Loading the spec in every session loses 1.78 million.** This is what opting the project in with a `.brevity/`
  folder does. The hub gains 0.54 million, but each peer loses 24,000 to 30,000: it carries the spec on each of its
  150 calls to save on 1 to 14 messages.
- **Loading on demand loses less, but still loses.** A peer that loads the spec at its first message carries it for
  the rest of its life.
- **Loading only in the hub saves nothing,** because the peers cannot read what the hub writes.
- **Only a small read-only card comes out ahead.** In hub+reader, the hub loads the full spec and each peer loads a
  card that only decodes, at the first message it receives. The largest card that keeps the team ahead is 276
  tokens, so the 300-token card in the command nets -12,041. brevity has no reader card: this is a modeled result,
  and [issue #11](https://github.com/nsalloums/brevity/issues/11) tracks the design.

The largest card depends on the assumptions. Each row adds options to the command above. The last four rows add
the costs the defaults leave out, at rates picked to illustrate, not measured:

| option | what it assumes | largest card |
|---|---|---|
| none | the defaults above | 276 tokens |
| `--first start` | each peer's first message arrives at its first call | 209 tokens |
| `--reader-writes` | the card also lets peers write brevity | 966 tokens |
| `--stub 0` | peers carry no 138-token stub before the card | 477 tokens |
| `--model claude-fable-5-1` | Claude Fable 5.1's cache-read price, 0.025 | 267 tokens |
| `--model claude-sonnet-5-5` | the cache-read price of other models, 0.1 | 284 tokens |
| `--write 1.25` | 5-minute cache writes | 320 tokens |
| `--write 1.25 --model claude-sonnet-5-5` | the defaults before issue #40 | 309 tokens |
| `--skill-entry 143` | the Claude Code plugin's skill entry in every session | 249 tokens |
| `--reinject 1` | one compaction or resume per session | 187 tokens |
| `--idle-misses 0.01` | one call in 100 after an idle cache miss | 280 tokens |
| `--skill-entry 143 --reinject 1` | the skill entry and one re-injection per session | 163 tokens |

So under the default prices a read-only card has to stay under 209 to 276 tokens to keep this team ahead, and
under 163 to 249 once the skill entry, a re-injection per session, or both count. The read price moves the limit by
less than 10 tokens, and 5-minute writes raise it by 44. Idle misses barely move it here, because they also raise
the saving on the many messages the hub carries. The 300-token card in the command loses under the default prices;
it comes out ahead only with 5-minute writes (+9,532 with `--write 1.25`), with no stub, or as a card that also
writes.

### 3. An orchestrator with fan-out subagents

[teams/fanout.json](teams/fanout.json): an orchestrator with 1,500 calls hands out 60 tasks. Each of the 60
subagents makes 30 calls, receives its delegation prompt at call 0 (`"first": 0`), and sends back one result.

```
node tools/cost-model.mjs docs/teams/fanout.json --saving 60 --load-tokens 3200 --reader-tokens 300
```

```
brevity cost model, in input-token equivalents (output 5x, cache write 2x, cache read 0.05x an input token)
prices: cache read for claude-opus-5-5 (the default; --model names another), cache write at the 1-hour rate (--write 1.25 for 5-minute caching)
extra costs: no re-injected copies (--reinject N per session, --reinject-every N calls), no idle cache misses (--idle-misses R), no skill entry (--skill-entry 143 for the Claude Code plugin)
tools/meter.mjs measures these costs from a team's own transcripts, call by call: for a real team, use it.
loaded per session: 3,200 tokens (--load-tokens)
saving per message: 60 tokens (--saving)

break-even for a session with 30 calls that loads at its first call:
  33 messages if it sends them all, 68 if it receives them all, 44 half and half

team: 61 sessions, 120 messages sent, 120 received
hub: a session with at least its own break-even in messages (--threshold N sets one count); 1 of 61
stub: the 138 tokens a session carries so it can load on its first message (the skill's name and description)
reader card: 300 tokens (--reader-tokens), to read only: readers write in prose
policy                                                               sessions that load    saved     cost       net
always-on                                                                61 from call 0  328,500  918,400  -589,900
hub-only                                                                  1 from call 0        0  246,400  -246,400
first-message                                  61 from first message; 61 carry the stub  328,500  956,023  -627,523
hub+first                       1 from call 0, 60 from first message; 60 carry the stub  328,500  947,380  -618,880
hub+reader     1 from call 0, 60 readers from first received message; 60 carry the stub  164,244  338,380  -174,136
every policy costs more than it saves: not loading brevity (net 0) beats the best, hub+reader (-174,136).
no reader card makes hub+reader positive: even a card of 0 tokens nets -111,136.
hub-only saves nothing with one hub: a message saves only between two sessions that loaded the spec.

net per session (0 = no brevity):
session       calls  sent  received  break-even  hub  always-on  hub-only  first-message  hub+first  hub+reader
orchestrator  1,500    60        60         101  yes    +48,800  -246,400        +40,157    +48,800     -93,400
sub-01           30     1         1          44         -10,645         0        -11,128    -11,128      -1,346
…
total                                                  -589,900  -246,400       -627,523   -618,880    -174,136
…
```

- **The orchestrator comes out ahead, and the team does not.** The orchestrator exchanges 120 messages, above its
  break-even of 101, and gains 48,800. Each subagent loses 10,645, since it carries the spec for 30 calls to save on
  2 messages, and 60 of them sink the team.
- **A read-only card cannot fix this shape,** even at 0 tokens: half of the traffic is results that the subagents
  write, and a card that only decodes leaves those in prose. A card that also lets them write keeps the team ahead
  up to 252 tokens, so a 300-token one still loses:

  ```
  node tools/cost-model.mjs docs/teams/fanout.json --saving 60 --load-tokens 3200 --reader-tokens 300 --reader-writes
  ```

  ```
  …
  hub+reader     1 from call 0, 60 readers from first message; 60 carry the stub  328,500  338,380    -9,880
  every policy costs more than it saves: not loading brevity (net 0) beats the best, hub+reader (-9,880).
  hub+reader stays above 0 with a reader card of up to 252 tokens.
  …
  ```

- **The bigger lever here is the size of what comes back.** A result stays in the orchestrator's context for the
  rest of its calls. With the prices above, a 1,000-token result that arrives halfway through costs
  1,000 x (2 + 0.05 x 750) = 39,500 equivalents: about 8 times what the subagent paid to write it (5,000), and more
  than 3 times a subagent's whole spec load (3,200 x (2 + 0.05 x 30) = 11,200). A short result that points to its
  details saves more than any encoding. Anthropic's research system has subagents store their outputs and pass
  lightweight references back to the lead agent ([multi-agent research system][ma]); for brevity, that idea is
  [issue #20](https://github.com/nsalloums/brevity/issues/20).

## Practical rules

1. **Keep always-loaded context small.** Every token of it is paid on every call of every session that carries it.
   Claude Code's documentation gives the same advice for `CLAUDE.md`: move instructions for specific workflows into
   skills, which load only when used ([Manage costs][cc-costs]).
2. **Load on demand where use is rare.** A session that exchanges a handful of messages should not carry a protocol
   for its whole life. Loading at first use costs only a stub until then: 138 tokens for brevity's skill.
3. **Count per session.** A session that loads L tokens needs about 2 x L / s messages, each s tokens shorter,
   before it comes out ahead. Below that it loses tokens, however busy its hub is.
4. **Shorten what is written and what stays longest.** Output costs 5 times input, and a message that lands early
   in a long session is read on every later call. In a fan-out, the results that return to the orchestrator are
   the costliest text.
5. **Pass pinned references instead of pasting large outputs.** A commit SHA plus a path, or an immutable artifact
   id, stays exact. A link to something that can change does not.
6. **Mind the cache lifetime.** A session that sits idle past its cache lifetime writes its whole context again at
   its next call. In Claude Code, a message from another session starts a new turn in an idle session, and that turn
   sends the whole context ([Manage costs][cc-costs]). `--idle-misses` models it.
7. **Measure before and after.** Model your team with `tools/cost-model.mjs`, measure what loaded context actually
   cost and saved in your sessions with [tools/meter.mjs](../tools/meter.mjs), measure the saving on your own
   messages with `tools/measure.mjs` and `tools/idcheck.mjs` (see the README's
   [Measure it on your own traffic](../README.md#measure-it-on-your-own-traffic)), and compare real usage before and
   after a change: `/usage` in Claude Code, or the usage page of the Claude Console.

## Model your own team

List each session with the model calls it makes and the messages it exchanges with other sessions:

```json
[
  { "name": "coordinator", "turns": 1500, "sent": 60, "received": 52 },
  { "name": "api", "turns": 400, "sent": 30, "received": 34 },
  { "name": "worker", "turns": 40, "sent": 1, "received": 1, "first": 0 }
]
```

- `turns`: model calls. In Claude Code, `/usage` shows the request count of the main conversation on its
  «Prompt cache (main)» line ([Manage costs][cc-costs]).
- `sent`, `received`: messages to and from other sessions.
- `first`, optional: the call at which the session's first message arrives, such as 0 for a subagent that a
  delegation prompt starts.

```
node tools/cost-model.mjs sessions.json --saving 60
node tools/cost-model.mjs sessions.json --saving 60 --reader-tokens 300
node tools/cost-model.mjs sessions.json --messages messages.json --enc encodings.json
node tools/cost-model.mjs sessions.json --saving 60 --model claude-sonnet-5-5 --write 1.25 --skill-entry 143 --reinject 1
```

Without `--load-tokens`, the tool counts brevity's `SPEC.md` and the nearest `.brevity/` dictionaries. Without
`--model`, it prices cache reads for Claude Opus 5.5: name the model your sessions run, and add `--write 1.25` if
they use 5-minute caching. It prints the prices that ran and its assumptions with every result: check them against
how your team works. For a team that already runs, [tools/meter.mjs](../tools/meter.mjs) measures from its
transcripts what this model can only assume, and `--team-json` writes its sessions in this format. Keep real session
data and messages out of version control.

## Sources

Checked on 2026-09-30.

- [Pricing][pricing], Claude API documentation: model prices (output costs 5 times input on every model listed); the
  prompt-caching multipliers (1.25 for a 5-minute cache write, 2 for a 1-hour one, 0.1 for a cache read, with 0.05
  on Claude Opus 5.5 and 0.025 on Claude Fable 5.1 and Claude Mythos 5.1); and the note that newer models' tokenizer
  produces about 30% more tokens for the same text.
- [Prompt caching][caching], Claude API documentation: a cache entry lives 5 minutes by default, and each use
  refreshes it at no extra cost.
- [Manage costs effectively][cc-costs], Claude Code documentation: each request sends the whole conversation, which
  is re-read at the cached rate; the cache lifetime on each plan; skills load on demand; a message from another
  session starts a turn in an idle session; the «Prompt cache (main)» line of `/usage`; agent teams use about 7 times
  the tokens of a standard session in plan mode.
- [How we built our multi-agent research system][ma], Anthropic Engineering, 2025-06-13: multi-agent systems used
  about 15 times the tokens of chats; subagents store their outputs and pass lightweight references to the lead
  agent.
- [eval/RESULTS.md](../eval/RESULTS.md): the spec's size, the saving per message and the break-even, measured on 268
  messages.
- [Issue #11](https://github.com/nsalloums/brevity/issues/11) and [issue #40](https://github.com/nsalloums/brevity/issues/40):
  in this project's 1,088 measured Claude Code calls, all on Claude Opus 5.5, every cache write was a 1-hour write;
  the plugin's skill entry is 143 tokens (legacy count); the costs the defaults leave out came to about 70,000
  equivalents, against a measured spec cost of about 300,000.
- [tools/cost-model.mjs](../tools/cost-model.mjs): the formula, the loading policies and the assumptions it prints.

[pricing]: https://platform.claude.com/docs/en/about-claude/pricing
[caching]: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
[cc-costs]: https://code.claude.com/docs/en/costs
[ma]: https://www.anthropic.com/engineering/multi-agent-research-system
