FROM alpine

WORKDIR /w
RUN apk add --update npm git

ARG VERSION
RUN npm install -g "@datadog/datadog-ci@${VERSION}"

ENTRYPOINT ["datadog-ci"]
