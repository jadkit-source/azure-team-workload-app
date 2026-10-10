import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext
} from "@azure/functions";

import {
  getAuthenticatedActor,
  withAuthentication
} from "../shared/auth";

async function myAccess(
  request: HttpRequest,
  _context: InvocationContext
): Promise<HttpResponseInit> {
  const actor = getAuthenticatedActor(request);

  return {
    status: 200,
    jsonBody: {
      memberId: actor.id,
      isAdmin: actor.isAdmin,
      enabled: true
    }
  };
}

app.http("myAccess", {
  methods: ["GET"],
  route: "my-access",
  authLevel: "anonymous",
  handler: withAuthentication(myAccess)
});
