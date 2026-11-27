# Red team

These are the moves the contracts refuse. The name after each one is the test that shows it. Nothing here is a way to do the move. `forge test` runs the tests.

Eighty-nine tests passed in `test/OnPlate.t.sol`. Nine more passed in `test/ChunkBatch.t.sol`.

The factory runtime is under 16,000 bytes. The plate creator is larger. That is where photograph creation lives. `test_factoryCodeOmitsPlateCreation`.

Store the file, then register. A photograph always has a book at mint. Sale, park, burn, and restore stay on the plate and the factory. Nomination is not in this factory. Restore of a burned list stays on the factory path. CREATE2 is not used.

## Who may add

The factory starts with `photoCount` 0 and no page. `test_startsEmpty`. `openMax` is 4. The owner and a whitelisted address may open a book of 1,150 pieces. Anyone else may open a book of at most 4. `openBook(0)` and `openBook(1151)` revert `BadChunk`. `openBook(5)` and `openBook(1150)` from a stranger revert `NotAllowed`. `test_bookCapAndBatchLimit`. `test_strangerCannotAdd`.

A stranger's `addPhoto` with no book reverts `BadChunk`, because the royalty matches and the book check runs before the size check. The count stays 0. `test_strangerCannotAdd`. A stranger can register 4 pieces. That plate stores the artist name. `test_openTierStoresFour`. Two strangers can each register 4. The contract does not stop that. `test_twoStrangersEachStoreFour`. `linkPhoto` registers 1 to 4 pieces in one call for a stranger. Five pieces revert `NotAllowed` for a stranger. A whitelisted signer may pass more than four, up to `MAX_CHUNKS`, in that same call. `test_linkPhotoRegistersFourInOneCall`. `test_linkPhotoRefusesFiveFromStranger`. `test_linkPhotoRegistersTwelveForWhitelisted`. `test_linkPhotoRegistersEightyForWhitelisted`. Creating a piece contract stays open. Linking a fifth piece does not, for a stranger. `test_pieceCreateStaysOpen`. A 4-piece book cannot be grown to 5. `test_openBookCannotGrow`.

The owner can add without being in the authorized mapping. The artist name is empty when none was passed. The dev recipient on that photograph is the factory's `devRecipient`, which starts as the owner. `test_ownerCanAddWithoutBeingAuthorized`. An authorized artist can add. After the owner sets that flag back to false, a missing book reverts `BadChunk` and `openBook(5)` reverts `NotAllowed`. The existing photograph's recipient, shares, hash, and chunk stay. `test_authorizedArtist`. The artist cannot call `setAuthorized`. `test_artistCannotAuthorize`. `setAuthorized` of the zero address reverts `NotAllowed`. `test_zeroAuthorizerRejected`. The same function reverts `NotAllowed` when the artist argument is the factory.

`transferOwnership` moves the owner. It does not change `devRecipient`, the whitelist, the page, or an existing photograph. A stranger's transfer reverts. Transfer to the zero address reverts. After the move, the previous owner cannot call `setDevRecipient`, `setAuthorized`, or `setPage`. The new owner can. `test_transferMovesTheRoleOnly`. `renounceOwnership` reverts `Hook` for the owner and for a stranger. `test_renounceOwnershipReverts`.

`setDevRecipient` is copied only onto photographs created after the call. The zero address and the factory revert `Hook`. A stranger's call reverts. A sale of an earlier photograph still credits the recipient stored on that photograph. `test_devRecipientChangesFuturePlatesOnly`.

