import { test, expect, type Page } from '@playwright/test';
import {
  launchObsidian,
  driveConnectFlow,
  findShadowVaultPath,
  waitForShadowVaultLoaded,
  expandFolderInExplorer,
  runCommandViaPalette,
  type ObsidianHandle,
} from './helpers/obsidian';
import { scaffoldTestVault, type ScaffoldResult } from './helpers/vault-scaffold';
import { RemoteVerifier } from './helpers/remote-verifier';
import { makePng, makeSvg, makePdf } from './helpers/remote-fixtures';
import { assertSshdReachable } from './helpers/sshd';
import { logPathFor } from './helpers/log-oracle';

/**
 * Binary assets over SSH: `SftpDataAdapter.getResourcePath` →
 * `ResourceBridge` → Obsidian's webview.
 *
 * Why this spec exists
 * --------------------
 * A remote vault's images do not live on the local disk, so Obsidian cannot
 * render them the way it normally does (`app://local/<abs-path>`). The plugin
 * substitutes a localhost HTTP server: `getResourcePath()` hands the webview a
 * `http://127.0.0.1:<port>/r/<token>?p=<vault-path>[&thumb=1024]` URL
 * (`SftpDataAdapter.ts:408-418`), and `ResourceBridge.handleRequest`
 * (`ResourceBridge.ts:240-282`) answers it out of the daemon — thumbnail RPC
 * for `png|jpg|jpeg|gif` (`THUMBNAIL_EXTENSIONS`), `fs.readBinaryRange` for
 * `Range:` requests, full binary otherwise.
 *
 * Nothing in the existing suite covers that chain end-to-end. `reflect.spec.ts`
 * had the only image scenario and it is (a) `test.fixme`'d and (b) seeded with a
 * 1x1 PNG followed by a megabyte of zero padding — a fixture that can only ever
 * prove "bytes moved". It cannot distinguish "the bridge served a correct,
 * DOWNSCALED image" from "the bridge silently fell back to shipping the whole
 * 10 MB original", because a 1x1 image has no size to lose. Every fixture here
 * is a real, decodable file of a known size (`helpers/remote-fixtures.ts`), so
 * the assertions are about the artefact itself, not about a byte count.
 *
 * Ordering
 * --------
 * The bridge-level `fetch` tests (2, 3, 7, 8) run BEFORE any preview-rendering
 * test on purpose: if Obsidian's markdown renderer falls over under Xvfb, the
 * run still tells the maintainer whether ResourceBridge served the right bytes
 * with the right headers — the two failure surfaces stay separable.
 *
 * PREDICTIONS (a red test here is a real defect, not a broken test — nothing
 * below is weakened, skipped or `fixme`'d):
 *
 *   1. getResourcePath URL shape .......... PASS
 *   2. bridge serves a decodable PNG ...... PASS
 *   3. 2048px → 1024px cap ................ PASS, and this is the one that
 *      catches `ResourceBridge.serveThumbnail` (ResourceBridge.ts:306-312)
 *      SWALLOWING a failed thumbnail RPC and falling through to the full
 *      binary: the user then silently pulls the 10 MB original over SSH for
 *      an inline preview. The `byteLength < remote size` half of the assertion
 *      is what makes that fallback visible; the dimension half alone would
 *      pass on the fallback (a full-size 2048px image still decodes).
 *   4. root-note embed renders ............ PASS
 *   5. embed inside an UNEXPANDED folder .. **FAIL, EXPECTED**. The remote tree
 *      is loaded LAZILY, one level per expand: connect walks the ROOT only
 *      (`main.ts` populate + `LazyFolderLoader`), so `<S>-sub/nested.png` is
 *      not in `vault.fileMap` and Obsidian's link resolver cannot resolve
 *      `![[<S>-sub/nested.png]]` to a TFile — there is no file to hand to
 *      `getResourcePath`, so no bridge URL is ever minted and the embed stays
 *      unresolved. This is a genuine user-visible bug (an image in a subfolder
 *      does not render until you happen to click the folder open), and it is
 *      why the failure message below reports whether the file was in the vault
 *      model: the red must be conclusive about WHY, not just "no img".
 *   6. expanding the folder fixes it ...... **GENUINELY UNKNOWN**. Whether a
 *      lazy `fileMap` insert re-triggers Obsidian's link resolution (and hence
 *      re-renders an already-parsed embed) is not decided anywhere in the code
 *      we control. Whatever this test does IS the finding, and it tells the
 *      maintainer whether the fix for (5) is "walk deeper on connect" or
 *      "invalidate metadata after a lazy insert".
 *   7. SVG via the full-binary path ....... PASS (svg is not in
 *      THUMBNAIL_EXTENSIONS → no `thumb=`, so it takes `serveFullBinary` and
 *      gets its MIME from `guessMimeType`).
 *   8. PDF + Range → 206 .................. PASS (`serveRangeFastPath`, or the
 *      post-hoc slice in `serveFullBinary` if the daemon lacks
 *      `fs.readBinaryRange` — both must produce a correct 206).
 *   9. remotely-REPLACED image ............ PASS on rpc. Three caches sit between
 *      the remote bytes and the `<img>`: the adapter's `ReadCache`, the
 *      bridge's mtime cache, and the daemon's thumbnail path. A watch event
 *      must invalidate them; serving the OLD generation forever is data being
 *      shown to the user that no longer exists.
 *
 * HARD-FAILS, never skips.
 */

