FROM node:10.24.1-alpine3.11 AS base
RUN apk add --no-cache cmake=3.15.5-r0
COPY ./ /work
WORKDIR /work
RUN yarn install && \
    yarn run prepack

FROM node:10.24.1-alpine3.11
COPY ./package.json ./yarn.lock LICENSE /app/
COPY --from=base /work/dist /app/dist
RUN chown -R node:node /app
USER node
WORKDIR /app 
RUN yarn install
ENTRYPOINT [ "node", "dist/index.js" ]
