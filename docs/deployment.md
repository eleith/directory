# Deployment

use docker compose with our [compose](compose.yaml)

i mean, there are many other ways, but i'm not going to talk about them.

Fill out `config/directory.yaml`. The [example](directory.example.yaml) has comments
for sign-in and SSO. See [configuration](config.md) for all the juicy options.

## start up

```sh
docker compose up -d
```

you can edit most configurations without having to restart.

## inspect logs

not sure what is going on? check out the logs

```sh
docker compose logs
```

and visit `http://localhost:3000/healthz` to see what is up.

or down.

## restart

```sh
docker compose restart
```

## update

if a new version is released, update your compose with the latest version and
then

```sh
docker compose up -d --force-recreate
```
