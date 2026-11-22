// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import {PlateLimits} from "./PlateLimits.sol";

/// One slice of a photograph. The runtime code is 0x00 followed by the bytes.
/// Readers copy the code. They do not call this contract.
/// The 0x00 byte is STOP, so a call returns immediately and does not run the image.
contract PlateChunk {
    error Empty();
    error TooBig();

    constructor(bytes memory data) {
        uint256 len = data.length;
        if (len == 0) revert Empty();
        if (len > PlateLimits.CHUNK_MAX) revert TooBig();
        assembly {
            // The length word sits immediately before the payload.
            // Its last byte becomes STOP. `len` is already copied out.
            let start := add(data, 32)
            mstore8(sub(start, 1), 0x00)
            return(sub(start, 1), add(len, 1))
        }
    }
}