const STAMP = Date.now().toString(36);

/** 640x480 — under the 1024 thumbnail cap, so its dimensions survive a resize. */
const SMALL_PNG = `${STAMP}-small.png`;
/** 2048x1536 — over the cap. Random pixels ⇒ ~10 MB on the wire if NOT resized. */
const BIG_PNG = `${STAMP}-big.png`;
const SVG = `${STAMP}-vec.svg`;
const PDF = `${STAMP}-doc.pdf`;
const EMBED_NOTE = `${STAMP}-embed.md`;
const SUB_DIR = `${STAMP}-sub`;
const NESTED_PNG = `${SUB_DIR}/nested.png`;
const SUBEMBED_NOTE = `${STAMP}-subembed.md`;

/** `getResourcePath` on a png must carry the thumbnail hint (DEFAULT_THUMB_MAX_DIM). */
const THUMB_MAX_DIM = 1024;

/** Multi-MB payloads over SSH + a daemon-side resize. Generous but bounded. */
const BRIDGE_TIMEOUT_MS = 60_000;
/** Renderer-side: File Explorer paint + reading-view switch under Xvfb. */
const RENDER_TIMEOUT_MS = 30_000;

let obsidian: ObsidianHandle;
let scaffold: ScaffoldResult;
let remote: RemoteVerifier;
let shadowVaultPath: string;

test.beforeAll(async () => {
  // Seeding ~13 MB of PNG over SFTP plus two Obsidian launches. The default
  // 120 s hook budget is not enough on a cold container.
  test.setTimeout(300_000);

  // HARD-FAIL, never skip: a down sshd is a broken harness and a broken
  // connect is a broken plugin. Both must be red, not green-by-skipping.
  await assertSshdReachable();

  remote = new RemoteVerifier();
  if (!(await remote.connect())) {
    throw new Error(
      'RemoteVerifier could not connect to the docker test sshd even though ' +
      'the port is open. This spec hard-fails rather than skipping.',
    );
  }

  // Seed BEFORE the connect: the plugin's populate walks the remote once, at
  // connect time. A fixture written afterwards would arrive through the
  // fs.watch → RPC-push reflect path instead, which is `reflect.spec.ts`'s
  // subject, not this one — and test 5's whole point is what the CONNECT WALK
  // did (and didn't) put into `vault.fileMap`.
  await remote.writeBinaryFile(SMALL_PNG, makePng(640, 480));
  await remote.writeBinaryFile(BIG_PNG, makePng(2048, 1536));
  await remote.writeFile(SVG, makeSvg(320, 240));
  await remote.writeBinaryFile(PDF, makePdf());
  await remote.writeFile(EMBED_NOTE, `# embed\n\n![[${SMALL_PNG}]]\n`);
  await remote.mkdirp(SUB_DIR);
  await remote.writeBinaryFile(NESTED_PNG, makePng(640, 480));
  await remote.writeFile(SUBEMBED_NOTE, `# sub embed\n\n![[${NESTED_PNG}]]\n`);

  scaffold = scaffoldTestVault();
  obsidian = await launchObsidian(scaffold.vaultPath);

  // Building blocks rather than `connectAndOpenShadow`, so we keep the shadow
  // vault PATH — `waitForShadowVaultLoaded` needs its console.log for the
  // diagnostic dump on timeout.
  await driveConnectFlow(obsidian.page);
  shadowVaultPath = await findShadowVaultPath(scaffold.vaultPath, 15_000);
  await obsidian.cleanup();
  obsidian = await launchObsidian(shadowVaultPath);

  // `launchObsidian` returns once the plugin has LOADED; the SSH connect and
  // the adapter patch land later, at layout-ready. Every assertion here goes
  // through the PATCHED adapter (`getResourcePath` on the stock
  // FileSystemAdapter returns an `app://local/...` URL for a file that does
  // not exist locally), so we must not touch it before this returns.
  await waitForShadowVaultLoaded(obsidian.page, logPathFor(shadowVaultPath), 30_000);
});