A direct `new OnPlate` reverts `Hook`. The photograph constructor requires the caller to be the plate creator named by the factory it is given. `test_directPlateDeployReverts`. A direct `new ChunkBook` reverts the same way: the caller must be the book creator that factory names. `test_directBookDeployReverts`. A stranger cannot call either creator. `test_strangerCannotUseDeployers`. The factory rejects the two creators swapped, a creator aimed at a different address, and a creator with no code. `test_factoryRejectsMismatchedDeployers`. The factory runtime is under 16,000 bytes. The plate creator runtime is larger, which is where the photograph creation code lives. `test_factoryCodeOmitsPlateCreation`. A stranger's own factory is a separate system. `addPhoto` increments `photoCount` before the create. A reverting constructor rolls that increment back. `test_badTerms` ends with `photoCount` still 1 after the failed calls.

## Terms, text, thumbnail

A zero content hash reverts `Hook`. The factory constructor rejects a dev share, a default artist share, or a sum of those two above 10,000. `test_factoryRejectsBadRoyaltyDefaults`. `addPhoto` with a dev share other than the factory's `devBps` reverts `OnPlateFactory.Royalty`. `test_addPhotoRejectsOtherDevBps`. When the dev argument matches, a sum of the two shares above 10,000 and a positive artist share paid to the zero address revert `OnPlate.Royalty`. A zero artist share may store the zero address. A name containing `"` reverts `BadText`. A short byte string that is not a 32 or 48 PNG reverts `BadThumb`. `test_badTerms`.

The shares and both recipients are immutable. A sale, a park, and a release leave them where they were. `test_royaltiesDoNotMove`. There is no function that writes them again. `setDevRecipient` on the factory does not write them.

## Chunks

The image bytes are not written into contract storage. A chunk's runtime code is `0x00` plus the bytes. The book stores the chunk address. The plate stores the book address. A 64-byte marker of `0xa5` is present in the chunk code and absent from the book code, the plate code, the factory code, both creator contracts, and every storage slot the book and the factory write while the piece is linked. `test_imageBytesAreNotCopiedIntoStorage`. Reading the chunk in a later block still returns those bytes. The original transaction is not required. The factory and both creators are refused as chunks. `test_factoryAndBookAreNotChunks`.

An empty count, a repeated chunk address, a contract whose first code byte is not `0x00`, and the zero address all revert `BadChunk`. `test_chunksMustBeReal`. The book and the factory are refused the same way. `test_factoryAndBookAreNotChunks`. A duplicate in a later batch reverts too. `test_bookLinksInBatchesAndSecondUseReverts`.

A call to a chunk returns empty. The STOP byte is the first code byte. `readChunk` copies the code after that byte. It does not call the chunk. Concatenating the copies hashes to the stored content hash. `test_chunkRoundTripAndCallStops`. The contract stores the hash the artist supplied. It does not recompute keccak256 over the file during `addPhoto`. One call cannot return a 20 MB file: holding that many bytes in memory costs more gas than a block. The reader copies one piece at a time.

A chunk of 18,432 bytes deploys. Its code length is 18,433. The first and last payload bytes round-trip. One byte over reverts `TooBig`. An empty payload reverts `Empty`. `test_maxChunkFitsAMainnetTx`. The cap is `PlateLimits.CHUNK_MAX`. A photograph accepts at most 1,150 chunks. `openBook(1151)` reverts. `test_bookCapAndBatchLimit`. One `addChunks` call accepts at most 80 addresses. One more reverts, and no address is stored. `test_appendOverTheBatchReverts`.

The book is filled before the plate exists, so a half-linked list cannot be bought. A second `addPhoto` of the same book reverts. A book from another factory reverts. A stranger cannot append to someone else's book. Removing the artist stops a later append on a book above 4 pieces. A 4-piece book opened while the artist was allowed can still be finished after the removal. Restoring the artist lets the wide book finish. A book that was already sealed at 5 pieces cannot be registered after the removal, and the failed call does not consume the book. A direct `new ChunkBook` reverts `Hook`. `test_bookLinksInBatchesAndSecondUseReverts`, `test_bookFromAnotherFactoryIsRefused`, `test_strangerCannotWriteSomeoneElsesBook`, `test_removedArtistCannotFinishTheBook`, `test_fourBookOpenedWhileAllowedFinishesAfterRevoke`, `test_sealedWideBookCannotRegisterAfterRevoke`, `test_directBookDeployReverts`.

