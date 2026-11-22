// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ChunkBatch} from "../src/ChunkBatch.sol";
import {PlateChunk} from "../src/PlateChunk.sol";

/// Measures createPieces gas for one full chunk and four full chunks.
/// Fork a public chain with --fork-url. Nothing is broadcast.
/// gasleft() here is the script wrapper. Compare the dry-run transaction gas
/// in broadcast/ProbeGas.s.sol/<chain>/dry-run/run-latest.json to 16_777_216.
contract ProbeGas is Script {
    uint256 internal constant FULL = 18432;

    function run() external {
        bytes memory payload = new bytes(FULL);
        payload[0] = 0x01;
        payload[FULL - 1] = 0xff;
        bytes memory init = bytes.concat(type(PlateChunk).creationCode, abi.encode(payload));

        vm.deal(msg.sender, 100 ether);

        vm.startBroadcast(msg.sender);
        ChunkBatch batch = new ChunkBatch();
        vm.stopBroadcast();

        bytes[] memory one = new bytes[](1);
        one[0] = init;
        vm.startBroadcast(msg.sender);
        uint256 g1 = gasleft();
        address[] memory a1 = batch.createPieces(one);
        uint256 used1 = g1 - gasleft();
        vm.stopBroadcast();

        bytes[] memory four = new bytes[](4);
        four[0] = init;
        four[1] = init;
        four[2] = init;
        four[3] = init;
        vm.startBroadcast(msg.sender);
        uint256 g4 = gasleft();
        address[] memory a4 = batch.createPieces(four);
        uint256 used4 = g4 - gasleft();
        vm.stopBroadcast();

        console2.log("chain", block.chainid);
        console2.log("block gas limit", block.gaslimit);
        console2.log("one piece gasleft", used1);
        console2.log("one piece code", a1[0].code.length);
        console2.log("four piece gasleft", used4);
        console2.log("four piece code", a4[0].code.length);
        console2.log("tx cap", uint256(16_777_216));
        if (used1 > 16_777_216) console2.log("one piece is over the tx cap");
        if (used4 > 16_777_216) console2.log("four pieces are over the tx cap");
    }
}
