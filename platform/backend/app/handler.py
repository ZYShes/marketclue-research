from . import pipeline, router


def lambda_handler(event, context):
    if event.get("worker") == "run":
        return pipeline.run(event["run_id"])
    return router.route(event)
