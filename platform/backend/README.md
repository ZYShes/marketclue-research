# MarketClue backend

Python 3.12 Lambda entry point: `app.handler.lambda_handler`. HTTP requests use
Lambda Function URL payload v2.0. Worker events have the shape
`{"worker": "run", "run_id": "..."}`.

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
systemd-run --user --scope -q -p MemoryMax=4G -p MemorySwapMax=0 \
  .venv/bin/python -m pytest tests -q
```

Tests use moto, local RSA keys and patched Lambda invocation. Socket connections
are blocked. The production Lambda runtime supplies boto3; development installs
it through `requirements-dev.txt`.

Configuration follows `../SPEC.md`. `get_settings()` caches environment values;
its `session_secret` and `anthropic_api_key` properties decrypt and cache their
SSM SecureString independently on first access. AWS clients are created lazily.

## Pipeline integration

- `app/intake.py`, `app/pipeline.py` and `app/claude.py` are minimal placeholders
  for the pipeline engineer. No Claude calls are implemented.
- `intake.chat(conv, message)` receives the existing history without the current
  message. Return `reply`, `ready` and `brief`; the router appends the user and
  assistant messages and persists the conversation. The 30-message cap includes
  both roles, allowing 15 complete exchanges.
- Run creation writes `queued` META and index rows before asynchronous invocation.
  The router reserves quota transactionally; `store.create_run` does not charge
  quota. Scheduling failures mark the run failed and release both counters.
  Owner emails bypass personal quotas and still obey the global daily cap.
- The worker receives only `run_id`. Load the META via `store.get_run`, write
  stage/status/agents/cost through `store.update_run`, and store the document
  using `store.save_result`. Guard duplicate worker deliveries in the pipeline.
- Store methods return business dictionaries with explicit IDs, without PK/SK
  or Decimal values. `update_run` mirrors status/title/cost to the user's index.
  Snapshot keys hash the original URL; card dedupe uses the normalized URL/quote.

The specified UUID card keys and table schema have no unique dedupe index.
Sequential inserts dedupe; simultaneous first inserts from different containers
can create duplicate cards. Conversation quotas and history writes are also
read-time checks without per-conversation locking. These follow the single-user
prototype scope; run quotas use atomic DynamoDB transactions.
