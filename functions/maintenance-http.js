function maintenanceInvoker(environment = process.env) {
  const email = environment.APPLICATION_MAINTENANCE_INVOKER_EMAIL;
  if (!email) return "private";
  if (!/^mamameals-scheduler-invoker@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(email)) {
    throw new Error("Invalid maintenance invoker service account.");
  }
  return email;
}

function createMaintenanceHandler(runMaintenance) {
  return async (request, response) => {
    if (request.method !== "POST") {
      response.set("Allow", "POST").status(405).send("Method Not Allowed");
      return;
    }
    const hasBody = Buffer.isBuffer(request.rawBody)
      ? request.rawBody.length > 0
      : request.body != null && request.body !== "" &&
        !(Buffer.isBuffer(request.body) && request.body.length === 0) &&
        !(typeof request.body === "object" && !Buffer.isBuffer(request.body) &&
          Object.getPrototypeOf(request.body) === Object.prototype &&
          Object.keys(request.body).length === 0);
    if (hasBody) {
      response.status(400).send("Maintenance requests must have no body.");
      return;
    }
    try {
      await runMaintenance();
      response.status(204).send();
    } catch (error) {
      // The endpoint is IAM-private. Keep record details out of HTTP responses.
      response.status(500).send("Maintenance failed; inspect structured server logs.");
    }
  };
}

module.exports = { createMaintenanceHandler, maintenanceInvoker };
