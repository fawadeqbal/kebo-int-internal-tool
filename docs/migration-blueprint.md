# Moving RFQ Desk to another server — blueprint

Status: **plan** (29 Oct 2026). Nothing below is built yet except where it says so.

## The idea

The whole system moves with **two commands**: one on the old server makes a single encrypted **bundle** (settings, database, files, the code version), one on the new server **installs** it, starts everything and checks it. The same install command can also rebuild the system **from the off-site backup** when the old server is gone, so a move and a disaster recovery are the same path, and testing one tests the other.

```
old server                                  new server (any Linux with Docker)
──────────                                  ───────────────────────────────────
bash deploy/migrate/export.sh   ── bundle ──▶  install.sh <bundle>
                                               │  clone the code at the bundle's version
off-site MinIO  ──── (old server gone) ─────▶  install.sh --from-offsite
                                               │  restore settings, database, files
                                               │  start, check, print what is left (DNS, GitHub)
```

## What the system is made of

| Part | Where it is today | In the bundle | How it moves |
| --- | --- | --- | --- |
| Code | GitHub (`fawadeqbal/kebo-int-internal-tool`), checked out in `/opt/kebo-desk` | the commit id only | cloned from GitHub at that commit |
| Settings and secrets | `/opt/kebo-desk/.env`, `secrets/firebase.json` | yes, encrypted | copied as they are; **`AUTH_SECRET` must stay the same** (two-step sign-in and the `kebo_app` database password depend on it) |
| Database (all companies, users, inquiries, orders, money, platform admins) | Docker volume `pgdata` | yes (`pg_dump`) | restored after creating the `kebo_app` role (as in `docs/restore.md`) |
| Uploaded files | Docker volume `files` (MinIO) | yes | copied; a second run copies only what changed |
| Web address and HTTPS | shared Caddy outside the repo (`/opt/global-proxy`, container `global-caddy`) | no | the new server runs its own Caddy from the repo; certificates are issued again automatically |
| DNS | `rfq.fawadiqbal.dev` and `*.rfq.fawadiqbal.dev` → 145.241.156.60 | no | you change the A records to the new IP |
| Deploys from GitHub | GitHub secrets `DEPLOY_HOST`, `DEPLOY_KNOWN_HOSTS`, `DEPLOY_SSH_KEY`; the forced-command line in `~opc/.ssh/authorized_keys` | no | install prints the key line and the new host key; you update the two secrets |
| Nightly Docker cleanup | systemd timer | no | installed by the first deploy on the new server (already automatic) |
| Backups | `backups/` on the server, off-site MinIO | no | the off-site copy keeps working from the new server (same `OFFSITE_*` settings in `.env`); old local copies stay on the old server |

Nothing else lives on the server: no packages besides Docker, no cron jobs, no files outside `/opt/kebo-desk`. Keeping it that way is what makes the move simple (rules at the end).

## The commands (planned)

**1. On the old server: make the bundle**

```bash
cd /opt/kebo-desk && bash deploy/migrate/export.sh                   # writes kebo-desk-<date>.bundle
cd /opt/kebo-desk && bash deploy/migrate/export.sh --to opc@<new-ip> # or sends it straight over SSH
```

- Asks for a bundle password and encrypts everything with it (the bundle holds every secret and every customer).
- Contents: `.env`, `secrets/`, the database dump, the files, the commit id, and a **manifest** (row counts per table, file count and size, checksums) used to check the install.
- `--to` uses rsync: run it once ahead of the move (no downtime), and again at the move, which then only sends what changed (minutes, not hours).

**2. On the new server: install it**

```bash
curl -fsSL https://raw.githubusercontent.com/fawadeqbal/kebo-int-internal-tool/main/deploy/migrate/install.sh \
  | sudo bash -s -- /path/to/kebo-desk-<date>.bundle
```

What it does, in order (it stops at the first problem and says what to fix):

