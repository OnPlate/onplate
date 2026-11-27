# OnPlate

OnPlate is a factory for 1/1 on-chain photographs. Each photograph is its own ERC-721. The symbol is PLATE. The token id is 1. The full file sits in one or more chunk contracts on the same chain. Nothing in that file is stored on IPFS or a private server. The photograph contract stores the keccak256 of that file, the chunk list, the royalty terms, a small PNG, and the vault state.

The factory starts empty. The current owner can add a photograph of up to 1,150 pieces. An address on the upload whitelist can do the same. Any other address can add a photograph of at most 4 pieces. Four full pieces are 73,728 bytes. Five full pieces need 18,432,000 gas of code deposit alone on the Osaka schedule, which is over the 16,777,216 gas cap. A later whitelist does not change a plate that was already registered. Large files are whitelisted by the factory owner with `setAuthorized`. The hosted page does not send that call.

Ownership can be transferred with `transferOwnership`. `renounceOwnership` reverts `Hook`. Ownership controls the developer-fee recipient (`setDevRecipient`), the upload whitelist (`setAuthorized`), and the on-chain fallback page (`setPage`). Transfer itself changes none of those, and it does not change a photograph. The whitelist only decides who may call `addPhoto` later. Replacing the page only changes which page contract the factory points at. Store the file, then register. Sales split 3% developer and 7% artist.

Solidity 0.8.37, optimizer on, 200 runs, via IR on, EVM osaka. Via IR is on because the photograph constructor's argument list does not compile with it off. A full chunk is 18,432 bytes of image and 18,433 bytes of code. The local chain uses the Osaka schedule: code deposit stays 200 gas per byte, the block gas limit is 60,000,000, and one transaction cannot ask for more than 16,777,216 gas. Four full pieces fit in one `ChunkBatch` call. A direct create of one full piece estimates about 4,050,169 gas.

Sepolia is already on a later schedule. Putting a piece on chain is mostly new contract code. That bill is about 1,530 gas per byte instead of 200. A live `eth_estimateGas` of one full `PlateChunk` create returned 28,730,342. The 16,777,216 cap there is execution only. The extra is state gas for that new code. The page, the host sender, and `Upload.s.sol` pass the estimate on Sepolia. They still refuse a total over 16,777,216 on Osaka and on mainnet. `script/ProbeGas.s.sol` is the fork probe. `gasleft()` inside the script is the wrapper, not the transaction.

Deploy scripts revert on chain id 1. Mainnet waits for the words DEPLOY MAINNET.

## Deploy the factory

From this directory, with Foundry:

```bash
forge script script/DeployFactory.s.sol --rpc-url "$RPC" --account onplate --sender "$SENDER" --broadcast --gas-estimate-multiplier 100
```

Set `SENDER` to the public address of the broadcasting key. The script uses that address only to predict the factory. It does not read a private key. It deploys the plate creator, the book creator, and the factory. The factory does not contain the photograph or book creation code. The factory runtime stays under 16,000 bytes, and the plate creator is larger, so creation still lives in the deployer. 16,000 × 1,530 still fits a 30,000,000 gas block. The script checks that the deployed factory is the predicted address. Pass `--gas-estimate-multiplier 100` on that schedule. The default multiplier asks for more gas than the block allows.

The broadcasting key becomes the factory owner. `devRecipient` starts as that same address. `setDevRecipient` can point later photographs at a different address. A photograph already created keeps the recipient copied at creation. The script prints the factory address.

On chain id 1 the script uses 300 dev bps and 700 artist bps and then reverts before it broadcasts. It does not read the environment on that chain. On any other chain, including a local Anvil and Sepolia, it reads `ONPLATE_DEV_BPS` and `ONPLATE_ARTIST_BPS`. Those default to 300 and 700. Each share has to be at most 10,000, and the sum of the two has to be at most 10,000. `script/anvil.sh` also uses 300/700. Do not run it against Sepolia or against a local node that is already running.

`script/anvil.sh` does this on a local chain at `http://127.0.0.1:8545`, chain id 31337, then builds the page and authorizes Anvil account 1. It signs with Anvil's unlocked account 0. It exits if port 8545 is already taken.

