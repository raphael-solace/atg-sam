# ATG × SAM · Solace replay

A static GitHub Pages viewer for a recorded 10-round V85 backtest. Its topic stream contains archived model picks and their historical settlement. Playback makes no model calls, publishes no messages and places no bets. The separate local demo sends the original replay through Solace PubSub+ over MQTT.

Run `python3 -m http.server 8000` from this folder to preview it. The site has no build step or runtime service.

The bundled replay uses anonymized options and displays real historical decisions and performance. The public export omits horse and driver names, dates, tracks, original program numbers, market snapshots, and official payout amounts. **Open event log** accepts the full internal JSONL file and reads it only within the current browser, without uploading or storing it.

The GPT-6 Astra council routes to one available GPT, Gemini and Claude forecast using results from earlier rounds only. Astra weights the selected forecasts and public markets for each leg. A common ticket builder applies the budget. The market-only control uses the same engine and builder with only the two market signals.

The **Prompt study** page compares basic and selective-value prompting in a separate matched backtest. Only aggregate model performance and the prompt change are published.

**Ticket builders** compares the original coverage builder, a payout-aware builder at exactly the same stake, and a selective policy on a separate 15-round holdout. The Pages deployment contains aggregate performance only.


The replay displays the demo's proposed ATG-style topic addresses. The roots follow Solace’s domain, object, action, and version pattern. Race cards and official results use the racing namespace, pool settlement uses betting, and simulated model proposals and standings use analytics. These names do not describe a verified ATG production catalog.

**Orchestrator3** is the Claude Opus 5.5 panel. Its head-to-head comparison with GPT-6 Luna includes rounds where both submitted valid tickets. The full leaderboard retains all ten rounds and applies the original penalty for each invalid ticket.

The chart and standings include every benchmarked entry on the ten-week timeline. All scores use the same weeks where Orchestrator3 and GPT-6 Luna both submitted valid tickets. Dashed segments indicate excluded weeks. Forecast-only entries have log loss but no net return or ROI. The archived event log retains the full ten-round results and penalties.
