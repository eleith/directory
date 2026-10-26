# Development

Read the [philosophy](philosophy.md).

Then resist the urge to add a plugin system.

With Docker, mise, and fnox installed, run from `apps/web`:

```sh
mkdir -p config
cp -n ../../docs/directory.example.yaml config/directory.yaml
mise docker up
```

if it works. celebrate.

when you come back, in a browser, navigate to http://localhost:5173

## write code

the app is a svelte app and in development it is hot reloading. code away and
watch the magic work (or break).

keep changes small, well tested, well linted and well.
