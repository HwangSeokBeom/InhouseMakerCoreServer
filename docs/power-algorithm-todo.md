# Power Algorithm TODO

## Pending Data Improvements

1. Persist match-time rating snapshots per participant.
Current `expectedScore` uses each participant's latest stored role power as an approximation because pre-match MMR snapshots are not stored on `inhouse_match` or `inhouse_player_stats`.

2. Add explicit historical season rank ingestion.
Current `historicalRankScore` is derived from stored ranked snapshot history with recency decay. If we need true season-end rank history, store season summaries explicitly instead of inferring history from periodic sync snapshots.

3. Persist richer Riot lane raw metrics.
Current lane adjustment uses `matches`, `winRate`, `kda`, `visionScore`, and `laneInfluence`. Add CS diff, damage share, gold diff at 10, and objective participation if we want stronger lane-specific modeling without overloading KDA.

4. Add variance-oriented recent form metrics.
`FormScore` currently uses recent win rate, KDA, vision, kill participation, and sample confidence. If we want a better stability term, store per-game variance or streak/consistency metrics in the aggregated Riot snapshot.

5. Consider role-adjacency transfer rules only after snapshot support exists.
The current design intentionally disables cross-role MMR transfer to avoid inflating off-roles. If later needed, re-introduce a small transfer only with explicit role adjacency rules and match-time snapshots.
