function createMaintenanceHandler(runMaintenance) {
  return async (request, response) => {
    if (request.method !== "POST") {
      response.set("Allow", "POST").status(405).send("Method Not Allowed");
      return;
    }
    if (request.body != null && request.body !== "" &&
        !(Buffer.isBuffer(request.body) && request.body.length === 0)) {
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

module.exports = { createMaintenanceHandler };
