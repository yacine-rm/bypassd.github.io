---
title: Do You Trust Smart Things?
date: 2026-06-20 18:00:00 +0100
categories: [Security, IoT]
tags: [iot, smart-lock, writeup, account-takeover, idor, authentication, mobile-security]
description: A review of a smart-lock cloud turned into a chain of authorization bypasses, weak authentication decisions, and one very familiar lesson about trust.
media_subpath: /assets/images/smart-things
image:
  path: photo_2026-11-18_16-13-34.jpg
pin: false
toc: true
comments: true
math: false
mermaid: false
---

> Everything here was reported before publication. Hosts, accounts, keys, tokens and user data are redacted. Some request details are intentionally incomplete because the same implementation may exist on other deployments.
{: .prompt-warning }

Smart devices ask for a kind of trust ordinary software never gets.

You install an app, scan a code, and hand it control of a smart lock. The useful part is not the motor or the fingerprint reader. It is the moment you stop thinking about the lock.

That makes connected devices interesting to test, but not because every device hides a new class of exploit. Usually it is the opposite. The bugs are ordinary web and mobile mistakes with unusually direct consequences. A missing object check can approve another person's PIN. A known default password can expose every smart lock managed by that deployment.

## One of those devices

The target was a smart-lock platform. Its cloud controlled locks, users, groups, access requests, applications, billing, tenants and the administrators who managed them.

The smart lock itself was only the visible edge. Behind it was a control plane where a database row mapped to a person and a permission mapped to a lock.

## Why this one

I chose the target because I wanted to work on a system that interacts directly with people.

On a normal SaaS application, broken authorization means records leak or change. On a lock platform, the same mistake can grant physical access, revoke somebody else's key, move a lock into another group or reject an access request without the owner knowing. The data matters, but the physical action is what makes the impact easy to understand.

## What was in scope

The review covered the customer portal, the vendor portal, the enterprise API, the Android application and the mobile API. Later it expanded to administrative deployments discovered through endpoint names, JavaScript bundles and shared backend behaviour. The lock radio protocol and firmware internals were outside the work.

## The first clue was in the client

The investigation did not begin with an admin endpoint. It began with the JavaScript delivered to every visitor.

API traffic looked opaque because the front end encrypted request and response bodies before sending them:

```javascript
const key = CryptoJS.enc.Utf8.parse("[REDACTED_KEY]");

const body = CryptoJS.AES.encrypt(JSON.stringify(payload), key, {
  mode: CryptoJS.mode.ECB,
  padding: CryptoJS.pad.Pkcs7
}).ciphertext.toString();
```

The key was in the same bundle as the encryption routine. AES-ECB also has no IV and no integrity protection, so the format provided neither confidentiality nor tamper resistance. Anyone with the page could decrypt a response, edit a request and encrypt it again.

That changed the next step. Instead of treating every API body as an encrypted blob, I could map routes, compare responses and build requests with ordinary JSON underneath.

The Android application repeated the mistake. It carried another static AES key and a reusable OAuth client credential:

```java
public static final String key()  { return "[REDACTED_KEY]"; }
public static final String mode() { return "AES/ECB/PKCS5Padding"; }
public static final String auth() { return "Basic [REDACTED_BASE64]"; }
```

## Recovery became the first account-takeover chain

With the API readable, the password-reset flow was the obvious place to start.

```http
PUT /api/v1/user/forgotPassword HTTP/2
Host: mainapi.[target].com
Content-Type: application/json;charset=UTF-8

{
  "mail": "<address>",
  "newPassword": "<new-password>",
  "verifyCode": "<four-digit-code>"
}
```

The request produced two useful observations. A registered address and an unknown address returned different decrypted messages, so the endpoint enumerated accounts. The generated code was only four digits.

Small, bounded attempts showed no lockout, delay or CAPTCHA. The first finding did not need a large sweep to establish the design problem: the recovery secret had 10,000 possible values and the server was not counting failures.

