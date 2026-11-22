// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import {PlateLimits} from "./PlateLimits.sol";

interface IFactoryBooks {
    function books() external view returns (address);
}

/// The ordered list of chunk contracts for one photograph.
/// The image bytes stay in the chunk code. This book stores addresses only.
/// The book creator is the only caller of the constructor.
/// The factory is the only caller of the list. A reader does not need the original transaction.
contract ChunkBook {
    /// 1,150 pieces of 18,432 bytes is 21,196,800 bytes, a little above the 20.3 MB reference file.
    uint256 public constant MAX_CHUNKS = PlateLimits.MAX_CHUNKS;

    address public immutable factory;
    address public immutable artist;
    uint256 public immutable expected;
    bool public locked;
    bool public used;

    address[] private _chunks;
    mapping(address => bool) private _seen;

    error BadChunk();
    error Hook();

    constructor(address factory_, address artist_, uint256 expected_) {
        if (factory_ == address(0) || msg.sender != IFactoryBooks(factory_).books()) revert Hook();
        if (artist_ == address(0) || artist_ == factory_) revert Hook();
        if (expected_ == 0 || expected_ > MAX_CHUNKS) revert BadChunk();
        factory = factory_;
        artist = artist_;
        expected = expected_;
    }

    function chunkCount() external view returns (uint256) {
        return _chunks.length;
    }

    function chunkAt(uint256 index) external view returns (address) {
        return _chunks[index];
    }

    /// Adds the next addresses. The factory calls this once per batch.
    function addChunks(address[] calldata chunks) external {
        if (msg.sender != factory) revert Hook();
        if (locked || used) revert BadChunk();
        uint256 n = chunks.length;
        if (n == 0) revert BadChunk();
        uint256 have = _chunks.length;
        if (have + n > expected) revert BadChunk();
        for (uint256 i = 0; i < n; ++i) {
            address chunk = chunks[i];
            _one(chunk);
            _seen[chunk] = true;
            _chunks.push(chunk);
        }
    }

    /// Locks the list once it has the expected number of chunks.
    function seal() external {
        if (msg.sender != factory) revert Hook();
        if (locked || used) revert BadChunk();
        if (_chunks.length != expected) revert BadChunk();
        locked = true;
    }

    /// One photograph may use a book. The factory calls this inside `addPhoto`.
    function consume() external {
        if (msg.sender != factory) revert Hook();
        if (!locked || used) revert BadChunk();
        used = true;
    }

    /// Size and the STOP byte only. The image bytes are not copied here.
    function _one(address chunk) internal view {
        if (chunk == address(0) || chunk == address(this) || chunk == factory) revert BadChunk();
        if (_seen[chunk]) revert BadChunk();
        uint256 size;
        uint256 first;
        assembly {
            size := extcodesize(chunk)
            let p := mload(0x40)
            extcodecopy(chunk, p, 0, 1)
            first := byte(0, mload(p))
        }
        if (size < 2 || size > PlateLimits.CHUNK_MAX + 1) revert BadChunk();
        if (first != 0x00) revert BadChunk();
    }
}
