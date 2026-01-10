# Agent Identity Infrastructure

**Era: v2 (Future)**
**Status: Design / Research Complete**

> This documents the architecture for agent email and phone provisioning. Not planned for v1 - agents will use the escalation mechanism (WO-2026-051) when they hit verification walls.

## Overview

Agents running full-cycle projects (software, sales, design, business ops) will eventually need the ability to create email addresses and phone numbers programmatically. This enables agents to:

- Sign up for third-party services (newsletter platforms, hosting, APIs, payment processors)
- Receive verification codes and OTPs
- Communicate with customers, vendors, and partners
- Complete workflows that require identity verification

## v1 Approach (Current)

Agents escalate to the user when hitting identity/verification requirements. The mid-run escalation mechanism (WO-2026-051) handles this by pausing the run and requesting user input.

## v2 Approach (Future)

On-demand identity infrastructure provisioned when a project actually needs it:

| Resource | When Provisioned |
|----------|------------------|
| Domain | User registers one for the project, or agent requests one |
| Email | Project has a domain and needs to send/receive email |
| Phone | Agent needs customer/vendor contact (not just OTP) |

## Research Findings

### Email Options Evaluated

| Option | Pros | Cons |
|--------|------|------|
| Third-party APIs (MailSlurp, Zoho) | Easy setup | External dependency, per-mailbox costs |
| Full self-host (Mailcow, Docker-mailserver) | Full control | IP reputation hard on cloud VPSes |
| **Hybrid: Self-host receiving + relay sending** | Best balance | Slight complexity |

**Decision: Hybrid approach** - Self-host for receiving (works immediately, no reputation needed), relay through SendGrid/SES for sending (reliable deliverability).

### Phone Options Evaluated

| Option | Pros | Cons |
|--------|------|------|
| Twilio/Plivo | Reliable, dedicated numbers | ~$1/mo per number |
| Disposable services (Quackr, SmsPva) | Cheap | Shared/recycled numbers, unreliable |

**Decision: Twilio or Plivo** for dedicated numbers when needed.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Project VM (when identity is provisioned)                   │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Docker-mailserver (~1-2GB RAM)                         │ │
│  │ - Receives email for project domain                    │ │
│  │ - Creates unlimited aliases: *@project.domain          │ │
│  │ - Local IMAP/API access for agent to read inbox        │ │
│  │ - Outbound relayed through SendGrid/AWS SES            │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Phone Number (via Plivo/Twilio API)                    │ │
│  │ - One dedicated number per project                     │ │
│  │ - Webhook receives SMS → stored locally                │ │
│  │ - Agent queries for verification codes                 │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Agent Identity Store (SQLite or config)                │ │
│  │ - project_email: hello@project.domain                  │ │
│  │ - project_phone: +1-555-123-4567                       │ │
│  │ - smtp_relay_credentials: {...}                        │ │
│  │ - phone_api_credentials: {...}                         │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Why Hybrid Email

1. **Receiving works immediately** - No IP reputation needed to receive
2. **Unlimited aliases** - Agent creates `signup-abc123@project.domain` on the fly
3. **Sending is reliable** - Relay services handle deliverability
4. **Low cost** - Relay is ~$0.001/email, no per-mailbox fees
5. **Full control** - All data on project VM, no third-party inbox access
6. **Path to full self-host** - Can drop relay later once IP reputation builds

## DNS Requirements

When email is provisioned for a project domain:

| Record | Purpose |
|--------|---------|
| MX | Points to project VM IP (for receiving) |
| SPF | Includes relay service |
| DKIM | Signing key from relay |
| DMARC | Policy record |
| PTR | Reverse DNS on VM IP (GCP supports this) |

## Proposed API

### Email Management

```
POST /projects/:id/email/provision
  - Spins up Docker-mailserver on VM
  - Configures DNS records (requires domain API access)
  - Sets up relay credentials

POST /projects/:id/email/aliases
  - Creates a new alias (e.g., signup-xyz@project.domain)

GET /projects/:id/email/inbox
  - Returns recent messages
  - Filter by alias, sender, subject

POST /projects/:id/email/send
  - Sends email via relay
  - From address must be project domain
```

### Phone Management

```
POST /projects/:id/phone/provision
  - Provisions a phone number via Twilio/Plivo
  - Configures SMS webhook

GET /projects/:id/phone/messages
  - Returns received SMS messages
  - Filter by sender, content (for OTP extraction)

DELETE /projects/:id/phone
  - Releases the phone number
```

### Identity Primitives

Expose to agents via environment or constitution:

```
AGENT_EMAIL=agent@project.domain
AGENT_PHONE=+15551234567
```

## Open Questions

1. **DNS provider standardization** - Should all project domains use Cloudflare for API-based DNS management?

2. **SMTP relay choice** - SendGrid (free tier) vs AWS SES (cheapest at scale)?

3. **Credential architecture** - One master Twilio/SendGrid account with sub-accounts per project, or separate accounts?

4. **Domain warm-up** - New domains have reputation issues. Document warm-up best practices?

5. **Projects without domains** - Fallback to subaddressing on a shared PCC domain?

6. **Phone number lifecycle** - Keep numbers indefinitely, or release after inactivity?

## Future Work Orders

These would be created when v2 work begins:

- **Agent Email Infrastructure** - Docker-mailserver, DNS automation, relay integration
- **Agent Phone Infrastructure** - Twilio/Plivo integration, webhook handling
- **Agent Identity Primitives** - Expose identity to agents via constitution/environment

## Dependencies

- VM provisioning (WO-2026-039)
- VM repo sync (WO-2026-049)
- Mid-run escalation for v1 fallback (WO-2026-051)
