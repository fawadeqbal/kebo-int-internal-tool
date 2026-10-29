# The nightly backup (docker/backup.sh): pg_dump from PostgreSQL 16, and rclone for the off-site copy.
FROM postgres:16-alpine
RUN apk add --no-cache rclone
# Kept by the nightly cleanup (deploy/server/docker-cleanup.sh): the :previous image a failed deploy goes back to.
LABEL desk.kebo.keep="true"
