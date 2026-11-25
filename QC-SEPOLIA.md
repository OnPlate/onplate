# Isolated Sepolia QC

Run 2026-11-24. Throwaway Chromium and in-memory wallets against the live studio, then the same flows against local `script/serve.js`. The tester had only `START-HERE.md` and the page. No mainnet. No factory redeploy.

Lab: `/tmp/onplate-sepolia-qc`. Artist `0xBc7f9C7F1F2fC0c8bbdaf4b55F89775004b2Fe50`, buyer `0x21033b6d43ECf6c28152fB33CAed8138Cc4cD11a`, vault `0xB21d7C0fFE3e7dCDD5bEde78daeb7eABA5D09EfB`. Keys never written. Funding from the onplate keystore is still waiting on a TTY password, so store / register / buy / park / withdraw of a new plate were not mined.

## Fixed after the naive pass (app.js?v=19, app.css?v=18, chain.js?v=16)

- Empty wallet no longer fails store silently. The quote names how much ETH the wallet holds. Store says it needs Sepolia ETH, not mainnet ETH.
- Recipient help and error ask for a `0x` address. “Use the connected wallet” fills it on click. The field is not auto-filled.
- Copy setup / agent prompt / command shows the copied text on the page.
- Store every piece and Store piece N are primary buttons, same weight as Prepare.
- View shows “Loading photographs…” then “Not for sale.” instead of “Not listed.” Filter views get a heading (Favorites, For Sale, My Photographs, artist).

## Still open (page copy / coverage, not this patch)

- Favorite is the Pepe mark with an aria-label only. A first visit does not see the word Favorite.
- Three display names on one artist wallet (`0xd934…`) read as three people until Details is opened.
- A prepared upload is tab-local. Switching account or leaving Add can drop the draft without the Abandon dialog.
- Existing plates are not for sale, so buy / list / park / withdraw still need a funded artist to list their own work.
- Packing “Look closer” is only for files large enough to pack. A 10 KB JPEG never shows it.
- Phone Details wraps long `0x` strings.
- Agent upload and a full sale path wait on Sepolia ETH in the throwaway wallets.