## The token

`tokenURI(1)` is `data:application/json;base64,` plus JSON. The JSON holds the name, the description, `artist_name`, `content_hash`, and the thumbnail as a base64 PNG. The string contains neither `http` nor `ipfs` nor `arweave`. `tokenURI(2)` reverts. `test_tokenURIIsOnChain`. An artist name of 48 characters is stored and appears in that JSON. An empty name is stored as empty. 49 characters, a quote, `<`, `>`, `&`, `\`, a control byte, and a non-ASCII byte revert `BadText`. `test_artistNameIsStoredAndBounded`.

`approve`, `setApprovalForAll`, `transferFrom`, and both `safeTransferFrom` forms revert. The holder stays the title. `test_approvalsAndTransfersOff`. A stranger contract calling `transferFrom` reverts `TransfersOff`. `test_strangerTransferReverts`. The mint uses `_mint`, so the photograph does not call `onERC721Received` at creation. A buy into a contract with no receiver, and a buy into a receiver that reverts, both complete. `test_buyDoesNotCallReceiver`.

The holder may burn the token once it is home. `burn` records who burned it, tells the factory, and destroys token 1. A stranger's burn reverts `NotHolder`. After a sale the seller's burn reverts `NotHolder` and the buyer's burn succeeds. The seller can still withdraw the credited share. `test_onlyHolderBurnsAndWithdrawSurvives`. While parked, the title, the vault, and a stranger all revert `Hook`. After `release`, a stranger still reverts `NotHolder` and the title's burn succeeds. `test_parkedPlateCannotBeBurned`. A listed plate that is burned cannot be bought. `test_burnClearsSaleAndNewBytesAreAnotherWork`.

The first account to register an ordered chunk list is its origin. A second living plate of that list reverts `WorkTaken`. If the origin burns it, the list is finished. The origin and everyone else then revert `WorkEnded`. `test_originBurnFinishesTheList`. If any other holder burns it while holding it at home, only the origin can register that list again. `test_holderBurnReturnsTheListOnlyToOrigin`. A vault the origin chose cannot burn, so it cannot finish the list or return it. After that vault sends the plate home, the origin's burn finishes the list. `test_vaultCannotBurnForTheArtist`.

An open-tier list does not gain extra rights because the origin was whitelisted later. `test_holderBurnReturnsTheListOnlyToOrigin`.

A burned work above 4 pieces leaves the origin one restore of that same size. The origin can open, fill, and register it without the whitelist. A different file of that size reverts `NotAllowed` and does not spend the restore. Another size reverts `NotAllowed`. The restore is spent when the same pieces are registered. `test_restoreLargeWorkWithoutWhitelist`.

The same file in new chunk contracts is a different list. Both plates can be alive. A reversed order is a different list. `test_burnClearsSaleAndNewBytesAreAnotherWork`. Pieces created through `ChunkBatch` record the paying wallet as `maker`. A first registration of that list has to be signed by that wallet, or by the account that opened the book for it. Another account reverts `NotAllowed`. A raw `PlateChunk` with no maker reverts `BadChunk`. A restore of a burned list is signed by the origin, who may not have stored the pieces. `test_strangerCannotRegisterOthersPieces`. The owner sets the piece helper once. `test_setBatchOnce`.

A registration may name another wallet as the title. That wallet is the holder and the origin. The signer stays in the `PhotoAdded` log and does not become the title. The signer cannot list. The named wallet can. `openBook(count)` and `linkPhoto` without a home still title the signer. The zero address means the signer. The factory as home reverts `Hook`. A contract can be the home. Minting does not call it. `test_signedUploadGivesTheWalletThePlate`. `test_badHomeAndSpentSignerAreRefused`.

The receiving wallet's whitelist does not let an unlisted signer open a 5-piece book in that wallet's name. After the signer is removed, a 5-piece book that signer already sealed cannot be registered, and no restore credit is written. `test_badHomeAndSpentSignerAreRefused`.

A stranger cannot add chunks, seal, or register a book opened for someone else, including a stranger who is whitelisted. The named wallet can add an open-tier chunk. The signer can finish the registration. The opener record is cleared once the plate exists. `test_strangerCannotFinishADeliveredBook`.

Ordinary transfers stay off. There is no function that moves a plate to `HOME` after it exists. The royalty recipient is not the new title. A sale credits the payee, the dev recipient, and the seller. It does not credit the signer. The origin stays the wallet that received the plate. `test_royaltyPayeeIsNotTheNewTitle`.

If a later holder burns the plate, the restore credit belongs to the receiving wallet, not the signer. The signer cannot spend it, including by opening a book titled back to that wallet. The receiving wallet cannot restore it to a third address. That wallet can restore it to itself without being whitelisted. The origin does not change. `test_restoreStaysWithTheReceivingWallet`. The receiving wallet's own burn finishes the list. The signer and that wallet both then revert `WorkEnded`. `test_signedUploadGivesTheWalletThePlate`.

## The ETH

On a price of 10,000 with 450 dev bps and 1,000 artist bps, the credits are 450, 1,000, and 8,550. Each recipient withdraws only their own credit. A buyer with nothing credited reverts `Nothing`. After the three withdrawals, `accounted` is 0 and the contract balance is 0. `test_splitAndWithdraw`.

A price of 3 with 5,000 and 5,000 credits 2 to the seller side and 1 to the artist. The odd wei stays with the seller. `test_roundingDustStaysWithSeller`. A 100% dev share on a price of 9,999 credits the whole price to the dev recipient, who is also the seller in that test. The zero address is not credited. `test_fullRoyaltyLeavesSellerTheDustOnly`.

`buy` credits, then moves the token. It does not call the dev recipient, the artist, or the seller. `withdraw` zeros the credit, emits `Withdrawn`, then sends ETH to `msg.sender`. A receiver that calls `withdraw` again during that send is stopped by the guard and is paid once. `test_reentrancyOnWithdrawPaysOnce`. A receiver that reverts the ETH leaves the credit in place. `test_revertingReceiverDoesNotTakeTheBalance`.

Five ETH force-fed onto the contract stays there after the seller withdraws the sale. `accounted` returns to 0. `test_forceFedEthIsNotWithdrawable`. A plain ETH transfer to the photograph and to the factory both fail. There is no `receive` and no sweep of `address(this).balance`. `test_directEthReverts`.

## Sale

A price of 0 reverts `BadPrice`. A second `list` replaces the price. `cancel` clears it. `buy` after cancel reverts `NotListed`. A stranger's `cancel` reverts `NotTitle`. `test_cancelAndRelist`. A stranger's `list` reverts `NotTitle`. `test_strangerListReverts`. One wei short and one wei over both revert `BadPrice` and leave the token and the balance where they were. `test_shortAndOverPaymentRevert`. The title holder buying their own listing reverts `Hook`. `test_selfBuyReverts`.

The title holder sets a price, replaces it, clears it, and lists again. With no named buyer, another address pays that price and becomes the title. `test_publicPriceUpdateThenSale`.

`setAllowedBuyer` stores one address. Any other caller of `buy` reverts `NotBuyer`, and the price stays. The named address pays the listed price and receives the token. A successful `buy` clears the named buyer so the new title starts with a public listing. `test_namedBuyerIsTheOnlyPurchaser`. The title holder replaces that address. The previous address reverts `NotBuyer`. Clearing it with the zero address makes the listing public again. `test_ownerReplacesAndClearsBuyer`. `cancel` clears the price and leaves the named buyer. `test_cancelAndRelist`. Naming, replacing, or clearing reverts `Hook` while the photograph is parked. `cancel` reverts `Hook` while parked. The vault cannot name a buyer or cancel. Parking clears the price and the named buyer. After release both stay clear, `buy` reverts `NotListed`, and a new `list` makes the photograph buyable again. `test_buyerChangeRevertsWhileParked`.

After a sale the uploader's `list`, `cancel`, and `setAllowedBuyer` revert `NotTitle`. The new title holder can name a buyer and list. `test_uploaderCannotListAfterSale`.

## The vault

`setMailbox` parks in the same call. The title stays the title. The listed price becomes 0 and the named buyer becomes the zero address. `buy` while parked reverts `NotListed`. `cancel` while parked reverts `Hook`. The title holder cannot `list` or `clearMailbox` while the vault holds the token. The vault's `transferFrom` reverts `TransfersOff`. The title holder's `release` reverts `Hook`. The vault's `release` returns the token to the title and clears the vault name (`mailbox` is the zero address; `MailboxCleared` is emitted). `parked()` is then false. The price and the named buyer stay clear. `clearMailbox` still works while the title holds the token; after `release` it is a no-op. `test_vaultRoundTrip`. `test_releaseClearsMailboxSoANewVaultCanBeNamed`.

The title holder cannot `transferFrom` the parked token back. `test_titleCannotPull`. The zero address, the photograph, and the title holder are rejected as vaults. `test_badVaultRejected`. A vault that is an ordinary unused address holds the token until that address calls `release`. The title holder cannot clear the name, release, or transfer in the meantime. `test_typoParkIsPermanentUntilThatVaultReturns`. The vault cannot burn. Burn reverts `Hook` while parked. `test_parkedPlateCannotBeBurned`.

`release` leaves the name. A later sale, while the title holder is holding the token, clears the name. The buyer does not inherit the vault. `test_saleClearsANamedVault`. Parking one photograph does not park another. The vault cannot `release` the second. `test_twoPhotosDoNotShareAVault`.

## Nomination

Nomination is not in this factory. There is no `nominate`, `nominationAllowed`, `nominated`, `nominationRevoked`, `originalPrice`, `vaultedSince`, `HOLD`, `authorizeNominee`, or `IFactoryAuth`. Those selectors revert on a plate and on the factory. `test_nominationSelectorsAbsent`. Parking remains as added security for a mounted photograph. The title names a vault; that vault can only send the token home. `release` clears the vault name. The owner invites a large-file signer with `setAuthorized`. The hosted page does not send that call.

## The page

A stranger's `setPage` reverts. The owner's `setPage` stores the page. `page()` returns the HTML that was deployed. A later `setPage` replaces the factory pointer. The previous page contract still returns its own HTML. The zero address, an account with no code, and HTML longer than 18,432 bytes are rejected. A page that names another factory reverts `BadPage` and leaves the current page in place. The photograph's hash, chunk, and recipient stay. `test_pageReplacesWithoutTouchingPlates`. A contract whose `factory()` returns another address reverts `BadPage` and leaves an empty slot empty. So does a page built for a different factory. `test_pageMustNameThisFactory`.

`setPage` is `nonReentrant` and calls `factory()` on the page. A page that reenters `setPage` or `addPhoto` during that call does not stick and does not add a photograph. A page that catches the revert can be stored. It does not authorize itself and does not raise `photoCount`. `test_evilPageCannotReenter`.

## What this pass also looked at

The movement hook allows five paths: mint to the title, sale away from the title, park from the title to the mailbox, release from the mailbox back to the title, and burn to the zero address. Burn is allowed only while `burn()` has set `_burning`, and only from the holder to address zero. `burn()` itself reverts `Hook` while the plate is parked, so the vault never reaches that path. Every other `_update` reverts `Hook`.

`buy` clears `mailbox` before the move. A named vault that is not currently holding the token does not ride along to the buyer.

There is no `delegatecall`, no `tx.origin` check, no trusted forwarder, no signature mint, and no multicall. EIP-7702 delegation would be the key's own account. The contracts do not treat a delegated account as a special caller.

Chunk contracts are created with `CREATE`. They have no `selfdestruct`. Post-Cancun selfdestruct does not remove code from an earlier transaction. Readers never `CALL` the chunk.

The same address can be dev recipient and seller. The credits add. A zero cut is not written into `claimable`.

## First principles (this factory)

The asset is the photograph bytes in chunk code, the keccak256 of those bytes on the plate, and title as token 1. Transfers and approvals are off. Sale, park, and return are the only moves. A vault can only send the token home. The factory owner cannot rewrite a finished plate's chunks, hash, royalty shares, or title.

Nomination is gone. Large files are invited only by the factory owner with `setAuthorized`. The hosted page's `send()` whitelist has no `setAuthorized`, `setPage`, `setBatch`, `transferOwnership`, or `nominate`. `web/chain.js` `SEND` is addPhoto, linkPhoto, openBook, addChunks, sealBook, list, cancel, buy, setAllowedBuyer, setMailbox, release, clearMailbox, withdraw, burn.

`workKey` is `keccak256(abi.encode(ordered chunk addresses))`. Two different files in different contracts are different keys. The same bytes in new contracts are a new work. A second living plate of the same list reverts `WorkTaken`. An origin burn finishes the list (`WorkEnded`). Any other holder's burn returns the list to the origin, and a large work leaves one restore credit at that piece count.

### Standard threats

- Reentrancy: `buy` credits then moves, and does not call the seller, the artist, or the dev recipient. `withdraw` zeros the credit, then sends. A nested `withdraw` is stopped by the guard. `setPage` and `addPhoto` share the factory guard. `test_reentrancyOnWithdrawPaysOnce`. `test_evilPageCannotReenter`.
- Access: `setAuthorized`, `setPage`, `setDevRecipient`, and `setBatch` are owner-only. `setBatch` is once. `renounceOwnership` reverts. A stranger cannot use either deployer. `test_artistCannotAuthorize`. `test_strangerCannotUseDeployers`. `test_setBatchOnce`.
- Exact payment: `buy` reverts one wei short and one wei over. A lying RPC that shows the wrong price cannot make the wallet pay a different on-chain price; the call reverts `BadPrice`. `test_shortAndOverPaymentRevert`.
- XSS: names, descriptions, and artist names are ASCII without `"\\<>&`. The page and the fallback write them with `textContent`. `plain()` drops a bad string. `test_artistNameIsStoredAndBounded`. `test_tokenURIIsOnChain`.
- Clickjacking: `frame.js` blanks a framed page. `_headers` and the HTML CSP set `frame-ancestors 'none'` / `X-Frame-Options: DENY`. `script-src 'self'`. The zip kit is a local STORE writer (`web/zip.js`); it does not load a CDN.
- Chunks: runtime is STOP then payload. Readers `extcodecopy`. A CALL to a chunk returns empty. No `selfdestruct`. No `delegatecall`. No `tx.origin`. No CREATE2.
- Force-fed ETH stays. Direct ETH to the plate or the factory reverts. `test_forceFedEthIsNotWithdrawable`. `test_directEthReverts`.

