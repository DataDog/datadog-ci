FROM alpine

WORKDIR /w
RUN apk add --update npm git

ARG VERSION
RUN npm install -g "@datadog/datadog-ci@${VERSION}" \
    && echo "Installed datadog-ci version: $(npm list -g | grep datadog-ci | grep -o '[^@]*$')"

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
