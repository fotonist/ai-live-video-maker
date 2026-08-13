# Workers

Long-running asynchronous jobs belong here.

Generation is not a synchronous HTTP request. A project should move through explicit states such as:

`draft → analyzing → planned → generating → assembling → completed`

Failures must be persisted and observable so the frontend can recover and report them.