test.afterAll(async () => {
  await obsidian?.cleanup();
  if (remote) {
    await Promise.allSettled([
      remote.removeFile(SMALL_PNG),
      remote.removeFile(BIG_PNG),
      remote.removeFile(SVG),
      remote.removeFile(PDF),
      remote.removeFile(EMBED_NOTE),
      remote.removeFile(SUBEMBED_NOTE),
      remote.rmrf(SUB_DIR),
    ]);
    await remote.disconnect();
  }
  scaffold?.cleanup();
});

test.describe('remote images & binaries: getResourcePath → ResourceBridge → webview', () => {
  test.beforeEach(() => {
    // Images are multi-MB over SSH and the 2048px fixture is resized daemon-side.
    test.setTimeout(180_000);
  });

  // ─── bridge level: run FIRST, so a broken renderer can't mask bad bytes ───

  test('getResourcePath returns a live ResourceBridge URL with the thumbnail hint', async () => {
    const pngUrl = await resourcePath(obsidian.page, SMALL_PNG);

    // A `data:` URL is `SftpDataAdapter.getResourcePath`'s fallback for "the
    // bridge is not running" (SftpDataAdapter.ts:417). It renders nothing, and
    // it is indistinguishable from a broken image at the DOM level — so it has
    // to be caught HERE, at the source, not downstream.
    expect(
      pngUrl,
      'getResourcePath handed back a data: URL — the ResourceBridge never ' +
      'bound, so no remote asset can render at all',
    ).not.toMatch(/^data:/);

    expect(
      pngUrl,
      'png must get a live bridge URL carrying the thumbnail hint ' +
      `(THUMBNAIL_EXTENSIONS ∋ png, DEFAULT_THUMB_MAX_DIM=${THUMB_MAX_DIM})`,
    ).toMatch(
      new RegExp(String.raw`^http://127\.0\.0\.1:\d+/r/[0-9a-f]+\?p=.*thumb=${THUMB_MAX_DIM}`),
    );

    // A PDF is not an image: asking the daemon to "resize" it would fail the
    // thumbnail RPC and burn a round-trip before falling back. The hint must
    // simply not be there.
    const pdfUrl = await resourcePath(obsidian.page, PDF);
    expect(pdfUrl, 'pdf must still get a live bridge URL').toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/r\/[0-9a-f]+\?p=/,
    );
    expect(
      pdfUrl,
      'pdf carries a thumb= hint — it is not in THUMBNAIL_EXTENSIONS and the ' +
      'daemon cannot decode it, so this is a guaranteed-failing RPC per request',
    ).not.toContain('thumb=');
  });

  test('bridge serves a decodable PNG with the right Content-Type', async () => {
    const probe = await bridgeFetch(obsidian.page, SMALL_PNG, { decode: true });

    expect(probe.error, `bridge fetch threw for ${SMALL_PNG}`).toBeNull();
    expect(probe.status, `bridge returned ${probe.status} for ${SMALL_PNG}`).toBe(200);
    expect(probe.contentType).toBe('image/png');
    expect(probe.byteLength, 'bridge served an empty body').toBeGreaterThan(0);

    // The real assertion: the bytes are a PNG a browser can DECODE. A bridge
    // that serves truncated / mis-sliced / mis-typed content still yields a
    // 200 with a plausible byte count; only a decode proves the payload.
    expect(probe.width, 'served PNG did not decode').toBeGreaterThan(0);
    expect(probe.height, 'served PNG did not decode').toBeGreaterThan(0);
  });

  test('a 2048px source is downscaled to the 1024px cap, not sent whole', async () => {
    const onRemote = await remote.stat(BIG_PNG);
    expect(onRemote, `${BIG_PNG} is missing from the remote`).not.toBeNull();

    const probe = await bridgeFetch(obsidian.page, BIG_PNG, { decode: true });
    expect(probe.error, `bridge fetch threw for ${BIG_PNG}`).toBeNull();
    expect(probe.status).toBe(200);

    // (a) The daemon actually resized: longer side lands exactly on the cap.
    expect(
      Math.max(probe.width, probe.height),
      `${BIG_PNG} is 2048x1536 on the remote; the bridge served ` +
      `${probe.width}x${probe.height}. getResourcePath asked for ` +
      `thumb=${THUMB_MAX_DIM}, so the longer side must come back at ` +
      `exactly ${THUMB_MAX_DIM}`,
    ).toBe(THUMB_MAX_DIM);

    // (b) …and the wire payload is genuinely smaller than the original.
    //
    // This half is the point of the test. `ResourceBridge.serveThumbnail`
    // catches ANY thumbnail failure, logs a warning, and returns false —
    // which falls through to `serveFullBinary` (ResourceBridge.ts:306-312).
    // The webview still gets a valid image, so nothing looks broken, while
    // every inline preview quietly drags the multi-MB original across the SSH
    // link. A dimension-only assertion would not see it (the original decodes
    // fine); a byte-count assertion does.
    expect(
      probe.byteLength,
      `the bridge sent ${probe.byteLength} B for a ${onRemote!.size} B source. ` +
      'That is the full original: the thumbnail RPC failed and ' +
      'serveThumbnail() swallowed it, falling back to the whole binary',
    ).toBeLessThan(onRemote!.size);
  });

  test('SVG renders via the full-binary path (no thumbnail)', async () => {
    // SVG is an image to the renderer but a UTF-8 document on disk, and it is
    // deliberately NOT in THUMBNAIL_EXTENSIONS (the daemon's image.Decode
    // cannot rasterise it). So it must take `serveFullBinary` and get its MIME
    // from `guessMimeType` — an `application/octet-stream` here means the
    // webview downloads it instead of drawing it.
    const url = await resourcePath(obsidian.page, SVG);
    expect(url, 'svg must not carry a thumb= hint — the daemon cannot decode it')
      .not.toContain('thumb=');

    const probe = await bridgeFetch(obsidian.page, SVG);
    expect(probe.error, `bridge fetch threw for ${SVG}`).toBeNull();
    expect(probe.status).toBe(200);
    expect(probe.contentType).toBe('image/svg+xml');
    expect(probe.byteLength, 'bridge served an empty SVG').toBeGreaterThan(0);
  });

  test('PDF is served as application/pdf and honours a Range request', async () => {
    const onRemote = await remote.stat(PDF);
    expect(onRemote, `${PDF} is missing from the remote`).not.toBeNull();

    // Obsidian's PDF viewer (pdf.js) does exactly this: it opens with a small
    // ranged read rather than pulling the whole document. A bridge that
    // answers 200-with-the-whole-file instead of 206 makes every PDF a
    // full-file download before the first page paints.
    const probe = await bridgeFetch(obsidian.page, PDF, { range: 'bytes=0-99' });

    expect(probe.error, `bridge fetch threw for ${PDF}`).toBeNull();
    expect(
      probe.status,
      `Range: bytes=0-99 returned ${probe.status}, not 206 — the bridge ignored ` +
      'the header and served the whole document',
    ).toBe(206);
    expect(probe.contentType).toBe('application/pdf');
    expect(probe.contentRange).toBe(`bytes 0-99/${onRemote!.size}`);
    expect(probe.byteLength, 'a 100-byte range must return exactly 100 bytes').toBe(100);
  });

  // ─── renderer level ──────────────────────────────────────────────────────

  test('embedded image in a root note renders (naturalWidth > 0)', async () => {
    await openInReadingView(obsidian.page, EMBED_NOTE);

    const img = obsidian.page.locator('.markdown-preview-view img').first();
    await expect(
      img,
      `${EMBED_NOTE} embeds ${SMALL_PNG} but the preview pane has no <img> at all — ` +
      'the wikilink never resolved to a TFile',
    ).toBeVisible({ timeout: RENDER_TIMEOUT_MS });

    const shot = await img.evaluate((el: HTMLImageElement) => ({
      src: el.src,
      naturalWidth: el.naturalWidth,
      naturalHeight: el.naturalHeight,
    }));

    // A broken bridge still renders the <img> TAG — it just never decodes.
    // naturalWidth is the only property that separates "Obsidian resolved the
    // embed" from "the pixels actually arrived".
    expect(
      shot.naturalWidth,
      `the embedded <img> (src=${shot.src}) never decoded — ResourceBridge did ` +
      'not deliver renderable bytes',
    ).toBeGreaterThan(0);
    expect(shot.naturalHeight).toBeGreaterThan(0);

    expect(
      shot.src,
      'the embed is not going through the ResourceBridge — a src that is not a ' +
      'bridge URL means the adapter handed Obsidian an app://local path for a ' +
      'file that only exists on the remote',
    ).toMatch(/^http:\/\/127\.0\.0\.1:/);
  });

  test('embedded image inside an UNEXPANDED subfolder renders', async () => {
    // PREDICTED FAIL — see the docblock. The connect walk is root-only, so
    // `<S>-sub/nested.png` is not in `vault.fileMap` and the wikilink cannot
    // resolve. Written at full strength: the correct behaviour is that an
    // embed renders regardless of whether the user has ever clicked the
    // folder open in the File Explorer.
    //
    // The vault-model probe is taken FIRST and folded into the failure
    // message, so the red says WHY (file absent from the model) rather than
    // just "no <img>". It is a DIAGNOSTIC, deliberately not an `expect` of its
    // own: asserting `getAbstractFileByPath(...) === null` would be encoding
    // the BUG as the expected behaviour, which is exactly backwards.
    const inModel = await inVaultModel(obsidian.page, NESTED_PNG);

    await openInReadingView(obsidian.page, SUBEMBED_NOTE);

    const img = obsidian.page.locator('.markdown-preview-view img').first();
    await expect(
      img,
      `${SUBEMBED_NOTE} embeds ${NESTED_PNG} but the preview pane has no <img>.\n` +
      `DIAGNOSTIC — app.vault.getAbstractFileByPath('${NESTED_PNG}') is ` +
      `${inModel ? 'a TFile' : 'null'}. If it is null, the cause is LAZY FOLDER ` +
      'LOADING: the connect populate walks the vault ROOT only, so nothing under ' +
      `${SUB_DIR}/ exists in vault.fileMap until the user clicks the folder open — ` +
      'and an unresolvable wikilink never reaches getResourcePath, so no bridge ' +
      'URL is ever minted. The fix is on the vault-model side, not the bridge.',
    ).toBeVisible({ timeout: RENDER_TIMEOUT_MS });

    const decoded = await img.evaluate((el: HTMLImageElement) => ({
      src: el.src,
      naturalWidth: el.naturalWidth,
      naturalHeight: el.naturalHeight,
    }));
    expect(
      decoded.naturalWidth,
      `the nested embed's <img> (src=${decoded.src}) never decoded`,
    ).toBeGreaterThan(0);
    expect(decoded.naturalHeight).toBeGreaterThan(0);
  });

  test('expanding the folder in File Explorer makes the embed render', async () => {
    // GENUINELY UNKNOWN, and that is the value: this is the question the
    // maintainer has to answer before fixing the previous test. Expanding the
    // folder is the user's own workaround — it drives the product's real hook
    // (a delegated click listener on `.nav-folder-title`, `main.ts:923-924`)
    // and inserts the folder's children into `vault.fileMap` via
    // `LazyFolderLoader`.
    //
    // If this PASSES, the lazy insert does re-resolve embeds and the fix for
    // test 5 is simply to make the model complete (walk deeper, or resolve the
    // embed's folder on demand). If it FAILS, Obsidian's metadata cache has
    // already parsed the note and does not re-resolve on a late insert, so the
    // fix must also invalidate metadata after a lazy load. Either way the run
    // reports something the code does not currently tell us.
    await expandFolderInExplorer(obsidian.page, SUB_DIR, RENDER_TIMEOUT_MS);

    await expect
      .poll(() => inVaultModel(obsidian.page, NESTED_PNG), {
        message:
          `expandFolderInExplorer("${SUB_DIR}") reported children in vault.fileMap ` +
          `but ${NESTED_PNG} itself is still not a TFile — the lazy load inserted ` +
          "something other than the folder's actual contents",
        timeout: RENDER_TIMEOUT_MS,
      })
      .toBe(true);

    // Bounce off the note and back so the preview is rendered AFTER the insert
    // — the question is whether a freshly-opened reading view resolves the
    // embed now that the target exists, not whether an already-painted pane
    // repaints itself.
    await openInReadingView(obsidian.page, EMBED_NOTE);
    await openInReadingView(obsidian.page, SUBEMBED_NOTE);

    const img = obsidian.page.locator('.markdown-preview-view img').first();
    await expect(
      img,
      `after expanding ${SUB_DIR} (so ${NESTED_PNG} IS in vault.fileMap), ` +
      `re-opening ${SUBEMBED_NOTE} still renders no <img>. Obsidian's metadata ` +
      'cache is not re-resolving the embed after a lazy folder insert — fixing ' +
      'the vault walk alone will not be enough.',
    ).toBeVisible({ timeout: RENDER_TIMEOUT_MS });

    const decoded = await img.evaluate((el: HTMLImageElement) => ({
      src: el.src,
      naturalWidth: el.naturalWidth,
    }));
    expect(
      decoded.naturalWidth,
      `the nested embed resolved (src=${decoded.src}) but never decoded — the ` +
      'lazy-inserted TFile reached getResourcePath, so this is a BRIDGE failure ' +
      'on the subfolder path, not a vault-model one',
    ).toBeGreaterThan(0);
  });

  // ─── cache coherence: mutates SMALL_PNG, so it runs last ──────────────────

  test('a remotely-REPLACED image is not served from a stale generation', async () => {
    // Warm every cache in the chain (adapter ReadCache, bridge mtime cache,
    // daemon thumbnail path) on the ORIGINAL 640x480 bytes.
    const before = await bridgeFetch(obsidian.page, SMALL_PNG, { decode: true });
    expect(before.error, `bridge fetch threw for ${SMALL_PNG}`).toBeNull();
    expect(before.status).toBe(200);
    expect(
      before.width,
      'the 640x480 fixture did not come back at its own size — it is under the ' +
      `${THUMB_MAX_DIM} cap, so the resize must be a no-op`,
    ).toBe(640);
    expect(before.height).toBe(480);

    // Replace it out-of-band, at a DIFFERENT size. Different dimensions —
    // rather than different pixels at the same size — make staleness provable
    // from the decoded bitmap alone: no byte comparison, no ambiguity about
    // whether a resize re-encoded the payload.
    await remote.writeBinaryFile(SMALL_PNG, makePng(300, 200));

    await expect
      .poll(
        async () => {
          const p = await bridgeFetch(obsidian.page, SMALL_PNG, { decode: true });
          return `${p.width}x${p.height}`;
        },
        {
          message:
            `${SMALL_PNG} was replaced on the remote with a 300x200 image, but the ` +
            'bridge keeps serving the 640x480 generation. Something in the chain — ' +
            'the adapter ReadCache, the bridge mtime cache, or the daemon thumbnail ' +
            'path — is not being invalidated by the watch event, so the user is ' +
            'looking at an image that no longer exists on the remote.',
          timeout: BRIDGE_TIMEOUT_MS,
        },
      )
      .toBe('300x200');
  });
});

