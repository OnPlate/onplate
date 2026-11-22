// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

/// Shared caps. Chunk contracts keep no Solidity runtime, so the cap lives here.
library PlateLimits {
    uint256 internal constant CHUNK_MAX = 18432;
    /// 1,150 pieces is 21,196,800 bytes. The reference photograph is 20,311,412 bytes.
    uint256 internal constant MAX_CHUNKS = 1150;
    /// Four full pieces fit in one mainnet transaction. Five do not.
    /// Code deposit is 200 gas per byte. Five full pieces are 18,432,000 gas
    /// before any other cost, which is over the 16,777,216 transaction cap.
    /// The same cap is on Sepolia once that chain is on the Osaka schedule.
    uint256 internal constant OPEN_MAX = 4;
}
