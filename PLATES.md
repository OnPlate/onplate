# Finished plates

A finished plate can be read from the chain alone. The upload plan is not part of that read.

## How the upload plan is stored

The hosted page keeps an unfinished upload in the browser database `onplate`, in the object store `plans`. The key is the lowercase keccak256 of the whole file. The record holds the name, description, royalties, thumbnail, factory, wallet, and each chunk's status, transaction hash, and contract address once those exist. It is written before a chunk transaction is sent, so a reload can continue without paying again for a chunk that is already on-chain. `script/anvil-flow.js` uses the same plan functions and writes `script/anvil-plan.json` on disk. That file is local and is not committed. A finished plate does not need either copy.

## What each chunk contract contains

Each chunk is its own contract. Its runtime code is one `0x00` byte followed by a slice of the photograph, at most 18,432 bytes. The first byte is STOP, so a call returns at once and does not run the image. A reader copies the code with `eth_getCode` or `EXTCODECOPY` and drops that first byte. The photograph contract can do the same copy with `readChunk`. It does not call the chunk.

## How the plate ties the chunks together

`addPhoto` asks the plate creator to deploy the plate. `openBook` asks the book creator to deploy the book. The plate stores the book address, the keccak256 of the file, the name, the description, the artist name, the royalty terms, and a small PNG thumbnail. The book holds the ordered chunk addresses. The image bytes stay in the chunk code. The factory does not copy them into storage. `chunkCount` and `chunkAt` read that book. The factory lists finished plates with `photoCount` and `photoAt`. The plate also stores the current title holder, who holds the token, whether it is parked, the list price, and any named buyer. Those can change later. The chunk list and the content hash do not.

## How reconstruction works

Read `chunkCount`, then `chunkAt` from zero upward. Copy each chunk's code, drop the leading STOP byte, and concatenate the slices in order. Hash the result and compare it with `contentHash()` on the plate. The same bytes are the photograph. Nothing from the upload session is required: not the plan, and not a file left in the browser.

The hosted page and the fallback page both do this for every finished plate the factory lists, up to 100. After a successful read, the hosted page may keep the image in the `photos` store so a later load can skip the chunk copies. The price and the vault are still read from the chain, because those change. Clearing the saved image does not block a new read. The hosted page shows the photograph, the title, the description, the dev and artist royalty, the holder, and whether the plate is listed or parked. The fallback page shows those same plate facts except the royalty lines and the connected wallet's withdrawable balance.

`art/chaise.jpg` is 221,081 bytes and splits into 12 chunks. A finished plate of that file reassembles with `eth_call` and `eth_getCode` only.

## What Abandon does and does not do

Abandon is for an unfinished upload. The page asks first. Confirming deletes that plan from the browser. Cancel and Escape leave the plan in place. Deployed chunk contracts stay on-chain. If they were never included in `addPhoto`, they are not part of a plate and the upload cannot be resumed. Abandon does not delete a finished plate, and a finished plan is not offered for Abandon. The plate, its chunks, and the reconstructed photograph remain readable.

## What ownership can change

Factory ownership can be transferred and cannot be renounced. The owner can change the developer-fee recipient copied onto photographs created later, add or remove upload-whitelist addresses, and replace the fallback page the factory points at. The page contract still rejects empty HTML and HTML longer than 18,432 bytes. None of those calls rewrite a finished plate's chunks, content hash, royalty shares, or the recipient already stored on that plate. Parking a plate is added security for a mounted photograph: the title names a vault, and that vault can only send the token home.
