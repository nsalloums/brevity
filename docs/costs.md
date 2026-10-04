# What multi-agent setups cost in tokens

This guide explains what shared context and messages cost when several coding-agent sessions work together, and
when a shared protocol such as brevity pays for itself. It applies to any context that every session carries: a
protocol spec, a dictionary, a long `CLAUDE.md`, tool definitions.

The stakes are large. Anthropic reports that its multi-agent research system used about 15 times the tokens of a
chat ([multi-agent research system][ma]), and Claude Code's documentation puts agent teams at about 7 times the
tokens of a standard session when teammates run in plan mode ([Manage costs][cc-costs]).

The numbers below come from [tools/cost-model.mjs](../tools/cost-model.mjs), on synthetic teams. Every price has a
source under [Sources](#sources), and every assumption is marked as one.

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

Prices were checked on 2026-09-30. The tool uses 5, 1.25 and 0.1 by default, and `--output`, `--write` and
`--read` change them.

| input | value | source |
|---|---|---|
| spec plus a small dictionary, loaded per session | 3,200 tokens | [eval/RESULTS.md](../eval/RESULTS.md#break-even): the spec is 2,674 tokens, and a small dictionary adds about 500 |
| tokens one message saves | 60 | [eval/RESULTS.md](../eval/RESULTS.md): 60.0 on average over 268 measured messages |
| stub | 138 tokens | the brevity skill's name and description, which a session carries so it can load brevity on demand; the default in `tools/cost-model.mjs` |

The worked examples below use the audited 60 tokens per message. A session that writes each message once saves
about 37 ([single writing pass](../eval/RESULTS.md#single-writing-pass-pilot-2026-10-04)), and at that saving a
200-call session needs 123 to 164 messages to break even, not 76 to 101
(`node tools/cost-model.mjs --saving 37 --load-tokens 3200 --turns 200`). At 37, no reader card keeps the hub team
in example 2 ahead, even one of 0 tokens.

### Assumptions

- **Assumption: plan limits weigh tokens as the API prices do.** On a Claude subscription, Claude Code usage draws
  on plan limits instead of a per-token bill, and long context counts against those limits at the cached rate
  ([Manage costs][cc-costs]). How plan limits weigh each kind of token is not published.
- **Assumption: the cache stays warm.** Loaded context is written once and read on every later call. A cache entry
  lives 5 minutes by default, and every read refreshes it ([Prompt caching][caching]). In Claude Code the lifetime is
  1 hour on a subscription, and 5 minutes on usage credits, an API key or a cloud provider ([Manage costs][cc-costs]).
  A session that sits idle for longer writes its whole context again at its next call, so a cold cache makes loaded
  context cost more than this model says.
- **Assumption: messages are spread evenly** over a session's calls, unless the sessions file says when the first
  one arrives.
- **Assumption: the token counts carry over to current models.** eval/RESULTS.md counts with Anthropic's legacy
  public tokenizer, and current models produce about 30% more tokens for the same text ([Pricing][pricing]). The spec
  and the saving grow together, so break-even counts move little, but the absolute numbers grow.
- **Assumption: every message saves 60 tokens.** Delegation prompts and subagent results are often longer than
  peer messages, and in eval/RESULTS.md long messages saved more (29.7%).

## The model in plain words

- **Loaded context is paid on every call, not once.** When a session loads something (a spec, a dictionary,
  `CLAUDE.md`), its first model call writes it to the prompt cache (1.25). Every later call reads it again (0.1),
  because each request sends the whole context ([Manage costs][cc-costs]). A 3,200-token spec in a session of 200
  calls costs 3,200 x (1.25 + 0.1 x 200) = 68,000 equivalents, and 94% of that is reads.
- **A message is paid three times.** Its writer pays for it as output (5). Its reader takes it in, as a cache write
  (1.25). Then both sessions carry it: each reads it again on every later call (0.1 per call, in each session).

So, for a session that loads L tokens and then makes T calls, and a message made s tokens shorter:

```
cost of the loaded context  = L x (1.25 + 0.1 x T)
saving of the shorter message = s x (5 + 1.25 + 0.1 x R_writer + 0.1 x R_reader)
```

R is the number of calls left in each session after the message. This is the formula in the header of
`tools/cost-model.mjs`. Like eval/RESULTS.md, it leaves out the writer's cache write of its own message.

Three things follow.

1. **A session needs about 2 x L / s messages to break even.** In a long session, reads dominate both sides: the
   loaded context is read on all T calls, and a message on about T/2 calls on average. With L = 3,200 and s = 60,
   that is about 107 messages, and fewer for a session that mostly writes, since output weighs 5:

   ```
   node tools/cost-model.mjs --saving 60 --load-tokens 3200 --turns 200
   ```

   ```
   break-even for a session with 200 calls that loads at its first call:
     76 messages if it sends them all, 101 if it receives them all, 87 half and half
   ```

   With `--turns 2000` the range is 103 to 107 messages.
2. **Cheaper cache reads change the answer little.** They cut the cost of loaded context and the saving on carried
   messages alike. With `--read 0.05`, Claude Opus 5.5's rate, the same session needs 60 to 96 messages.
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
brevity cost model, in input-token equivalents (output 5x, cache write 1.25x, cache read 0.1x an input token)
loaded per session: 3,200 tokens (--load-tokens)
saving per message: 60 tokens (--saving)

break-even for a session with 800 calls that loads at its first call:
  97 messages if it sends them all, 106 if it receives them all, 101 half and half

team: 2 sessions, 200 messages sent, 200 received
hub: a session with at least its own break-even in messages (--threshold N sets one count); 2 of 2
stub: the 138 tokens a session carries so it can load on its first message (the skill's name and description)
policy                                            sessions that load      saved     cost       net
always-on                                              2 from call 0  1,035,000  520,000  +515,000
hub-only                                               2 from call 0  1,034,999  520,000  +514,999
first-message                 2 from first message; 2 carry the stub  1,035,000  539,878  +495,122
hub+first      2 from call 0, 0 from first message; 0 carry the stub  1,035,000  520,000  +515,000
highest net: always-on (+515,000). A model, not a decision: check the assumptions below.

net per session (0 = no brevity):
session  calls  sent  received  break-even  hub  always-on  hub-only  first-message  hub+first
api        800   100       100         101  yes   +257,500  +257,499       +247,561   +257,500
web        800   100       100         101  yes   +257,500  +257,499       +247,561   +257,500
total                                             +515,000  +514,999       +495,122   +515,000
…
```

Each session exchanges 200 messages, almost twice its break-even of 101, so both come out ahead. Loading the spec
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
brevity cost model, in input-token equivalents (output 5x, cache write 1.25x, cache read 0.1x an input token)
loaded per session: 3,200 tokens (--load-tokens)
saving per message: 60 tokens (--saving)

break-even for a session with 150 calls that loads at its first call:
  70 messages if it sends them all, 100 if it receives them all, 82 half and half

team: 81 sessions, 268 messages sent, 268 received
hub: a session with at least its own break-even in messages (--threshold N sets one count); 1 of 81
stub: the 138 tokens a session carries so it can load on its first message (the skill's name and description)
reader card: 300 tokens (--reader-tokens), to read only: readers write in prose
policy                                                               sessions that load      saved       cost         net
always-on                                                                81 from call 0  1,829,100  4,804,000  -2,974,900
hub-only                                                                  1 from call 0          0    644,000    -644,000
first-message                                  81 from first message; 81 carry the stub  1,829,100  3,755,784  -1,926,684
hub+first                       1 from call 0, 80 from first message; 80 carry the stub  1,829,100  3,730,391  -1,901,291
hub+reader     1 from call 0, 80 readers from first received message; 80 carry the stub  1,078,320  1,070,702      +7,618
highest net: hub+reader (+7,618). A model, not a decision: check the assumptions below.
hub+reader stays above 0 with a reader card of up to 309 tokens.
hub-only saves nothing with one hub: a message saves only between two sessions that loaded the spec.

net per session (0 = no brevity):
session  calls  sent  received  break-even  hub   always-on  hub-only  first-message   hub+first  hub+reader
hub      2,000   158       110         104  yes  +1,019,650  -644,000       +994,257  +1,019,650    +351,400
peer-01    150     0         1         100          -51,475         0        -29,717     -29,717      -4,343
…
peer-31    150     1         1          82          -50,725         0        -36,967     -36,967      -4,343
…
peer-80    150     7         7          82          -43,075         0        -42,117     -42,117      -2,881
total                                            -2,974,900  -644,000     -1,926,684  -1,901,291      +7,618
…
```

- **Loading the spec in every session loses 2.97 million.** This is what opting the project in with a `.brevity/`
  folder does. The hub gains 1.02 million, but each peer loses 43,000 to 51,000: it carries the spec on each of its
  150 calls to save on 1 to 14 messages.
- **Loading on demand loses less, but still loses.** A peer that loads the spec at its first message carries it for
  the rest of its life.
- **Loading only in the hub saves nothing,** because the peers cannot read what the hub writes.
- **Only a read-only card comes out ahead.** In hub+reader, the hub loads the full spec and each peer loads a card
  that only decodes, at the first message it receives. With a 300-token card the team nets +7,618, and the largest
  card that keeps it ahead is 309 tokens. brevity has no reader card: this is a modeled result, and
  [issue #11](https://github.com/nsalloums/brevity/issues/11) tracks the design.

The largest card depends on the assumptions. Each row adds one option to the command above:

| option | what it assumes | largest card |
|---|---|---|
| none | the defaults above | 309 tokens |
| `--first start` | each peer's first message arrives at its first call | 218 tokens |
| `--reader-writes` | the card also lets peers write brevity | 1,107 tokens |
| `--stub 0` | peers carry no 138-token stub before the card | 526 tokens |
| `--read 0.05` | Claude Opus 5.5's cache-read price | 320 tokens |
| `--read 0.025` | Claude Fable 5.1's cache-read price | 337 tokens |
| `--write 2` | 1-hour cache writes | 284 tokens |

So a read-only card of about 220 to 310 tokens keeps this team ahead, and the price moves the answer by less than 30
tokens. The 300-token card above sits near that limit: if each peer's first message arrives at its first call, or
with 1-hour cache writes, it nets less than 0.

### 3. An orchestrator with fan-out subagents

[teams/fanout.json](teams/fanout.json): an orchestrator with 1,500 calls hands out 60 tasks. Each of the 60
subagents makes 30 calls, receives its delegation prompt at call 0 (`"first": 0`), and sends back one result.

```
node tools/cost-model.mjs docs/teams/fanout.json --saving 60 --load-tokens 3200 --reader-tokens 300
```

```
brevity cost model, in input-token equivalents (output 5x, cache write 1.25x, cache read 0.1x an input token)
loaded per session: 3,200 tokens (--load-tokens)
saving per message: 60 tokens (--saving)

break-even for a session with 30 calls that loads at its first call:
  35 messages if it sends them all, 83 if it receives them all, 50 half and half

team: 61 sessions, 120 messages sent, 120 received
hub: a session with at least its own break-even in messages (--threshold N sets one count); 1 of 61
stub: the 138 tokens a session carries so it can load on its first message (the skill's name and description)
reader card: 300 tokens (--reader-tokens), to read only: readers write in prose
policy                                                               sessions that load    saved       cost       net
always-on                                                                61 from call 0  601,200  1,300,000  -698,800
hub-only                                                                  1 from call 0        0    484,000  -484,000
first-message                                  61 from first message; 61 carry the stub  601,200  1,352,096  -750,896
hub+first                       1 from call 0, 60 from first message; 60 carry the stub  601,200  1,335,190  -733,990
hub+reader     1 from call 0, 60 readers from first received message; 60 carry the stub  300,593    595,690  -295,097
every policy costs more than it saves: not loading brevity (net 0) beats the best, hub+reader (-295,097).
no reader card makes hub+reader positive: even a card of 0 tokens nets -218,597.
hub-only saves nothing with one hub: a message saves only between two sessions that loaded the spec.

net per session (0 = no brevity):
session       calls  sent  received  break-even  hub  always-on  hub-only  first-message  hub+first  hub+reader
orchestrator  1,500    60        60         104  yes    +78,500  -484,000        +61,594    +78,500    -196,000
sub-01           30     1         1          50         -12,955         0        -13,541    -13,541      -1,652
…
total                                                  -698,800  -484,000       -750,896   -733,990    -295,097
…
```

- **The orchestrator comes out ahead, and the team does not.** The orchestrator exchanges 120 messages, above its
  break-even of 104, and gains 78,500. Each subagent loses 12,955, since it carries the spec for 30 calls to save on
  2 messages, and 60 of them sink the team.
- **A read-only card cannot fix this shape,** even at 0 tokens: half of the traffic is results that the subagents
  write, and a card that only decodes leaves those in prose. A card that also lets them write keeps the team ahead
  up to 321 tokens:

  ```
  node tools/cost-model.mjs docs/teams/fanout.json --saving 60 --load-tokens 3200 --reader-tokens 300 --reader-writes
  ```

  ```
  …
  hub+reader     1 from call 0, 60 readers from first message; 60 carry the stub  601,200    595,690    +5,510
  highest net: hub+reader (+5,510). A model, not a decision: check the assumptions below.
  hub+reader stays above 0 with a reader card of up to 321 tokens.
  …
  ```

- **The bigger lever here is the size of what comes back.** A result stays in the orchestrator's context for the
  rest of its calls. With the prices above, a 1,000-token result that arrives halfway through costs
  1,000 x (1.25 + 0.1 x 750) = 76,250 equivalents: 15 times what the subagent paid to write it (5,000), and more than
  5 times a subagent's whole spec load (3,200 x (1.25 + 0.1 x 30) = 13,600). A short result that points to its
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
   sends the whole context ([Manage costs][cc-costs]).
7. **Measure before and after.** Model your team with `tools/cost-model.mjs`, measure the saving on your own
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
```

Without `--load-tokens`, the tool counts brevity's `SPEC.md` and the nearest `.brevity/` dictionaries. It prints its
assumptions with every result: check them against how your team works. Keep real session data and messages out of
version control.

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
- [tools/cost-model.mjs](../tools/cost-model.mjs): the formula, the loading policies and the assumptions it prints.

[pricing]: https://platform.claude.com/docs/en/about-claude/pricing
[caching]: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
[cc-costs]: https://code.claude.com/docs/en/costs
[ma]: https://www.anthropic.com/engineering/multi-agent-research-system
