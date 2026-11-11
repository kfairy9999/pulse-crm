import { DomainError } from "./shared.js";
import { handleCrm } from "./crm.js";
import { handleAuth } from "./auth/worker.js";
import { authPepper } from "./auth/password.js";
import { checkMigrated } from "./d1.js";
import { bundledAssets } from "./generated/asset-map.js";
import { fetchAsset, publicAsset } from "./static-assets.js";
import {
  getSession,
  validCsrf,
  readJson,
  needJson,
  sameOrigin,
  validateOrigin,
  secureResponse,
  json,
} from "./auth/http.js";
function errorResponse(error, api, path) {
  const conflict =
    /UNIQUE constraint failed|FOREIGN KEY constraint failed/i.test(
      String(error.message),
    );
  const status = error.status || (conflict ? 409 : 500);
  // Never send internal SQL, stack traces, credentials, key configuration, or URLs to clients.
  if (status >= 500)
    console.error(
      JSON.stringify({
        event: "pulse-request-error",
        path,
        kind: error.constructor?.name || "Error",
        code: error.code || undefined,
      }),
    );
  return json(
    {
      error:
        status === 503 && error instanceof DomainError
          ? error.message
          : status >= 500
            ? "The service could not complete this request. Please try again."
            : error instanceof DomainError
              ? error.message
              : status === 409
                ? "This change conflicts with another record. Please refresh and retry."
                : "The request could not be completed.",
      ...(error.fields ? { fields: error.fields } : {}),
    },
    status,
  );
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url),
      path = url.pathname;
    let api = path.startsWith("/api/");
    try {
      if (!["GET", "HEAD", "POST", "PATCH", "DELETE"].includes(request.method))
        return secureResponse(
          errorResponse(new DomainError("Method not allowed.", 405), api, path),
          api,
          request,
        );
      if (!validateOrigin(request, env))
        throw new DomainError(
          "Configure an exact HTTPS APP_ORIGIN for this Worker; development must stay on loopback HTTP.",
          503,
        );
      if (!env.DB)
        throw new DomainError(
          "D1 is not bound to this Worker. Apply the documented migration and database configuration.",
          503,
        );
      // Use an explicit primary-first D1 session to avoid replica-stale read→write decisions.
      const scoped = { ...env, DB: env.DB.withSession("first-primary") };
      await checkMigrated(scoped.DB);
      try {
        authPepper(env);
      } catch {
        throw new DomainError(
          "Configure the managed AUTH_PEPPER secret and AUTH_PEPPER_ID before using this Worker.",
          503,
        );
      }
      if (api) {
        if (path === "/api/health")
          return secureResponse(
            json({ status: "ok", service: "Pulse CRM", version: 1 }),
            true,
            request,
          );
        if (request.method !== "GET" && request.method !== "HEAD") {
          if (!sameOrigin(request))
            throw new DomainError("Request origin is not allowed.", 403);
          needJson(request);
        }
        const canHaveJsonBody = (request.headers.get("Content-Type") || "")
          .toLowerCase()
          .startsWith("application/json");
        const body =
          ["POST", "PATCH", "DELETE"].includes(request.method) &&
          canHaveJsonBody
            ? await readJson(
                request,
                path.startsWith("/api/auth/") ? 8 * 1024 : 200 * 1024,
              )
            : null;
        if (path.startsWith("/api/auth/"))
          return secureResponse(
            await handleAuth(request, scoped, {
              method: request.method,
              path,
              body,
            }),
            true,
            request,
          );
        const session = await getSession(scoped.DB, request);
        if (!session) throw new DomainError("Please sign in to continue.", 401);
        if (
          request.method !== "GET" &&
          request.method !== "HEAD" &&
          !(await validCsrf(session, request))
        )
          throw new DomainError(
            "Your security token is invalid. Please refresh and try again.",
            403,
          );
        return secureResponse(
          await handleCrm(request, scoped, {
            method: request.method,
            path,
            body,
            url,
          }),
          true,
          request,
        );
      }
      if (publicAsset(path))
        return secureResponse(
          await fetchAsset(request, env, path, bundledAssets),
          false,
          request,
        );
      // HTML and any unknown resource never become a public unauthenticated SPA fallback.
      if (request.method !== "GET" && request.method !== "HEAD")
        throw new DomainError("API route not found.", 404);
      // The public demo shell: the same client code, but every API call is answered in the
      // browser by src/client/demo with fictional data. It never reads the session or the DB.
      if (path === "/demo") {
        const demo = await fetchAsset(request, env, "/index.html", bundledAssets, "GET");
        if (!demo.ok)
          throw new DomainError("Build the React client with npm run build before serving the Worker.", 503);
        return secureResponse(demo, false, request);
      }
      const session = await getSession(scoped.DB, request);
      if (path === "/signin" && session)
        return secureResponse(
          Response.redirect(new URL("/", request.url), 302),
          false,
          request,
        );
      if ((path === "/" || path === "/index.html") && !session)
        return secureResponse(
          Response.redirect(new URL("/signin", request.url), 302),
          false,
          request,
        );
      if (path === "/signin" || path === "/" || path === "/index.html") {
        // Public sign-in shell contains only application code; all customer data stays behind the API session gate.
        const asset = await fetchAsset(
          request,
          env,
          "/index.html",
          bundledAssets,
          "GET",
        );
        if (!asset.ok)
          throw new DomainError(
            "Build the React client with npm run build before serving the Worker.",
            503,
          );
        return secureResponse(asset, false, request);
      }
      return secureResponse(
        json({ error: "Resource not found." }, 404),
        false,
        request,
      );
    } catch (error) {
      return secureResponse(errorResponse(error, api, path), api, request);
    }
  },
};
