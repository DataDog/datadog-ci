FROM alpine

WORKDIR /w
RUN apk add --update npm git

ARG VERSION
RUN npm install -g @datadog/datadog-ci@$VERSION \
    @datadog/datadog-ci-plugin-aas@$VERSION \
    @datadog/datadog-ci-plugin-cloud-run@$VERSION \
    @datadog/datadog-ci-plugin-container-app@$VERSION \
    @datadog/datadog-ci-plugin-lambda@$VERSION \
    @datadog/datadog-ci-plugin-stepfunctions@$VERSION \
    && echo -e "Installed packages:\n$(npm list -g | grep -o '@datadog/.*')"

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
