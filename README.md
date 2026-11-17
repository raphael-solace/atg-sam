# ATG × SAM · Solace replay

A static GitHub Pages viewer for a recorded 10-round V85 backtest. Its topic stream contains archived model picks and their historical settlement. Playback makes no model calls, publishes no messages and places no bets. The separate local demo sends the original replay through Solace PubSub+ over MQTT.

Run `python3 -m http.server 8000` from this folder to preview it. The site has no build step or runtime service.

The bundled replay uses anonymized options and displays real historical decisions and performance. The public export omits horse and driver names, dates, tracks, original program numbers, market snapshots, and official payout amounts. **Open event log** accepts the full internal JSONL file and reads it only within the current browser, without uploading or storing it.

The GPT-6 Astra council routes to one available GPT, Gemini and Claude forecast using results from earlier rounds only. Astra weights the selected forecasts and public markets for each leg. A common ticket builder applies the budget. The market-only control uses the same engine and builder with only the two market signals.
