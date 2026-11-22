# Frontend review

Checked the hosted page (`web/index.html`, `web/app.js`, `web/chain.js`, `web/frame.js`) and the on-chain fallback (`web/fallback-shell.html`, `web/fall.js`, built to `web/page.html`). The issue classes are an untrusted call, missing checks on what the user sends, trusting a single RPC answer, clickjacking, and a control that fires a transaction the user did not mean to send.

## Calls

The page sends a transaction only from `OnPlate.send`. The selector is hashed from the signature string and compared with the `WANT` table before anything is submitted. A mismatch throws. Chunk creates have no `to`. Their data has to start with the creation bytecode in `web/bytecode.js`, and `value` is `0x0`. `buy` sends the wei value read from `listedPrice` after a second read. The page has no field for a wei amount.

`addPhoto` goes to the factory from `factoryOf`. `list`, `cancel`, `setMailbox`, `release`, `clearMailbox`, and `withdraw` go to a plate that `pinPlate` has checked: `photoAt`, `isPhoto`, and `plateId` agree. A URL cannot replace the mainnet or Sepolia factory. Both are empty strings until a real deployment is written into `web/chain.js`. Anvil accepts `?chain=anvil&factory=0x...` only when the host is `localhost` or `127.0.0.1`. The chain buttons drop the factory query on mainnet and Sepolia.

The fallback page has no `eth_sendTransaction`, no `eth_sign`, and no `innerHTML`. `script/selfcheck.js` asserts those. It also checks that the inlined script does not contain the string `</script>`.

## What the page trusts

Public chains ask two endpoints and keep a value only when they agree. Anvil asks its one endpoint. A failed read throws and the page shows `the chain did not answer.` A hash mismatch on a reassembled file tries the next endpoint's `eth_getCode`. A file that still mismatches is not offered for sale.

The buy button uses the price from that agreed read. After the wallet confirms, the page reads `listedPrice` again and aborts if it moved.

Text from the chain is passed through `plain()` before it is shown. Images are blob URLs. `sniff` accepts jpeg, png, gif, and webp. Anything else, including SVG, is not rendered as an image. The page writes with `textContent`.

Vault input is checksummed. Mixed-case input has to match EIP-55. The zero address, the plate, the title, and the factory are rejected. The first confirm shows the address and says a wrong vault stays until that address calls `release`. The second confirm sends `setMailbox`. `release` has no destination argument.

The dev percent is the factory's `devBps`. The field is filled from the chain and cannot be edited. The artist percent starts at `defaultArtistBps` and can be changed before registering. `prepare` sends the on-chain dev share. The parser allows two decimal places on the artist field. The sum of the two shares has to be at most 10,000.

List, Buy, Park, and the listing and return controls are drawn only when the row is bound to `factoryOf` for the current chain and `pinPlate` agrees. The factory address stays on screen as "Contract". The plate address is labeled "Plate". An address that is not that plate does not get those controls.

Upload is one click per chunk, then one click to register. The plan is stored in IndexedDB before the first send and is what a reload offers to continue. The submission section shows how many contracts the file was split into and how many are deployed. Before a later chunk is sent, the page reads the base fee and, if it is more than half a step above the first chunk in that set, shows a waiting line until the fee falls. That line clears when the next contract is sent. A failed chunk is marked on its own row and can be retried. The buttons do nothing while a send is in progress. Disconnect writes `onplate-off` and is the only writer of that flag. A reload stays disconnected. Load uses `eth_accounts`. It does not call `eth_requestAccounts` and it does not send a transaction. No query parameter starts a send.

There is no HTML form. `setAuthorized` is not in the page. The owner does that with `cast`.

The photograph loop stops at 100. A large `photoCount` cannot walk the whole list in the browser.

## Clickjacking

`web/frame.js` runs first. If `window.top !== window.self` it clears the document and leaves the page blank. `html` stays `display: none` until that script adds `on`. `app.js` checks again. The fallback shell does the same with an inline script at the top, then `fall.js` checks again. The fallback is opened as a saved file. Serving it from the hosted origin would hit `script-src 'self'`, so `script/serve.js --open` skips CSP when the fallback is being read locally.

`web/_headers`, applied by `script/serve.js`, sets `X-Frame-Options: DENY`, `Content-Security-Policy` with `frame-ancestors 'none'`, `base-uri 'none'`, `form-action 'none'`, `object-src 'none'`, `script-src 'self'`, `style-src 'self'`, `img-src 'self' blob:`, and `connect-src` limited to self, https, and the Anvil host, plus `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. A meta tag cannot set `frame-ancestors`. The hosted page has no inline script, so `script-src 'self'` holds.

## Cache

IndexedDB database `onplate`, store `photos`. The image key is `chainId:plate:1` with the address in lowercase. The index key is `chainId:factory:index`. A hit paints the file and skips chunk reads. The hosted page still reads price and vault. If that read fails, the cached image stays up and the buy button stays off. The fallback, with a cached index, paints those photographs and skips RPC until Look again. If the factory read fails, the cached photographs stay and the quiet line shows.

## Browser pass

Playwright's Chrome binary was missing at `/opt/google/chrome/chrome`. The pass used the Chromium already cached for Playwright, through `playwright-core`. No wallet extension was attached. Signing was not exercised in the browser. `script/anvil-flow.js` drove the same transactions against Anvil from Node and finished `ANVIL_OK`.

Against a local Anvil factory and plate:

- Desktop and a 390×844 viewport both showed the chaise photograph, the 48×48 thumbnail, the content hash, the royalty lines, the title and the holder, and the not-listed state. The narrow viewport did not scroll sideways. There was no form.
- Prepare on `art/chaise.jpg` reported 12 pieces and hash `0xb1359e13e608e0c357be6c848f8c3d3e270f31b9352d9ed6b20e39c46c911aab`. Store piece 1 with no wallet sent no transaction and said Connect.
- `?chain=mainnet&factory=0x1111…1111` showed "No factory is set for this chain." and made no RPC to that address.
- An iframe of the hosted page was blocked.
- Aborting `127.0.0.1:8545` on a cold load showed `the chain did not answer.`
- After a good load the IndexedDB keys were the factory index and the plate image. Reloading with the RPC aborted still showed Chaise and the image, the quiet line, and no buy button.
- The fallback page showed Chaise, the description, the plate, the hash, the reassembled photograph, and Look again. It had no form and no buy control.

One prepare bug turned up in that pass. `thumbOf` closed the `ImageBitmap` before reading its width and height, so the encoder was called with 0, 0. Width and height are read first now. Prepare then reported the 12 pieces.

## Left as they are

A browser JPEG decode can differ by about one gray level from Pillow. The PNG step is fixed for a given RGB buffer. `art/thumb.png` is the committed thumbnail. The Anvil flow rebuilt it from `art/chaise.rgb` and matched those bytes.

`refresh()` on the hosted page does not return its promise. The status line can update while the read is still going. The busy flag is cleared first. That is a display race, not a send path.

The page reads at most 100 photographs.

Sepolia was not opened in the browser. No factory is set for it.