1. Checks the machine: Docker (installs it on Oracle Linux or Ubuntu if missing), free ports 80 and 443, enough disk for the data plus backups.
2. Clones the code at the bundle's commit into `/opt/kebo-desk`.
3. Puts back `.env` and `secrets/`.
4. Starts the database, creates `kebo_app`, restores the dump, sets the time zone to UTC.
5. Starts MinIO and restores the files.
6. Starts everything with the repo's own Caddy (or `--shared-proxy` to join an existing proxy network, as today).
7. Checks: health, migrations up to date, row counts and file counts equal the manifest, a sign-in page loads.
8. Prints what is left for you: the DNS records, the GitHub secrets, the `authorized_keys` line.

**Without the old server** (it is lost): the same install, from the off-site copy:

```bash
… | sudo bash -s -- --from-offsite
```

It asks for the `.env` (keep a copy in your password manager) and the off-site encryption password, then takes the latest database copy and all files from your MinIO. You lose at most the day since the last nightly backup.

## Moving a live system, step by step

| When | Step | Downtime |
| --- | --- | --- |
| Day before | Lower the DNS TTL of `rfq` and `*.rfq` to 5 minutes. | none |
| Day before | Dry run: `export.sh --to` and `install.sh` on the new server. Check it through a test address (a hosts-file entry). The old server keeps serving. | none |
| Move | Turn on maintenance on the old server (everyone can read, nobody can change anything). | starts |
| Move | `export.sh --to` again (only the changes), then `install.sh` on the new server. | ~5–10 min |
| Move | Change the DNS A records to the new IP. Certificates are issued in the first minute. | ~5 min (TTL) |
| Move | Update `DEPLOY_HOST` and `DEPLOY_KNOWN_HOSTS` in GitHub, add the key line on the new server, run one deploy from Actions to prove it. | none |
| After | Check: sign in, open a known order and its files, next morning's email, `backups/status/last-status.json` (the first night's backup and the off-site copy). | none |
| 2 weeks later | Remove the old stack (keep its last dump). | none |

Expected downtime: **about 15 minutes**, almost all of it DNS. Nothing is lost: the old server is only read during the move.

## What to build

| # | Piece | Effort |
| --- | --- | --- |
| 1 | `deploy/migrate/export.sh`: bundle, manifest, encryption, `--to` with rsync | ½ day |
| 2 | `deploy/migrate/install.sh`: checks, Docker install, restore, start, verify, `--from-offsite` | 1 day |
| 3 | Built-in Caddy as a compose profile (the site and company addresses with on-demand HTTPS), so a new server needs no outside proxy | ½ day |
| 4 | Maintenance switch: all companies read-only with a banner, on and off with one command (the platform already has read-only per company) | ½ day |
| 5 | End-to-end test on a fresh VM, and a monthly "restore drill" from the off-site copy written into `docs/restore.md` | ½ day |

About **3 days** in all. Items 2 and 5 also cover disaster recovery, so they are worth building even without a move planned.

## Rules that keep it portable

- Everything runs in Docker Compose. The host needs only Docker; anything else (the cleanup timer) is installed by the deploy.
- Every setting is in `.env`; no setting lives only on the server or in someone's head. Keep a copy of `.env` in the password manager.
- No host paths in the code except `/opt/kebo-desk` (overridable).
- New services join the backup and the bundle when they are added (a new volume = a line in both scripts).
- Run the restore drill monthly: a backup that has never been restored is only a hope.

## Risks

| Risk | Handling |
| --- | --- |
| `AUTH_SECRET` lost or changed | Two-step sign-in has to be set up again by everyone. The bundle carries it; keep `.env` in the password manager. |
| The bundle leaks | It is encrypted with its own password; delete it after the move. |
| Old DNS answers cached | TTL lowered the day before; the old server stays read-only, so late visitors see data but cannot change it. |
| HTTPS errors in the first minute | On-demand certificates are issued at the first visit once DNS points at the new server; brief. |
| Other apps on the old server | This plan covers RFQ Desk only; the shared proxy and other projects move separately. |
| Different CPU type (ARM vs x86) | The images are built on the new server from the code, so both work. |