// ─── helpers ──────────────────────────────────────────────────────────────

interface BridgeProbe {
  url: string;
  /** HTTP status, or -1 if `fetch` itself threw (see `error`). */
  status: number;
  contentType: string | null;
  contentRange: string | null;
  byteLength: number;
  /** Decoded bitmap size; -1 when `decode` was not requested or the fetch failed. */
  width: number;
  height: number;
  error: string | null;
}

/** `app.vault.adapter.getResourcePath(p)` as the webview would call it. */
async function resourcePath(page: Page, vaultPath: string): Promise<string> {
  return page.evaluate((p) => {
    const adapter = (window as unknown as {
      app?: { vault?: { adapter?: { getResourcePath?: (path: string) => string } } };
    }).app?.vault?.adapter;
    if (!adapter?.getResourcePath) {
      throw new Error(
        'app.vault.adapter.getResourcePath is missing — the adapter was never ' +
        'patched, so this window is not talking to the remote',
      );
    }
    return adapter.getResourcePath(p);
  }, vaultPath);
}

/**
 * Fetch a vault asset THROUGH the bridge, from inside the Obsidian renderer —
 * i.e. exactly the request an `<img>` / `<iframe>` makes. Done in-page rather
 * than from Node on purpose: the port and the token are per-session secrets
 * that only `getResourcePath` knows, and a Node-side fetch would bypass the
 * webview's own origin handling and prove less.
 *
 * `decode: true` additionally runs the body through `createImageBitmap`, which
 * is the only way to assert on what the user actually SEES (dimensions) as
 * opposed to what the server claimed to send.
 */