The email and phone variants shared the pattern:

```text
PUT /api/v1/user/resetPassword
PUT /api/v1/user/resetPasswordByPhone
GET /api/v1/users/getVerifyCode?mail=<address>&type=1
PUT /api/v1/users/resetPassword
```

The chain was enough to reset an administrative account (whose email address I obtained through OSINT) and log in to a vendor-facing portal. The same shared API also exposed an executive account, which turned a weak reset endpoint into organizational compromise.

That prompted a follow-up after the first patch. The server now invalidated a code after three failures, but the resend endpoint reset the challenge without counting how many codes had been issued. The patch reduced guesses per code; it did not reduce the number of codes an attacker could request.

Another deployment had a velocity limiter instead of an attempt budget. A burst was blocked, but spaced requests were not. A limiter that only measures requests per second does not protect a four-digit secret.

## One account exposed the authorization model

With a valid user session, the next question was whether the server checked who owned the object behind an identifier.

The first reads were direct:

```http
GET /api/v1/application/queryApplicationById/{id} HTTP/2
Host: mainapi.[target].com
Authorization: Bearer <session-token>
```

```http
GET /api/v3/tempAuthRequest/getTempAuthRequestById/{id} HTTP/2
Host: mainapi.[target].com
Authorization: Bearer <session-token>
```

Changing the numeric identifier returned another organization's application or temporary access request. Decrypted responses included names, email addresses, phone numbers, attachments, GPS coordinates, MAC addresses, firmware versions and facility information.

The read-only reports established that object authorization was missing. The follow-up question was whether the same identifier was trusted for writes.

It was.

```text
PUT    /api/v1/group/updateGroup
DELETE /api/v1/group/deleteGroup/{id}
DELETE /api/v1/substation/deleteSubstation/{id}
PUT    /api/v1/application/rejectApplication
PUT    /api/v1/application/declineApplication
PUT    /api/v1/vendorUser/auditVendorUser
PUT    /api/v1/user/updateUserInfo
POST   /api/v1/auth/multiAuth
PUT    /api/v3/tempAuthRequest/auditTempAuthRequest
PUT    /api/v3/lock/updateLockGroup
PUT    /api/v1/user/updateUserTagRel
PUT    /api/v3/user/updateUserNotVerifiedMail
PUT    /api/v3/user/updateUserVerifiedMail
```

Each route required a session, but the session did not need to own the target. Group and substation identifiers could be changed to affect another tenant. Applications could be rejected with a supplied reason. Invitation approvals could be bypassed. A temporary access request could be approved for a lock belonging to another organization:

```http
PUT /api/v3/tempAuthRequest/auditTempAuthRequest HTTP/2
Authorization: Bearer <session-token>
Content-Type: application/json;charset=UTF-8

{
  "approved": true,
  "ids": [<request-id>]
}
```

The most direct physical impact came from lock permissions and contact changes. `multiAuth` accepted a `userId` and a `lockId` from the request, so a session could grant or revoke access between accounts and locks. The verified-contact endpoints accepted a target user, a new address or phone number, and an OTP delivered to the attacker-controlled value:

```http
PUT /api/v3/user/updateUserVerifiedMail HTTP/2
Authorization: Bearer <session-token>
Content-Type: application/json;charset=UTF-8

{
  "id": "<target-user>",
  "newMail": "<controlled-address>",
  "newMailVCode": "<otp>"
}
```

Changing the contact information changed the recovery path. The attacker could receive the next reset code and take over the account without knowing its password. The findings treated this as object authorization for both the target user and the destination OTP, not as a harmless profile edit.

Not every finding required a destructive proof. The cross-tenant user update was tested with `force` left false, specifically to show that another user identifier was accepted without changing the other account. That is a useful pattern in authorized testing: prove control of the vulnerable branch while avoiding an unnecessary customer-side effect.

The findings kept producing the same root cause under different names: the server took the object identifier from the client and treated possession of a session as ownership of everything.

