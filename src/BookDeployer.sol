// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import {ChunkBook} from "./ChunkBook.sol";

/// Creates one chunk book. Deploy this before the factory.
/// The factory is the only caller. The book stores addresses, not image bytes.
contract BookDeployer {
    /// Tells the factory this contract creates books, not photographs.
    uint256 public constant KIND = 2;

    address public immutable factory;

    error Hook();

    constructor(address factory_) {
        if (factory_ == address(0)) revert Hook();
        factory = factory_;
    }

    function kind() external pure returns (uint256) {
        return KIND;
    }

    function deploy(address artist_, uint256 expected_) external returns (address book) {
        if (msg.sender != factory) revert Hook();
        book = address(new ChunkBook(factory, artist_, expected_));
    }
}
