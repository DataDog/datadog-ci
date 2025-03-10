FROM alpine

WORKDIR /w

RUN apk add --update npm git nodejs
RUN npm install -g yarn

COPY . /w

RUN yarn install --immutable && yarn build
RUN yarn dist-standalone -t node18-linux-x64 -o datadog-ci_linux-x64