## Following shared controllers to the admin plane

The authenticated API was interesting, but it was still tenant-scoped in theory. Several endpoint names and client bundles suggested that the same backend served an administrative UI on another deployment.

Following those routes led to an admin panel with public login, no registration and an authentication filter in front of `/api/v1/*`.

The protected form returned the expected result:

```http
GET /api/v1/adminUser/queryAdminUserPageable?page=1&size=1 HTTP/2
Host: [admin-target]
Accept: application/json
```

```http
HTTP/2 401
```

The same controller was then requested with a semicolon in the first path segment:

```http
GET /api;/v1/adminUser/queryAdminUserPageable?page=1&size=1 HTTP/2
Host: [admin-target]
Accept: application/json
```

```http
HTTP/2 200
Content-Type: application/json
```

```json
{
  "code": 0,
  "data": {
    "list": [
      {
        "id": 1,
        "name": "[redacted]"
      }
    ],
    "totalCount": 8813
  }
}
```

The semicolon is a matrix parameter separator. One component matched the authorization rule against `/api;/v1/...`, while the downstream dispatcher resolved the request as `/api/v1/...`. Authentication and routing canonicalized the path differently.

This is commonly associated with path-based Spring Security rules running behind Tomcat. The important property is that the filter and the handler did not agree on the resource name.

A request to `/..;/api` produced a Tomcat `400` page. That confirmed path handling was involved, but it was not the useful bypass. The clean signal was the paired `401` and `200` on the same controller.

## The bypass also created administrators

The next request was the same interface with the path prefix changed:

```http
POST /api;/v1/adminUser/addAdminUser HTTP/2
Host: [admin-target]
Content-Type: application/json;charset=UTF-8

{
  "name": "Security Test",
  "mail": "<test-admin>",
  "roleId": "<role>"
}
```

There was no credential in the request. The bundle supplied the next one:

```javascript
notify("Create Success, The Initial Password is 123456");
```

```http
POST /api/v1/adminUser/login HTTP/2
Host: [admin-target]
Content-Type: application/json;charset=UTF-8

{
  "mail": "<test-admin>",
  "password": "123456"
}
```

That returned an administrator session. The account existed only to prove the unauthenticated creation flow end to end and was disclosed to the vendor for removal.

The panel exposed totals of users, locks, companies, and bills. I kept the queries small and did not export the underlying records. The totals were enough to establish scope: the same missing boundary covered identity, billing and physical inventory.

The placement of `123456` was also instructive. It was not necessarily a password hash in the client. It was a product decision: every newly created administrator was expected to know the same first password. A default that appears in a notification string and is accepted by the login endpoint turns provisioning into an authentication bypass.

## The second factor was a separate authentication path

The normal login endpoint returned an account identifier. The next request accepted that identifier and a six-digit TOTP:

```http
POST /api/v1/adminUser/loginWithAF HTTP/2
Host: [admin-target]
Content-Type: application/json;charset=UTF-8

{
  "id": 2,
  "totpCode": "<six-digit-code>"
}
```

There was no password, no opaque challenge and no server-side proof that the first request had succeeded. The only link between the two steps was the identifier supplied by the client.

Administrator identifiers were small integers. In bounded testing, repeated invalid codes caused no visible lockout, delay or `429`. 

That made two independent problems in one flow. The password step acted as an enumeration aid rather than a boundary, and the second step accepted an account identifier as if it were a login challenge.

The fix is not merely a rate limit on the current body. The first response should create a short-lived, single-use challenge:

```json
{
  "challenge": "<random-opaque-value>",
  "expiresAt": "<short-lived>"
}
```

The account identifier should live on the server against that challenge. `loginWithAF` should accept the challenge and the TOTP, never a client-selected `id`.

## The factor could be enrolled without a session

The same controller exposed a binding endpoint:

