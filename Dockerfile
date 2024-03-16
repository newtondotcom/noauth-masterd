FROM node:latest

RUN mkdir -p /usr/src/bot

WORKDIR /usr/src/bot

COPY . .

RUN --mount=type=secret,id=DJANGO_URL \
    --mount=type=secret,id=DJANGO_URL \
    echo "DJANGO_URL=$(cat /run/secrets/DJANGO_URL)" >> .env && \
    echo "DJANGO_TOKEN=$(cat /run/secrets/DJANGO_TOKEN)" >> .env

RUN yarn

CMD ["yarn", "start"]