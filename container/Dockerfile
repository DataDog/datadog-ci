FROM alpine

WORKDIR /w
RUN apk add --update npm git

ARG VERSION
RUN npm install -g @datadog/datadog-ci@$VERSION \
    && echo -e "Installed packages:\n$(npm list -g | grep -o '@datadog/.*')"

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