async function bridgeFetch(
  page: Page,
  vaultPath: string,
  opts: { range?: string; decode?: boolean } = {},
): Promise<BridgeProbe> {
  return page.evaluate(
    async ({ p, range, decode }) => {
      const fail = (failedUrl: string, error: string) => ({
        url: failedUrl,
        status: -1,
        contentType: null as string | null,
        contentRange: null as string | null,
        byteLength: -1,
        width: -1,
        height: -1,
        error,
      });

      const adapter = (window as unknown as {
        app?: { vault?: { adapter?: { getResourcePath?: (path: string) => string } } };
      }).app?.vault?.adapter;
      if (!adapter?.getResourcePath) {
        return fail('', 'app.vault.adapter.getResourcePath is missing');
      }

      const url = adapter.getResourcePath(p);
      if (url.startsWith('data:')) {
        return fail(
          url,
          'getResourcePath returned a data: URL — the ResourceBridge is not running',
        );
      }

      try {
        const res = await fetch(url, range ? { headers: { Range: range } } : undefined);
        const body = await res.arrayBuffer();
        let width = -1;
        let height = -1;
        if (decode && res.ok) {
          const type = res.headers.get('content-type') ?? '';
          const bitmap = await createImageBitmap(new Blob([body], { type }));
          width = bitmap.width;
          height = bitmap.height;
          bitmap.close();
        }
        return {
          url,
          status: res.status,
          contentType: res.headers.get('content-type'),
          contentRange: res.headers.get('content-range'),
          byteLength: body.byteLength,
          width,
          height,
          error: null as string | null,
        };
      } catch (e) {
        return fail(url, String(e));
      }
    },
    { p: vaultPath, range: opts.range ?? null, decode: opts.decode ?? false },
  );
}

