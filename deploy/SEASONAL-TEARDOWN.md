# Seasonal Teardown & Restore

How to take CodeRunner down to **near-zero cost over the off-season** (e.g. summer
break) and bring it back in the fall. This is the "we're done meeting for the
year" procedure — distinct from a throwaway `terraform destroy` (see the teardown
note in [`README.md`](./README.md#verification)).

The guiding idea: **the boot disk is disposable, the data disk is precious.** The
boot disk is just Ubuntu + cloud-init + a Docker image pull, fully rebuilt by
`terraform apply`. The data disk holds the SQLite DB and every student's project
and editor home, so it must be captured in a **manual** snapshot before deletion.

> Values below match this deployment: zone `northamerica-northeast2-a`, region
> `northamerica-northeast2`, domain `coderunner.wiredcats5885.ca`. Substitute your
> own if you forked.

## Why "just stop the VM" isn't enough

A `TERMINATED` VM still bills for everything except compute:

| Resource | Billed while stopped? | Rough cost |
|---|---|---|
| Boot disk (50 GB hyperdisk-balanced) | Yes | ~$5/mo |
| Data disk (50 GB hyperdisk-balanced) | Yes | ~$5/mo |
| Reserved static IP (`google_compute_address.coderunner`) | Yes — a reserved IPv4 bills even when unattached | ~$3/mo |
| Daily auto-snapshots (7-day retention) | Yes, tiny | <$1/mo |
| VM compute, network, subnet, firewall, IAM, secrets, Cloudflare | No / ~$0 | — |

≈ $13/mo if you just leave it stopped. Full teardown gets that under ~$1/mo
(a manual snapshot, billed only on used data).

To stop paying for the **boot** disk you must delete the **VM** — the boot disk is
created inside `initialize_params` in [`vm.tf`](./terraform/vm.tf), so it can't
exist without the instance.

---

## Teardown

Do this with `gcloud`, **not** `terraform destroy`. The data disk carries
`prevent_destroy = true` ([`disk.tf`](./terraform/disk.tf)) which is a deliberate
guard against destroying student data; it only blocks Terraform, not gcloud.

### 1. Take a manual (non-expiring) snapshot of the data disk

The daily auto-snapshots have **7-day retention** (`max_retention_days = 7`) and
will age out long before fall — `on_source_disk_delete = KEEP_AUTO_SNAPSHOTS`
only stops the delete-cascade, not the expiry. **Do not rely on them.** Take a
manual snapshot (manual snapshots never auto-expire):

```bash
gcloud compute snapshots create coderunner-data-eoy2026 \
  --source-disk=coderunner-data \
  --source-disk-zone=northamerica-northeast2-a \
  --storage-location=northamerica-northeast2
```

The **boot disk does not need a snapshot** — it's rebuilt from scratch by
`terraform apply`. Skip it.

### 2. Verify the snapshot is READY before deleting anything

```bash
gcloud compute snapshots describe coderunner-data-eoy2026 \
  --format="value(status,diskSizeGb)"
```

Expect `READY` and the disk size. **Do not proceed until this says READY.**

### 3. Delete the VM (this also deletes the boot disk)

The attached data disk **survives** — additional attached disks default to
`auto_delete = false` and `vm.tf` doesn't override it.

```bash
gcloud compute instances delete coderunner --zone=northamerica-northeast2-a
```

### 4. Delete the data disk (now safely captured)

```bash
gcloud compute disks delete coderunner-data --zone=northamerica-northeast2-a
```

### 5. Decide on the static IP — judgment call

A reserved static IPv4 bills (~$3/mo) even with nothing attached.

- **Keep it** (do nothing): DNS A record stays valid; fall startup needs no DNS
  change. ~$3/mo × off-season months.
- **Release it:** saves that cost, but you'll get a **new** IP in the fall and
  must update the DNS A record (`coderunner.wiredcats5885.ca` → new IP) and wait
  for propagation before TLS / OAuth callbacks work.

  ```bash
  gcloud compute addresses delete coderunner --region=northamerica-northeast2
  ```

> If you run the optional [Cloudflare Pages offline mode](./README.md#cloudflare-pages-mode),
> students hit a styled "CodeRunner is Offline" `503` screen while the VM is gone
> instead of a browser error — no action needed for that during teardown.

### What's left running (≈ $0)

- The manual snapshot — billed on **used** data only (~7 GB → cents/mo).
- Secret Manager (pennies), network/subnet/firewall/IAM, Cloudflare Pages — free
  or negligible. The snapshot resource policy stays but does nothing with no disk
  attached.

> **Terraform state note:** deleting via gcloud leaves state showing a VM and data
> disk that no longer exist. That's fine — the fall `terraform apply` reconciles by
> recreating them. If you'd rather keep state truthful in the meantime, run
> `terraform state rm google_compute_instance.coderunner google_compute_disk.data`
> after deletion. Not required.

---

## Restore (in the fall)

Mostly one `terraform apply`, because the snapshot-seeding path is already wired
into `disk.tf` (it's the same mechanism used for the original
pd-balanced → hyperdisk-balanced migration).

### 1. Point the data disk at your snapshot

In [`disk.tf`](./terraform/disk.tf), add the `snapshot` argument to
`google_compute_disk.data`:

```hcl
resource "google_compute_disk" "data" {
  name     = "coderunner-data"
  type     = var.data_disk_type
  zone     = var.zone
  size     = var.data_disk_size_gb
  snapshot = "coderunner-data-eoy2026"   # seed from the off-season snapshot

  # provisioned_iops / provisioned_throughput / lifecycle stay as-is.
  # lifecycle.ignore_changes = [snapshot] already absorbs the post-restore drift.
}
```

### 2. Apply

```bash
cd deploy/terraform
terraform apply
```

This recreates everything:

- **Data disk** created **from the snapshot** — DB + student projects restored —
  at baseline 3000 IOPS / 140 MiB/s (pinned in config).
- **VM + boot disk** rebuilt from the Ubuntu image; cloud-init re-bootstraps,
  pulls `ghcr.io/<owner>/coderunner-workspace`, and re-renders `.env` from Secret
  Manager.
- **Static IP** re-attached (if kept) or freshly allocated (if released).

### 3. If you released the static IP

Update the DNS A record `coderunner.wiredcats5885.ca` → new IP
(`terraform output -raw static_ip`) and wait for propagation before relying on
TLS or OAuth callbacks.

### 4. Land the web bundle

A freshly rebuilt VM has an empty `apps/web/dist` until the first deploy — `/`
404s, though `/healthz` works. Run a deploy from `main` against your latest
release tag (see [`README.md`](./README.md#how-releases-deploy)):

```bash
gh workflow run "Deploy to GCE" --ref main -f tag=vX.Y.Z
```

### 5. Verify, then clean up

- Confirm `https://coderunner.wiredcats5885.ca/healthz` is 200 with a valid cert.
- Sign in, confirm a student workspace + the lesson catalog load, and run a sim
  end-to-end (telemetry flowing).
- Once verified, you can remove the `snapshot =` line from `disk.tf` (safe —
  `ignore_changes = [snapshot]` means no recreate) and delete the manual snapshot
  to stop its tiny charge:

  ```bash
  gcloud compute snapshots delete coderunner-data-eoy2026
  ```

---

## TL;DR

1. Manual snapshot of `coderunner-data` (auto-snapshots expire in 7 days — don't trust them).
2. Verify snapshot `READY` → delete VM (takes the boot disk) → delete data disk.
3. Keep or release the static IP (DNS trade-off).
4. Fall: add `snapshot =` to `disk.tf`, `terraform apply`, deploy a tag, verify, then drop the snapshot line + snapshot.
