# Auth Contract

## Official Endpoints

The current server contract officially supports these auth endpoints:

- `POST /auth/signup`
- `POST /auth/login/email`
- `POST /auth/login/apple`
- `POST /auth/login/google`
- `POST /auth/refresh`
- `POST /auth/logout`

`POST /auth/signup/email` is a legacy alias and must not be called by clients.

- The only official email signup route is `POST /auth/signup`.
- If a client still calls `POST /auth/signup/email`, the server returns `410 Gone`.
- The response body includes `code = "LEGACY_AUTH_ROUTE_DISABLED"` and `details.replacementPath = "/auth/signup"`.

## Request Contracts

### `POST /auth/signup`

Creates an email account and immediately returns access and refresh tokens.

```json
{
  "email": "new@example.com",
  "password": "Password1",
  "nickname": "Newbie",
  "agreedToTerms": true,
  "agreedToPrivacy": true,
  "agreedToMarketing": false
}
```

Notes:

- Required consent fields:
  - `agreedToTerms`
  - `agreedToPrivacy`
- Optional consent field:
  - `agreedToMarketing`
- If `agreedToMarketing` is omitted, the server treats it as `false` and stores no marketing opt-in timestamp.
- If a required consent field is missing or invalid, the server returns `400` with `code = "VALIDATION_ERROR"` and `details.validationErrors[].field` identifying the exact field.
- Consent timestamps are persisted on the `users` record.

### `POST /auth/login/apple`

Accepts only an Apple identity token. Authorization codes and other Apple signup payload fragments are not part of the server contract.

```json
{
  "identityToken": "APPLE_IDENTITY_TOKEN"
}
```

The token audience must match `APPLE_CLIENT_ID`.

### `POST /auth/login/google`

Google login is officially supported.

The request body must contain only the Google identity token. Authorization code exchange and other Google auth payload fragments are not part of this server contract.

```json
{
  "identityToken": "GOOGLE_IDENTITY_TOKEN"
}
```

Contract notes:

- Supported request field: `identityToken`
- Unsupported request fields: `authorizationCode`, `serverAuthCode`, `accessToken`, profile payload fragments
- The token audience must match `GOOGLE_CLIENT_ID`.
- The server boot contract requires `GOOGLE_CLIENT_ID`; missing this env value is a startup misconfiguration.

## Public Config Exposure

`GET /app-config/public` exposes `supportedAuthProviders`, currently:

```json
["email", "apple", "google"]
```

Clients should use `supportedAuthProviders` directly as the public capability list for feature availability checks. The current value means email signup/login, Apple login, and Google login are all officially available.

## Environment Requirements

Official auth env keys:

- `APPLE_CLIENT_ID`
- `GOOGLE_CLIENT_ID`
