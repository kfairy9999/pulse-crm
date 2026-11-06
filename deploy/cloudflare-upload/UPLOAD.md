# Pulse CRM bundled Worker upload

Upload this directory through the sanctioned Cloudflare connector. Do not deploy with Wrangler, do not log in with the CLI, and do not call the Workers Assets upload session. That session returns a JWT that must be sent as `Authorization`, and `cloudflare.request` cannot set that header.

The package is one Worker module. `worker.js` already contains the sign-in shell and the exact hashed `/assets/` allowlist (3 files). No separate asset parts are required.

## Before the upload

1. Confirm the connector `accountId` is `f0d8472cc77b71cb083b6b9824e909c3`. If it is not, stop.
2. `GET /accounts/f0d8472cc77b71cb083b6b9824e909c3/workers/scripts/pulse-crm/settings`.
3. Stop if the D1 binding is not `7b391a6a-415e-4ad9-ae5d-eeaff7b3ded3`, or if `APP_ORIGIN`, `SESSION_TTL_DAYS`, or `AUTH_PEPPER_ID` differ from `metadata.json`. Do not create another Worker or D1 database.
4. `GET /accounts/f0d8472cc77b71cb083b6b9824e909c3/workers/scripts/pulse-crm/secrets` and remember the names. This package does not contain secret values. `keep_bindings` preserves `secret_text` and `secret_key` bindings already stored on the script.
5. Confirm `GET /accounts/f0d8472cc77b71cb083b6b9824e909c3/workers/scripts/pulse-crm/subdomain` is `enabled: true` and `previews_enabled: false`. Do not change that setting in this upload.

## Connector request

Read `metadata.json` and `worker.js` from this directory. Put the worker bytes in a Blob; do not paste the source into a template literal (`worker.js` contains quotes and `${`). Base64 is safe if the connector function cannot read the file.

```javascript
async () => {
  const metadata = /* parsed metadata.json */;
  const code = /* Uint8Array or string bytes of worker.js */;
  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" }),
  );
  form.append(
    "worker.js",
    new Blob([code], { type: "application/javascript+module" }),
    "worker.js",
  );
  return cloudflare.request({
    method: "PUT",
    path: `/accounts/${accountId}/workers/scripts/pulse-crm`,
    body: form,
  });
}
```

Do not set `contentType` on the connector request. Do not add an `Authorization` header, an `assets` binding, an assets JWT, `keep_assets`, a secret value, or any paid binding (KV, R2, Durable Objects, Queues, Workflows, AI).

`usage_model` stays `standard`. That is the existing Free-plan model. Do not set `limits.cpu_ms` and do not change the account plan.

## After the upload

Read the settings and secret names again. The D1 id and plain-text vars must be unchanged, and every secret name from step 4 must still be present. This upload does not create `AUTH_PEPPER` or `SETUP_TOKEN`. Until the provider stores `AUTH_PEPPER`, the Worker correctly returns 503 and does not serve the application. The user generates those secrets outside this package; do not invent them.

SHA-256: worker.js `c396e1b84e98c001ed72cad077864b90126f8d422f640f3e1d15321a8cf590e6`, metadata.json `c9df1ef8f987c0ed071cbf96487c43ddde3aa0235204ed771e92d3e8b686f497`. Uncompressed worker `434870` bytes (gzip `122715`). The Free Worker size limit is 64 MiB uncompressed.
