# Future plans

Ideas for later. Not a schedule. Not this Sepolia factory. Mainnet waits for the words DEPLOY MAINNET.

The live 1/1 factory reprints a full plate contract for every photograph. Image chunks stay unique contracts in every plan below.

## Frozen clone factory after Glamsterdam

If the project is proving successful and mainnet is on Glamsterdam (or launching into it), deploy a new factory whose photographs are frozen EIP-1167 clones of one plate implementation.

Each photograph still has its own address, title, hash, royalties, thumbnail, buy, park, and vault. The 10 KB plate program is deployed once. Each new plate is a tiny stub that follows that program. Use ordinary `CREATE`, not `CREATE2`. The factory clones and initializes in the same register transaction. The implementation has no upgrade admin.

Existing plates stay on the factory that created them. The page names one factory per chain, so a cutover is a new factory address and a new fallback page. Image storage is unchanged. The save is the plate code deposit: on Glamsterdam that is most of the ~16M gas in today's register, about 0.024 ETH at 1.5 gwei, more when mainnet gas is real.

Do this as its own change, after this factory has finished proving upload, gallery, and sale.

## Editions with CREATE2

A later editions contract, separate from the 1/1 factory. Today's 1/1 plates do not use CREATE2. An edition drop could: one implementation, many copies at addresses derived from a salt (work, size, number) so the same edition is predictable and cannot be minted twice at that salt.

Keep editions off the 1/1 path. A 1/1 photograph stays a unique chunk list and a unique plate. The editions contract is a different product surface.

## GoFundMe with NFTs that restrict movement of funds

A campaign where the raised ETH sits in a contract, not a wallet the organizer can empty. An NFT (or a plate) gates how those funds may move: who can withdraw, to which addresses, after which condition, and how much at a time. Holding or returning the NFT is what unlocks a transfer. The organizer cannot send the pot as if it were theirs.

This is a separate contract from the 1/1 photograph factory.