Sepolia is live. `script/DeploySepolia.s.sol` deploys the plate creator, the book creator, the factory, the piece helper, and the fallback page on chain id 11155111. It refuses every other chain. Build `web/page.html` first with the predicted factory address. The factory is `0x851eafe44d877D8A112eafb1cAF2A31Aca0d60CF`. The piece helper is `0xc623d30639239485114dD20B0dC6D98E342cfd0d`. The fallback page is `0xf85DaAD527806199D6B3bBFb04164ddD6BE95C32`. The owner is the onplate keystore `0x5DFad8be4d579b9Abb9C6A7a6FD957502b06F823`. Developer share is 300 bps. Default artist share is 700 bps. The factory starts empty. This factory has no nomination functions. Parking remains as added security for a mounted photograph.

## The page

The hosted studio is https://onplate.github.io/onplate/. With no chain in the address it uses Sepolia while the mainnet factory is empty. A local copy is `http://127.0.0.1:8765/`. Anvil still needs `?chain=anvil&factory=0x...` on localhost.

The fallback page is one HTML file, at most 18,432 bytes, stored as chunk bytecode.

```bash
node script/build-fallback.js --chain sepolia --factory 0xFACTORY
FACTORY=0xFACTORY forge script script/DeployPage.s.sol --rpc-url "$RPC" --account onplate --sender "$SENDER" --broadcast --gas-estimate-multiplier 100
```

A local chain uses `--chain anvil` in that build.

`build-fallback.js` writes `web/page.html` (gitignored) with the factory address and the chain name filled in. `DeployPage` deploys `PlatePage` and calls `setPage`. The HTML must contain the factory address. `setPage` calls `factory()` on the page and requires that call to return this factory. The owner can call `setPage` again. The previous page contract stays on-chain and is no longer the factory's page. `PlatePage` rejects empty HTML and HTML longer than 18,432 bytes. `setPage` does not write a photograph.

`page()` on the page contract returns the HTML. `page()` on the factory returns the page contract's address. Save the HTML and open the file. The page lists photographs and reassembles each file in the browser. It has a Look again button. It has no list, buy, park, or upload controls.

## Authorize an artist

The factory owner can authorize any address:

```bash
cast send $FACTORY "setAuthorized(address,bool)" $ARTIST true --rpc-url "$RPC" --account onplate
```

The zero address and the factory itself are rejected. The owner can add a photograph without being in the authorized list. Setting the flag does not change a photograph already registered. Removing an address stops that address from opening or finishing a book above 4 pieces. A book of 4 pieces that is already open can still be finished. The hosted page does not send `setAuthorized`. An artist who wants a file larger than 4 pieces sends only the Foundry keystore’s 0x address in a direct message on X to @A_is_A.

The hosted page asks before store, register, buy, list, park, and withdraw. Cancel sends nothing. After the transaction is mined, the page says so in one sentence.

## Upload

The hosted About page is `web/index.html`. The studio is `web/add.html`. Serve the `web/` directory as static files. `script/serve.js` does that and applies `web/_headers`.

An artist drops a photograph on the page, or clicks the same area to choose a file. The page reads the file locally, searches JPEG quality and scale for a packed copy that still looks like the original (likeness 88 by default), and shows the two side by side. One slider is a veto. Use original is always available. The chosen file is the one stored on-chain. The page splits that file into pieces of 18,432 bytes, hashes it, and builds a 48×48 grayscale PNG. Nothing is posted to a server. Prepare saves that plan in the browser. Nothing is sent until a piece is stored. The artwork name, the description, and the optional artist name are stored on the plate. A blank artist name stays anonymous. View groups photographs by the artist wallet that prepared them, the book's origin. The keystore that stored and registered a photograph is shown on the card when it differs from that wallet. Each plate keeps the name stored on that plate. The artist menu lists every name that address has used. An account that is not on the whitelist is stopped before a send when the photograph is larger than 4 pieces.

Store the file, then register it. Park, buy, list, burn, and restore stay on the plate and the factory. Restore of a burned list stays on the factory path. Parking is added security for a mounted photograph: the title names a vault, and that vault can only send the token home.

