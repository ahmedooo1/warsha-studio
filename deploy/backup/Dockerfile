FROM alpine:3.20
RUN apk add --no-cache restic postgresql16-client openssh-client tini tzdata jq coreutils
COPY backup.sh restore-test.sh restore.sh loop.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/*.sh
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/usr/local/bin/loop.sh"]