### First-principles threats

**Factory owner key.** Compromise of the onplate keystore lets an attacker whitelist any address, replace the on-chain fallback page with attacker HTML, and change `devRecipient` for later plates. It does not move a living plate, rewrite chunks, or withdraw sale credits. The hosted studio must not import that key into a browser wallet. `setAuthorized` is a cast from a TTY. GitHub Pages JS cannot send it through `send()`.

**Park-to-typo.** `setMailbox` moves the token in the same call. A vault that is a typo, a contract with no `release()` caller, or an address the title does not control holds the token until that address calls `release`. Title cannot pull, burn, list, or clear the name while it is parked. `test_typoParkIsPermanentUntilThatVaultReturns`. The page copy says the vault can only send the photograph home.

**Open-tier spam.** Anyone may register 4 pieces. Gas is the limiter. On Sepolia that is about 28.7 million gas per full piece. On Osaka mainnet it is about 4.1 million gas per piece at the floor of 1.5 gwei. The gallery walks `photoCount`. A paid flood still grows the list. Two strangers may each store four. `test_twoStrangersEachStoreFour`.

**Two-key path.** `OWNER` is title and origin. `SENDER` is the keystore that pays. `ARTIST` is only the royalty recipient. `linkPhoto(..., home)` sizes the door on `msg.sender`, not on `home`. A stranger cannot borrow a whitelist by naming a whitelisted home. `PhotoAdded` logs the signer. The card shows "Registered by" when that signer differs from origin. A user who pastes the agent command without moving `SENDER` to the keystore will sign as the connected wallet.

