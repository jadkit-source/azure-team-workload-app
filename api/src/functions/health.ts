import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

export async function health(
    request: HttpRequest,
    context: InvocationContext
): Promise<HttpResponseInit> {
    return {
        status: 200,
        jsonBody: {
            status: "ok",
            service: "team-workload-api",
            timestamp: new Date().toISOString()
        }
    };
}

app.http("health", {
    methods: ["GET"],
    authLevel: "anonymous",
    handler: health
});