On every chain, including this local Anvil, Store every piece calls `ChunkBatch.createPieces`. The caller sends one transaction per group, and each group asks the wallet. The contract creates that many `PlateChunk` contracts and, in the same transaction, returns any ETH the caller attached. Gas is paid by the caller in the normal way. Attaching ETH is optional, and the usual call sends none. The page holds no key. The group size is however many pieces `eth_estimateGas` says will fit, and never more than `STORE_GROUP_MAX` (16). That constant is a page and script knob. It is not `OPEN_MAX`. Raising it does not change the per-byte storage bill. On Osaka and on mainnet a group whose total is above 16,777,216 gas is refused. On Sepolia the page passes the estimate, which may sit above that number so new contract code can be paid as state gas. On Osaka Anvil one full piece through the helper estimates 4,115,033 gas and four full pieces estimate 16,232,847, so the group size is four. Five full pieces estimate 20,274,811 and do not fit. After Prepare the page states that count, the store transactions, and the linking transactions. Linking stays a separate step. A photograph of at most 4 pieces, with no book opened yet, uses one linking transaction. If a helper call creates only some of the pieces it was given, the page says how many landed and which piece numbers still need to be sent, and the stored count is the number whose code matched. Store next piece still sends one piece from the wallet and does not register the photograph.

A photograph of at most 4 pieces, when no book is open yet and the factory code contains `linkPhoto`, asks the wallet once. A whitelisted signer, the owner, or a restoring origin may use that same call for a larger photograph of at most `appendMax` pieces (80 on this factory). An older factory still uses four calls. A larger photograph above that batch, or one that already has a book, still asks once for each linking transaction: open the book, add chunk addresses (at most `appendMax` per transaction), seal the book, and add the photograph. Buy, list, and the other plate calls ask the wallet as well.

`web/chain.js` can still ask the local node to send a piece create or a linking call as the connected account. A test sets that flag itself. The buttons on the page do not. The flag is refused unless the chain is Anvil, the node URL is `http://127.0.0.1:8545` or localhost over `http`, and the call is one of those kinds.

A large photograph can be sent with `script/upload-host.js` from a git clone of this repository. The page does not download that script. Check the file against the git commit you cloned. A hash printed beside a download is not a check. The script contains no key. The photograph stays in ordinary process memory, so a 117-piece file does not run out of EVM memory. The artist names a Foundry keystore (`~/.foundry/keystores/onplate` by default, or `--keystore` with the full path). `SENDER` is that keystore's 0x address. `OWNER` is the wallet that will own the photograph. When `OWNER` is omitted it is `SENDER`, so a wallet that signs for itself is unchanged. When `OWNER` is a different address, the keystore signs and pays, and the same registration names that wallet as the title and the origin. There is no second transfer. Do not set the Unix `HOME` directory to an Ethereum address. An older copied command that set `HOME` to a 0x address is still read as the owner. The factory has to be one that accepts `openBook(uint256,address)` or `linkPhoto` with a home argument. An older factory stops before anything is sent. `ARTIST` stays the royalty recipient and is not the owner. The first run prints the content hash, the piece count, and the factory address, then stops. That check does not unlock the keystore. Set `CONFIRM` to that hash and run the same command again with `--broadcast` to send. If `CONFIRM` does not match, nothing is sent. The send asks for the keystore password once on a TTY, decrypts the keystore in process memory, and stores every remaining group in that same process. Do not pass `--password`, `--password-file`, or a private key, and do not put the password in an environment variable. If stdin is not a TTY, the check has already worked and the script prints one command to copy into a new terminal window. The script calls only `createPieces` and the factory, and it attaches no ETH. When no book is open and the piece count is at most `openMax`, or the signer `canAdd` and the count is at most `appendMax`, it calls `linkPhoto` once and saves the plate. Otherwise it calls `openBook`, `addChunks`, `sealBook`, and `addPhoto`. The photograph has to sit under `art/`, `web/`, or `testing images/`. The thumbnail is a separate PNG of 32×32 or 48×48, 8-bit gray or truecolor, from 29 to 4,096 bytes. It is the file the browser saved, usually in Downloads. The script reads only the photograph and the thumbnail. The script does not decode a JPEG. `broadcast/upload-progress.json` records the chunk addresses, the book, the plate, the signer, and the owner. It holds no key. A later run skips pieces that still have code and that this sender stored through `ChunkBatch`. An address in that file with no code is stored again. If a group is mined and public nodes have not shown its code yet, the script keeps those addresses and prints that the same command continues the photograph. That line is not a failed photograph. Empty code from two lagging nodes is not treated as agreement. A raw `PlateChunk` create has no maker and is refused. A file for a different owner stops before anything is sent. Before `linkPhoto` or `addPhoto` the sender re-reads live code, `maker`, and `liveWork` for that address list. On Sepolia it reads two public endpoints and keeps a value only when they agree. It refuses chain id 1. Run one upload at a time: do not store from the page while the script is sending, and do not start a second send in another terminal. `script/Upload.s.sol` is still in the repository. The copied command uses the host sender.

