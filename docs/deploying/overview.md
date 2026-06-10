---
sidebar_position: 1
title: Deployment Overview
---

# Deployment Overview

CodeRunner is self-hosted. You run the control plane and the per-student
workspace containers on a machine you control — there is no managed SaaS. There
are two supported deployment shapes, and this section walks through both. Pick
the one that matches how your students will reach the app.

## Two supported shapes

### A classroom / LAN machine

Everything runs on one box — a lab PC, a spare laptop, or a mini PC — and
students connect to it over the local network (for example
`http://192.168.1.50:4000/`). This is the simplest path: clone the repo, build,
and start. Traffic is plain HTTP, so keep the machine on a trusted network. It
is ideal for in-person meetings where everyone is on the same Wi-Fi.

See [Local Deployment](./local.md).

### A Google Cloud VM (Terraform-automated)

A single Google Compute Engine VM, provisioned with the Terraform config in
this repo, fronted by Caddy for automatic HTTPS on your own domain. Students
reach it from anywhere over `https://<your-domain>/`, releases ship through a
GitHub Actions workflow, and metrics/logs flow to Grafana Cloud. This is the
right choice for remote teams or anyone who wants a stable public URL.

Rough cost: the default VM is a `c4-standard-4` (4 vCPU / 15 GB) with a 50 GB
boot disk and a 50 GB persistent data disk, running in `us-central1`. That is a
modest always-on cost (low tens of US dollars per month at the time of writing);
the data disk takes daily snapshots with 7-day retention. You can stop the VM
between seasons to drop to near-zero — see
[Seasonal Teardown](../operating/seasonal-teardown.md). Verify the current sizing
in [`deploy/terraform/vm.tf`](https://github.com/mathewdunne/CodeRunner/blob/main/deploy/terraform/vm.tf)
and [`variables.tf`](https://github.com/mathewdunne/CodeRunner/blob/main/deploy/terraform/variables.tf).

See [Google Cloud Deployment](./gcloud.md).

## What both need

Regardless of shape, every non-demo deployment needs:

- **OAuth credentials.** Login is via GitHub and/or Google sign-in through
  Better Auth — at least one provider must be configured. Register your apps
  first; see [OAuth Credentials](./oauth-credentials.md).
- **Docker.** Each active student runs in a per-student workspace container
  (sim + editor), so the host needs a working Docker Engine.

## Optional: Cloudflare offline page

For the cloud deployment only, you can optionally put a Cloudflare Pages project
in front of the VM so students see a styled "CodeRunner is Offline" screen when
the VM is powered down, instead of a browser connection error. This is purely
additive — the VM and all its infrastructure are unchanged. See
[Cloudflare Offline Page](./cloudflare.md).
