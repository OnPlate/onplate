// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import {PlateChunk} from "./PlateChunk.sol";
import {PlateLimits} from "./PlateLimits.sol";

/// The fallback page. One HTML document, stored as chunk bytecode.
/// `page()` copies that code. It does not call out.
contract PlatePage {
    address public immutable factory;
    address public immutable body;

    error BadPage();

    constructor(address factory_, bytes memory html) {
        if (factory_ == address(0) || html.length == 0 || html.length > PlateLimits.CHUNK_MAX) revert BadPage();
        factory = factory_;
        body = address(new PlateChunk(html));
    }

    /// The whole page. A browser can save this string and open it.
    function page() external view returns (string memory out) {
        address chunk = body;
        assembly {
            let size := extcodesize(chunk)
            if lt(size, 2) { revert(0, 0) }
            size := sub(size, 1)
            out := mload(0x40)
            mstore(out, size)
            let dest := add(out, 32)
            extcodecopy(chunk, dest, 1, size)
            mstore(add(dest, size), 0)
            mstore(0x40, add(dest, and(add(size, 31), not(31))))
        }
    }
}
