// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {PlateChunk} from "../src/PlateChunk.sol";
import {PlateLimits} from "../src/PlateLimits.sol";

/// One full dummy piece on Sepolia. No factory. No photograph.
/// Broadcast with --account onplate. Refuses every chain except Sepolia.
contract SmokePiece is Script {
    function run() external {
        require(block.chainid == 11155111, "sepolia");
        bytes memory payload = new bytes(PlateLimits.CHUNK_MAX);
        payload[0] = 0x53;
        payload[1] = 0x4d;
        payload[2] = 0x4f;
        payload[3] = 0x4b;
        payload[PlateLimits.CHUNK_MAX - 1] = bytes1(uint8(0xff));
        vm.startBroadcast();
        PlateChunk chunk = new PlateChunk(payload);
        vm.stopBroadcast();
        console2.log("chunk", address(chunk));
        console2.log("code", address(chunk).code.length);
    }
}
