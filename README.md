# ATG × SAM · Solace replay

A static GitHub Pages viewer for a recorded 10-round V85 backtest. Its topic stream contains archived model picks and their historical settlement. Playback makes no model calls, publishes no messages and places no bets. The separate local demo sends the original replay through Solace PubSub+ over MQTT.

**Vinnare** is a separate five-minute replay of ten single-race picks settled against the official ATG win pool. It includes the ten configured LiteLLM routes, two panels, and the market favourite. The viewer features Orchestrator3 and the leading solo model, including tied scores.

Run `python3 -m http.server 8000` from this folder to preview it. The site has no build step or runtime service.

The bundled replay uses runner letters in the event stream and displays real historical decisions and performance. **Ticket breakdown** shows each forecaster’s official program numbers, the row-count calculation, winning combinations, and the official prize per row after settlement. The public export omits horse and driver names, dates, tracks, and market snapshots. **Replay details** contains links to the studies and **Open event log**, which reads internal JSONL files in the browser without uploading or storing them.

The GPT-6 Astra council routes to one available GPT, Gemini and Claude forecast using results from earlier rounds only. Astra weights the selected forecasts and public markets for each leg. A common ticket builder applies the budget. The market-only control uses the same engine and builder with only the two market signals.

The **Prompt study** page compares basic and selective-value prompting in a separate matched backtest. Only aggregate model performance and the prompt change are published.

**Skill and chance** reports the 55-round official archive, including 32 walk-forward evaluations of a market-anchored Orchestrator3, voluntary passes, and randomized tickets matched on stake and shape.

**Ticket builders** compares the original coverage builder, a payout-aware builder at exactly the same stake, and a selective policy on a separate 15-round holdout. The Pages deployment contains aggregate performance only.


Enable **Show topics** to display the demo's proposed ATG-style topic addresses. The roots follow Solace’s domain, object, action, and version pattern. Race cards and official results use the racing namespace, pool settlement uses betting, and simulated model proposals and standings use analytics. These names do not describe a verified ATG production catalog.

The chart and standings count all ten rounds, including the original penalties for invalid tickets. The participant list below the replay is available before playback, and scores appear as weeks settle. **Orchestrator3**, the Claude Opus 5.5 panel, appears first with its recorded ROI rank. The viewer omits the Harry Boy-style sampler and the two public-market forecasts.

**Agent notes** follow the ticket events. Choose a note to load that participant’s ticket. Recorded explanations use program numbers in place of runner names. For entries without a recorded explanation, the panel labels the ticket or strategy summary separately.

Hover or tap on a line to highlight it and see every participant’s net return for that week. Use the arrow keys to change weeks when the chart is focused.
