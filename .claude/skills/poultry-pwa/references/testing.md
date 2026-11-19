# Proving PWA behaviour

Tests run against the **production build** (`pnpm test:e2e` builds and starts it on port 3100). The worker is disabled in `next dev`.

## Real offline (Playwright, Chromium)

`context.setOffline(true)` alone lets the service worker's own fetches through, so a "passing" offline test can be served by the network. Abort everything and assert where the response came from:

```ts
await page.goto("/ar");
await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined)); // shell precached

await context.setOffline(true);
await context.route("**", (route) => route.abort("internetdisconnected")); // also sees the worker's requests
const reload = await page.reload();
expect(reload?.fromServiceWorker()).toBe(true);
```

A page never opened online must show the localized offline page:

```ts
await page.goto("/fr/install");
await expect(page.getByRole("heading", { name: "Pas de connexion" })).toBeVisible();
```

## Installability

Lighthouse 12 has no PWA audit, and `Page.getInstallabilityErrors` returns `[]` even for a page without a manifest. So:

```ts
const cdp = await page.context().newCDPSession(page);
const { url, errors } = await cdp.send("Page.getAppManifest");
expect(url).toMatch(/\/ar\/manifest\.webmanifest$/);
expect(errors).toEqual([]);
```

Then assert the install fields on the fetched manifest: `name`, `start_url`, `display: "standalone"`, 192 and 512 icons that return 200. Chrome's criteria are in `sources.md`.

## Platform-specific UI

Switch the user agent to test the iPhone path in Chromium:

```ts
test.use({ userAgent: devices["iPhone 15"].userAgent });
```

## Always check a test can fail

A green offline test proves nothing until it has failed for the right reason. After writing one, break the behaviour (remove the precache entry, disable the fallback) and watch it go red. In T4 this caught both a false offline pass and a silently dropped fallback.

## What only a real phone can prove

At the checkpoints (A, C), on a real low-end Android phone and an installed iPhone:
- install, then launch from the icon in airplane mode;
- leave it offline for a day, edit, reload, go online, and check that everything converges;
- check that push arrives (Android; iPhone only when installed).
