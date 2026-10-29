#!/usr/bin/env bash
# The off-site backup store: MinIO in Docker on ANOTHER machine than the RFQ Desk server.
# Run once on that machine (needs Docker and openssl; as root or with sudo):
#
#   curl -fsSL https://raw.githubusercontent.com/fawadeqbal/kebo-int-internal-tool/main/deploy/offsite-minio/setup.sh | sudo bash -s -- <address>
#
# <address> is how the RFQ Desk server reaches this machine: https://backup.example.com, or
# http://<this machine's IP>:9000. It starts MinIO (data in /srv/backup-minio), makes a bucket and a
# key that can use only that bucket, and prints the lines for the server's .env.
# Running it again keeps the data and the passwords, and prints the same lines.
set -euo pipefail

ADDRESS="${1:-}"
DIR=/srv/backup-minio
NAME=backup-minio
BUCKET=kebo-backups
USER_KEY=kebo-desk
PORT="${PORT:-9000}"
MINIO_IMAGE=cgr.dev/chainguard/minio:latest
MC_IMAGE=cgr.dev/chainguard/minio-client:latest

die() {
  echo "ERROR: $*" >&2
  exit 1
}
[[ $ADDRESS =~ ^https?://[^[:space:]/]+(:[0-9]+)?/?$ ]] || die "give the address the RFQ Desk server will use, e.g. http://203.0.113.7:9000 or https://backup.example.com"
ADDRESS=${ADDRESS%/}
command -v docker >/dev/null || die "Docker is not installed on this machine"
command -v openssl >/dev/null || die "openssl is not installed on this machine"

mkdir -p "$DIR/data"
chmod 700 "$DIR"
# Each secret is made once and kept, so running this again prints the same lines.
secret() { [ -s "$DIR/$1" ] || (umask 077 && openssl rand -hex "$2" >"$DIR/$1"); cat "$DIR/$1"; }
ROOT_PASSWORD=$(secret root-password 24)
KEY_SECRET=$(secret desk-secret 24)
# The encryption password is made once; after you save it and delete this machine's copy, a later
# run must not make a new one (the backups already stored need the first).
if [ -e "$DIR/.encryption-made" ] && [ ! -s "$DIR/encryption-password" ]; then
  ENCRYPTION="<the one you saved the first time>"
else
  ENCRYPTION=$(secret encryption-password 32)
  touch "$DIR/.encryption-made"
fi

if ! docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  echo "Starting MinIO ($NAME, port $PORT, data in $DIR/data)…"
  docker run -d --name "$NAME" --restart unless-stopped --user 0:0 -p "$PORT:9000" \
    -v "$DIR/data:/data" -e MINIO_ROOT_USER=admin -e MINIO_ROOT_PASSWORD="$ROOT_PASSWORD" \
    "$MINIO_IMAGE" server /data >/dev/null
else
  docker start "$NAME" >/dev/null
fi

mc() {
  docker run --rm --network "container:$NAME" -v "$DIR:/cfg:ro" \
    -e MC_HOST_local="http://admin:$ROOT_PASSWORD@localhost:9000" "$MC_IMAGE" "$@"
}
echo "Waiting for MinIO…"
for _ in $(seq 1 30); do
  if mc ls local >/dev/null 2>&1; then break; fi
  sleep 2
done
mc ls local >/dev/null 2>&1 || die "MinIO did not start: docker logs $NAME"

# A bucket, and a key that may use only that bucket.
cat >"$DIR/policy.json" <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:*"],"Resource":["arn:aws:s3:::$BUCKET","arn:aws:s3:::$BUCKET/*"]}]}
JSON
mc mb --ignore-existing "local/$BUCKET" >/dev/null
mc admin policy create local "$BUCKET" /cfg/policy.json >/dev/null
mc admin user add local "$USER_KEY" "$KEY_SECRET" >/dev/null
mc admin policy attach local "$BUCKET" --user "$USER_KEY" >/dev/null 2>&1 || true

cat <<EOF

MinIO is running, with the bucket "$BUCKET" and a key that can use only it.

1. On the RFQ Desk server, run:

     cd /opt/kebo-desk && bash deploy/server/enable-offsite.sh

   and paste these lines when it asks (then press Ctrl-D):

OFFSITE_S3_ENDPOINT=$ADDRESS
OFFSITE_S3_BUCKET=$BUCKET
OFFSITE_S3_ACCESS_KEY=$USER_KEY
OFFSITE_S3_SECRET_KEY=$KEY_SECRET
OFFSITE_ENCRYPTION_PASSWORD=$ENCRYPTION

2. Save OFFSITE_ENCRYPTION_PASSWORD in your password manager too. Without it the backups
   stored here cannot be read, and it must not exist only on the RFQ Desk server.
   Once it is saved, delete this machine's copy (the store should not hold its own key):
     rm $DIR/encryption-password

3. Let only the RFQ Desk server reach port $PORT here (a firewall rule or your cloud's security
   list allowing 145.241.156.60), or put HTTPS (e.g. Caddy) in front of it.
EOF
