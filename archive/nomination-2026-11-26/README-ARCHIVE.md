# Nomination-era snapshot — 2026-11-26

This folder is a frozen copy of OnPlate while plates could nominate an address onto the factory whitelist.

It is not deployed code. It is not the live factory. Do not compile it as the current tree.

## What nomination did

A plate registered by the factory owner or by an address already on the upload whitelist carried `nominationAllowed = true`. After that plate sat in a vault for 30 days (`HOLD`), the title holder could call `nominate(address)` once. The plate set `nominated` and the factory called `authorizeNominee`, which wrote the same whitelist as `setAuthorized(address, true)`.

An open-tier plate (at most `OPEN_MAX` pieces, registered by a stranger) could not nominate. A later whitelist did not flip that flag.

A later `buy` below the first sale price (`originalPrice`) set `nominationRevoked` and spent the chance. Return (`release`) cleared `vaultedSince` and did not spend the chance. The next vault started a new 30 days.

`Lineage.chanceOpen` stored whether a burned list would remint with that chance still open.

## Why it was removed

The product is provenance for a digital photograph, not an invite graph. Nomination looked like a social-curation loop. The open door (`OPEN_MAX` = 4 pieces, 73,728 bytes) stays. Larger files still need a hand whitelist via `setAuthorized`, called only by the factory owner. The hosted page never sends that call.

Vaulting stayed. `setMailbox` / `release` / `parked` / `mailbox` are Stillwater-style parking: the title names a vault, that vault can only send the token home.

## Live Sepolia factory this snapshot described

`0xA4538835b53e19A5ad2B4b21104FF8DEbAd9B520`

Plates already minted on that factory keep their nomination bytecode. A new factory after this archive has no nomination functions.

## Files

- `src/OnPlate.sol`, `src/OnPlateFactory.sol`, `src/PlateDeployer.sol`
- `test/OnPlate.t.sol`, `test/REDTEAM.md`
- `web/page.html`, `web/app.js`, `web/chain.js`, `web/fall.js`
- `script/Upload.s.sol`, `script/upload-host.js`
- `README.md`, `PLATES.md` as they read while nomination was the product story
