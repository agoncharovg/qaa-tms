# Hello local plugin

Build it:

```bash
npm install
npm run build
```

Install it into your local plugin folder:

```bash
ln -s "$(pwd)" ~/Projects/qaa-tms-plugins/hello
```

Or copy the folder into `~/Projects/qaa-tms-plugins/hello`.

Then set `AGENT_LOCAL_PLUGINS_DIR` in Profile -> Settings, reload the portal, and open the
`Hello` entry from the sidebar.

Inside `mount(viewKey, ctx)`, use `ctx.agent.fetch("/your/endpoint")` for authenticated agent calls.
