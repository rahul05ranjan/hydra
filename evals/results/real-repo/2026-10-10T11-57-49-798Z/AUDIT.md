# Trace audit

The gold in `plan.json` comes from Python and TypeScript parsers. The final agent answer is graded separately from the intermediate Hydra evidence. A correct final answer can require native fallback.

## Read boundaries

The saved forced-arm traces show the same Hydra symbol ranges in all three repeats. The extracted observations are saved in [read_boundaries.json](read_boundaries.json):

| Task | Parser gold | Hydra range | Observation |
|---|---|---|---|
| `cast_value` | 57–86 (30 lines) | 57–183 (127 lines) | Includes unrelated source after the function. |
| `_join` | 369–416 (48 lines) | 369–389 (21 lines) | Omits the remaining body, nested function and final return. |
| `checkConfiguration` | 126–191 (66 lines) | 126–191 (66 lines) | Exact boundaries. |
| `ingestCommittedRange` | 273–336 (64 lines) | 272–336 (65 lines) | Includes one leading comment, which the agent removes for this task. |

For `_join`, repeat 0 combines the Hydra read with a native `sed` read in the same Bash call. Repeat 1 combines it with a native `grep`, then uses two native `Read` calls for the missing body. Repeat 2 combines it with a native `sed` pipeline and then two native `Read` calls. Those native reads remain in the session usage totals. Successful Hydra command execution does not prove complete evidence.

The frozen `hydra-skill/scripts/lib/read.mjs` tries brace boundaries before Python indentation. It scans up to 200 lines looking for braces. Python dictionary braces can therefore terminate a slice within a function or in a later function. Indentation is used only when no brace was seen. This explains the two Python ranges above; the runtime stayed frozen during the trial.

## Interpretation

The `available` arm has the Hydra skill registered at startup. It chose Hydra in 0/12 sessions; the forced arm used Hydra in 12/12. Native choices in the available arm are meaningful adoption observations because skill discovery passed.

All 36 final answers matched parser gold. Offline analysis replayed every saved trace to verify the answers and usage totals. A separate post-run audit checked all 36 workspace source hashes and installed skill hashes; all matched the preparation. No permission denials, tool errors, exact repeated tool attempts, source edits or model changes were recorded. All 12 matched task/repeat blocks were eligible for comparison.

Native tools used 387,115 total reported tokens; availability used 391,296 (+1.08%), and forced delegation used 667,303 (+72.38%). All four tasks increased usage under forced delegation. The exploratory cluster interval for that increase is 45.58% to 103.88%, with only four distinct task clusters. Reported cost equivalent was $2.7095252 in 513.896 seconds; this is not a Pro bill or allowance measure.

The `forced` arm adds a skill invocation and CLI operations before producing the answer. Its token totals include skill loading, extra turns, irrelevant source and any fallback. Compare complete final answers using the predeclared matching rules in `SUMMARY.md`; do not interpret smaller intermediate snippets as frontier-token savings.

Next work should address Python function boundaries with separate regression fixtures, then reduce the cost of the delegation interface. This run is four source-extraction tasks and does not establish performance across full coding workflows or Claude Pro allowance consumption.