On Osaka Anvil a 1,102-piece photograph is 276 store transactions of four pieces and 17 linking transactions. The page asks the wallet once for each of those. The script sends them from the keystore, so the wallet is not asked 293 times. MetaMask still confirms one group at a time when the artist uses the page.

After Prepare, the page keeps Store every piece, Store next piece, and Register. A short line under the photograph gives the piece count, the estimate, and the store and linking counts. The longer explanation stays in Details, which is closed until opened. Agent / script is closed until opened. After Prepare, Copy agent prompt copies one set of instructions and downloads `onplate-upload.zip` with `prompt.txt`, the JPEG named in IMAGE, and `upload-thumb.png`. The same prompt installs Foundry and creates the onplate keystore when they are missing, then stores this photograph. The node command inside it is the check command: it has no `--broadcast`. A packed file name ends with -closer.jpg or -one-store.jpg. The agent puts that photograph at IMAGE and sets THUMB to the unzipped thumbnail. SENDER must be the 0x address of the onplate keystore. If the agent already knows that address, it uses it. It does not run `cast wallet address` and does not decrypt the keystore to look the address up. If it does not know the address, it asks only for that 0x address. OWNER and ARTIST stay as written. After the printed hash matches CONFIRM, the agent runs the same command with `--broadcast` added. The password is typed once in the agent's terminal for that send. That one send stores every remaining group and registers the photograph. If the send prints that the chain stored this group and to run the same command again, the agent runs that same `--broadcast` command. IMAGE and CONFIRM stay as written. The command has no key. The page does not install Foundry, create a keystore, or run the sender.

The connected address is shown as 0x plus the first four and last four characters. The footer Contracts heading sits above the factory and batch lines. Chain choice stays in the page address. Sepolia's factory is in `web/chain.js`. Mainnet has no factory on this page yet. Recipient ignores spaces and format characters, including a zero-width space copied from an older display of that address. The top of the submission page stays blank until an action needs a sentence. The on-chain fallback page still says that no photographs are listed when the factory is empty.

The creation data is the bytecode from `web/bytecode.js` (`node script/bytecode.js` refreshes it from `forge inspect`) plus the ABI-encoded bytes. For at most 4 pieces and no open book, Register calls `linkPhoto` once. Otherwise it opens a chunk book, writes the chunk addresses in batches, locks that list, and calls `addPhoto`. The plate stores the book address. It does not copy the image bytes. The artist confirms each linking transaction. The page sends those transactions through the wallet.

`ChunkBatch` is not the factory. The factory address does not change when the helper is deployed. On Anvil the helper address is in `web/chain.js`, and `?batch=` on `localhost` or `127.0.0.1` overrides it. The Sepolia helper is in `web/chain.js`. Mainnet stays empty until a deployment is written there. If a public chain has no helper, Store every piece says so and does not fall back to a key.