/** Is `vaultPath` a real entry in Obsidian's vault model? */
async function inVaultModel(page: Page, vaultPath: string): Promise<boolean> {
  return page.evaluate((p) => {
    const vault = (window as unknown as {
      app?: { vault?: { getAbstractFileByPath?: (path: string) => unknown } };
    }).app?.vault;
    return vault?.getAbstractFileByPath?.(p) != null;
  }, vaultPath);
}

/**
 * Open a note and make sure the READING view is the one on screen.
 *
 * Obsidian's default mode is Live Preview — a CodeMirror editing mode in which
 * `.markdown-preview-view` does not exist at all, so an assertion against it
 * times out as "element(s) not found" no matter how healthy ResourceBridge is
 * (`reflect.spec.ts:210-218` documents exactly this misdiagnosis). Hence the
 * explicit toggle.
 *
 * `Toggle reading view` is a TOGGLE, and the mode sticks to the leaf: blindly
 * running it on every open would flip a note that is already in reading view
 * straight back to editing. So the command only fires when the preview pane is
 * not already up.
 */
async function openInReadingView(page: Page, notePath: string): Promise<void> {
  const nav = page.locator(`.nav-file-title[data-path="${notePath}"]`);
  await expect(
    nav,
    `${notePath} is not in the File Explorer — the connect walk never ` +
    'materialised it, so there is nothing to open',
  ).toBeVisible({ timeout: RENDER_TIMEOUT_MS });
  await nav.click();

  const preview = page.locator('.markdown-preview-view').first();
  const alreadyReading = await preview
    .isVisible({ timeout: 2_000 })
    .catch(() => false);
  if (!alreadyReading) {
    await runCommandViaPalette(page, 'Toggle reading view');
  }

  await expect(
    preview,
    `${notePath} never entered reading view — no .markdown-preview-view appeared`,
  ).toBeVisible({ timeout: RENDER_TIMEOUT_MS });
}