**Restore credits.** A non-origin burn of a work above 4 pieces credits `restores[origin][count]` once. The origin can open a book of that size without the whitelist. `_prepareWork` still refuses a *new* file of that size (`NotAllowed`) and does not spend the credit. The origin can only retitle the restore to itself. `test_restoreLargeWorkWithoutWhitelist`. `test_restoreStaysWithTheReceivingWallet`.

**Host sender password.** `upload-host.js` refuses `--password`, `--password-file`, `--private-key`, and those environment variables. The password is typed on a TTY. If stdin is not a TTY, the script prints one command to copy into a new terminal. The agent prompt tells the model not to put the password in chat, a file, or an env var. A model that ignores the prompt is the residual. Do not run a copied agent prompt against the real onplate keystore unless `SENDER` is that keystore's 0x address.

**Zip kit.** `OnPlateZip.pack` is STORE-only. Names reject `/`, `\`, controls, `.`, and `..`. The kit is `prompt.txt`, the JPEG, and `upload-thumb.png`. The prompt wraps the node command in an `onplate-data` fence and strips triple backticks from that block. The photograph path is single-quoted. The page does not download `upload-host.js`.

**Read poisoning.** `connect-src` allows any `https:` RPC. A lying node can show a stale listing or a fake holder. Writes go through the wallet. `buy` has no arguments; `msg.value` must equal `listedPrice`. A public listing can still be bought by whoever's transaction lands first. A named buyer is the only purchaser. `test_namedBuyerIsTheOnlyPurchaser`.

**On-chain page vs hosted studio.** `setPage` stores attacker HTML if the owner key is used. That HTML is the fallback when GitHub is down. GitHub Pages serves `web/` from `main`. A compromised repo can change `add.html` / `app.js`. CSP `script-src 'self'` stops a CDN script. It does not stop a malicious commit of `app.js`. The factory owner key stays out of the browser.

**Old Sepolia factory.** Plates on `0xA4538835b53e19A5ad2B4b21104FF8DEbAd9B520` keep nomination bytecode. They stay readable. The live studio names `0x851eafe44d877D8A112eafb1cAF2A31Aca0d60CF`. `LOG_START` is that factory's create block. The page walks 40,000-block windows to head.

**Glamsterdam gas.** Sepolia code deposit is about 1,530 gas/byte. The page and the host sender pass `eth_estimateGas` there, including values above 16,777,216. Osaka and mainnet still refuse a total over that cap. A naive copy of a Sepolia quote onto mainnet would underprice storage.

**Hero page.** `web/index.html` loads `frame.js` only. No `app.js`, no Connect, no wallet. Images are local `examples/` JPEGs packed to `OPEN_MAX`. `data-venue="about"`.

**Fallback HTML injection.** `page.html` / `fall.js` use `plain()` then `textContent`. A plate whose name failed `plain()` shows empty rather than raw bytes.

No CREATE2 editions. No clone factory. No GUI burn. The hosted page never fills Recipient by itself.