Name is 1 to 48 characters. Description is 0 to 240. The allowed characters are printable ASCII except `"`, `\`, `<`, `>`, and `&`. The content hash is the keccak256 of the file bytes in order. The contract stores the hash the artist sends. A reader reassembles the chunks and checks the hash.

On Anvil the page address is passed as `?chain=anvil&factory=0x...` and only while the page is opened on `localhost` or `127.0.0.1`. The public studio is https://onplate.github.io/onplate/. On Sepolia the factory address is in `web/chain.js`. A query string cannot replace it. On mainnet that field stays empty until a deployment is written there.

## Royalties

The developer share is fixed on the factory at deployment. `addPhoto` has to pass that same dev share. A different value reverts `Royalty` on the factory. The artist share is chosen per photograph. Both shares are stored on the plate as immutable basis points. 10,000 is 100%. Each share is at most 10,000. The sum is at most 10,000. There is no setter after the photograph exists.

The dev recipient is `factory.devRecipient()` at the moment the photograph is created. It is not an argument, and a later change of owner or of `devRecipient` does not rewrite it. It starts as the deployer. The zero address and the factory itself are rejected by `setDevRecipient`. The hosted page fills the dev field from `devBps()` and does not let it be edited. The artist field starts at `defaultArtistBps()`. The registering title holder can change that percent, including to 0, before registering. A zero artist share may name the zero address. The plate contract itself cannot be the artist recipient. Mainnet's fixed pair is 300 and 700.

On a sale the contract credits `price * bps / 10000` to each recipient and the remainder to the seller. Rounding dust stays with the seller. Each address withdraws its own credit with `withdraw()`. The contract sends that call's ETH only to `msg.sender`. ETH that reaches a plate outside a sale, including a force-fed balance, stays in that contract. `withdraw` pays only credited sale proceeds.

## Purchase

The title holder calls `list(ask)` with a price above zero. The token has to be in the title holder's hand. A second `list` replaces the price. `cancel()` clears the price. `buy()` reverts unless `msg.value` equals the listed price. In that transaction the contract clears the price, credits the three shares, and moves the token to the buyer. The buyer becomes the title holder. The contract does not call the buyer during the move. Short payment and overpayment both revert. Buying your own listing reverts.

`setAllowedBuyer` names the only address that may buy, replaces that address, or clears it when passed the zero address. The price is left as it is. While a buyer is named, every other address reverts `NotBuyer`. While the photograph is parked, naming, replacing, or clearing that address reverts, and `cancel()` reverts the same way. After a sale the previous title holder cannot list or name a buyer. A successful `buy` clears the named buyer so the new title starts with a public listing. `cancel()` leaves the named buyer, because the title did not change. Parking clears it.

`transferFrom`, `safeTransferFrom`, `approve`, and `setApprovalForAll` revert. There is no bidding.

## Vaulting

`setMailbox(vault)` names a vault and parks the token there in the same call. The caller has to be the title holder and has to be holding the token. The zero address, the photograph contract, and the title holder are rejected. While the vault holds the token, `parked()` is true. Parking is added security for a mounted photograph. The only move is `release()`, and only the vault can call it. `burn` reverts while the photograph is parked, for the title holder and for the vault. The title holder burns only after `release` has brought the token home. `release()` sends the token to the title holder and clears the vault name so a later park can name a different address. `clearMailbox()` still works while the title holder is holding the token.

Parking clears a listed price and the named buyer. `cancel()` while parked reverts. A later `buy` reverts `NotListed` until the title holder lists again. After `release` the price stays off and the named buyer stays cleared. A sale while the title holder is holding the token clears the vault name, so the buyer does not inherit it. A vault address that cannot call `release` holds the token until that address does, and title stays frozen. The hosted page also rejects the factory as a vault, asks twice, and shows the address in the first confirm. That confirm says a vault that cannot call release freezes title forever. List, Buy, and Park are shown only when the plate is the one `photoAt` and `isPhoto` name for the factory of the current chain. The factory address stays on screen.

## Chunks

`PlateChunk` stores `0x00` followed by the image bytes as its runtime code. The first byte is STOP, so a call returns immediately. Readers use `EXTCODECOPY` or `eth_getCode` and drop the first byte. `readChunk` on the photograph does that copy. It does not call the chunk.

A chunk is 1 to 18,432 bytes. A photograph takes 1 to 1,150 chunks. The addresses are stored in a `ChunkBook`, not the image bytes. The factory asks the book creator to deploy that book and the plate creator to deploy the photograph. Pieces created through `ChunkBatch` record the paying wallet. A first registration of that address list has to be signed by that wallet. Another account cannot register those addresses. A restore of a burned list is signed by the origin. An origin burn ends restorability of that ordered address list. The chunks stay readable. That list cannot be registered again. An empty count, a duplicate, the zero address, the book, the factory, and a contract whose first byte is not `0x00` all revert `BadChunk`. One `addChunks` call takes at most 80 addresses, which is what fits in a 30,000,000 gas block under the Amsterdam storage price. `ChunkBatch.createPieces` is all-or-nothing: a group that cannot finish reverts, and no piece from that call is kept.

A photograph that uses more than one chunk contract is still stored in transactions that fit in one block and in the 16,777,216 gas transaction cap. On this Osaka chain that is four full pieces through `ChunkBatch`. A direct create is still one piece. On the old Amsterdam schedule a full piece used nearly the whole 30,000,000 gas block, so the group size there was one. Before each of those transactions the client reads the next block's base fee. The first contract's block sets the fee for the set. If the next fee is more than half an EIP-1559 step (6.25 percent) above that, the client waits, shows that it is waiting, and checks again until the fee is back within that step. The waiting line clears when the next contract is sent. On local Anvil the wait mines empty blocks so the fee can fall. Each chunk transaction sets its gas limit from the estimate plus one sixty-fourth, and not above the block gas limit. The next chunk is not sent until the previous one is included.

Before any of those contracts is sent, the page writes a plan in IndexedDB (`onplate`, object store `plans`) keyed by the image content hash. `script/anvil-flow.js` uses the same plan functions and stores that record in `script/anvil-plan.json`, which is local state and is not committed. The plan holds the hash, each chunk hash and its constructor bytes, the status of each chunk (`pending`, `submitted`, `mined`, or `failed`), the transaction hash and contract address once known, the factory, the chunk book once it is opened, the plate once the photograph is registered, and the photograph id expected from the factory count at the time the plan was saved. A reload shows the saved upload, how many pieces are already stored, Continue previous upload, and Abandon. Continue starts at the first pending or failed chunk and does not send a chunk whose code is already on-chain. One chunk can fail on its own and be retried. Abandon asks before it deletes the saved plan. Deployed contracts stay unlinked and cannot be resumed. The waiting line reads “Waiting for gas to settle.” The photograph transaction is sent only after every chunk is mined.

To reassemble: read `chunkCount`, then `chunkAt` from 0 upward, copy each code body after the STOP byte, concatenate, and compare `keccak256` with `contentHash()`.

## tokenURI and the thumbnail

`tokenURI(1)` returns `data:application/json;base64,` plus the base64 of JSON with `name`, `description`, `content_hash`, and `image`. `image` is `data:image/png;base64,` plus the thumbnail. The full photograph stays in the chunks.

The thumbnail is a PNG, 32×32 or 48×48, 8-bit gray or truecolor, no interlace, at most 4,096 bytes. The contract checks the signature and the IHDR. It does not decode the pixels.

The page builds the thumbnail at registration. Luminance is `(77*R + 150*G + 29*B) >> 8`. An integer box average reduces that to 48×48. The PNG is grayscale, filter none, zlib stored blocks. The same RGB bytes always produce the same PNG. `art/chaise.jpg` is the test photograph. `art/thumb.png` is the 48×48 thumbnail made from it. `node script/make-thumb.js` rebuilds the PNG from `art/chaise.rgb`. A browser's JPEG decode can differ by about one level from another decoder. The reduction of a given RGB buffer is the deterministic part.

## Reading the chain

The hosted page and the fallback page try a short list of public endpoints, primary first, eight seconds each. The lists are in `web/chain.js`. Anvil uses `http://127.0.0.1:8545` only. If every endpoint fails, the status line is `the chain did not answer.`