```http
POST /api/v1/adminUser/bindGoogleAuthTool HTTP/2
Host: [admin-target]
Content-Type: application/json;charset=UTF-8

{
  "id": 24,
  "secretKey": "<base32-secret>"
}
```

No administrator session was required. The error responses also leaked account state:

```text
400009  Data not found
400010  Google Authentication binding validation failed
code 0  binding accepted
```

The first state identified an unknown account, the second identified an existing account with a factor already enrolled, and the third reached an account that had no second factor. For a newly created administrator awaiting setup, possession of the account identifier was enough to attach a secret chosen by the attacker.

This was separate from the TOTP guessing issue. One finding was deterministic enrollment on an unprotected account; the other was probabilistic login against an enrolled account. Both existed because the second-factor flow did not bind the factor to an authenticated, password-verified user.

## The default appeared again on another deployment

Following the administrative subdomains produced a separate panel. There, an operator account still accepted `123456` and had no second factor.

The login was straightforward:

```http
POST /api/v1/adminUser/login HTTP/2
Host: [tenant-admin-target]
Content-Type: application/json;charset=UTF-8

{
  "mail": "<operator-account>",
  "password": "123456"
}
```

After login, luckily, the account didn’t have 2FA enabled, so I was able to link it myself.

Two more accounts on the same host also had default credentials; A later administrative deployment showed the same lifecycle problem in another form: an existing privileged account still accepted a default password, with 2FA acting as the only remaining barrier.

## What connected devices change about the review

The cloud findings are ordinary, but the object model makes them easier to prioritize. In an IoT platform, identifiers are not abstract rows. They describe people, locks, gateways, access requests and the relationships between them.

That produces a few recurring bug classes.

Client-side crypto is usually a boundary drawn in the wrong place. A static AES key in JavaScript or an APK protects the user from reading the network tab, not from understanding the protocol. TLS handles transport; server-side authorization handles access. AES-ECB with a shared key handles neither.

Account recovery is often weaker than the login page. Four-digit codes, indefinite expiry, unlimited attempts, resend loops and contact changes without re-verification turn recovery into a second authentication system with worse controls.

Object identifiers are frequently treated as ownership. The application checks that the request has a session, then trusts `userId`, `lockId`, `groupId` or `requestId` from the body. The authorization decision has to be made against the relationship in the database, not against the fact that the client knows a number.

Workflow endpoints deserve as much attention as direct reads. Approving an access request, auditing a vendor user, moving a lock between groups and changing a recovery address are all state transitions. A missing check in a read leaks data; the same check in a workflow can change physical access.

Path normalization is easy to overlook because most routes work exactly as intended. Test equivalent representations only where the scope permits it, and compare authorization decisions rather than treating every odd URL as a finding. In this case the useful signal was a direct `401` to `200` difference on the same controller.

Multi-factor authentication is not a property of having a TOTP screen. The factor must be bound to a password-verified challenge, the challenge must be single-use, and the account identity must come from the server. An endpoint that accepts an account ID plus six digits is a six-digit password.

Provisioning is the other recurring failure. Shared first passwords, accounts created without a credential, unauthenticated factor enrollment and deployments that reuse the same bootstrap credentials make new accounts less secure than old ones. A default password should be unique, forced to rotate and unable to survive the first login.

## After the findings

The most important lesson is not that one platform had several bad checks. It is how each mistake made the next one easier to find.

The JavaScript key exposed the request format. The reset flow produced a usable account. The authenticated account exposed object identifiers. The object checks led to tenant-wide writes and access changes. Endpoint names then exposed an administrative plane, where path normalization and a shared default password completed the chain.

None of those steps needed a clever exploit. They needed an application that treated the client as the source of truth at each boundary: the client knew the key, the client supplied the object ID, the client chose the administrator password, and the second-factor request trusted a client-selected account number.

That is the uncomfortable part of smart-device security. The lock may be physically strong, but its trust model is only as strong as the service that decides who is allowed to control it.

The smart lock was real. The key was taped to it.
