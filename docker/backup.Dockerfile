# The nightly backup (docker/backup.sh): pg_dump from PostgreSQL 16, and rclone for the off-site copy.
# docker-compose.yml mounts the current backup.sh over the copy here; the copy is for using the image
# on another machine (restoring from the off-site copy, docs/restore.md).
FROM postgres:16-alpine
RUN apk add --no-cache rclone
COPY backup.sh /backup.sh
# Kept by the nightly cleanup (deploy/server/docker-cleanup.sh): the :previous image a failed deploy goes back to.
LABEL desk.kebo.keep="true"