Public chains require two endpoints to agree on the fields the page uses, including the listed price. Anvil requires one. Before `buy`, the page reads the price again and stops if it moved. The wei amount is that on-chain price.

After a photograph loads, the page stores the image in IndexedDB under `chainId:contract:1`. The next load paints that image and skips the chunk reads. The entry stays until the site data is cleared. The hosted page still reads the price and the vault, because those can change. If that read fails, the cached image stays and the buy button stays off. The fallback page, when it already has a cached index, paints those photographs and waits for Look again before it reads the chain again.

The page shows at most the first 100 photographs.

## Checks

```bash
forge test
node script/selfcheck.js
node script/anvil-flow.js --factory 0xFACTORY
```

`forge test` is the contract suite. `test/REDTEAM.md` names each refused move. `REVIEW.md` is the frontend pass. `selfcheck.js` checks the keccak vectors, the thumbnail, the creation bytecode, and the ABI encoding against `cast`. `anvil-flow.js` stores the chaise photograph in chunks, registers it, sells it, parks it, and reads `tokenURI` and `page()`.

Sepolia factory `0x851eafe44d877D8A112eafb1cAF2A31Aca0d60CF`. Piece helper `0xc623d30639239485114dD20B0dC6D98E342cfd0d`. Fallback page `0xf85DaAD527806199D6B3bBFb04164ddD6BE95C32`. The previous factory `0xA4538835b53e19A5ad2B4b21104FF8DEbAd9B520` still has its plates and nomination bytecode; the studio no longer points at it. Mainnet waits for the words DEPLOY MAINNET.

Later ideas (clone factory after Glamsterdam, CREATE2 editions, a gated fundraiser) are in `PLANS.md`.

The license is MIT.
