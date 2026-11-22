// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {BookDeployer} from "../src/BookDeployer.sol";
import {OnPlateFactory} from "../src/OnPlateFactory.sol";
import {PlateDeployer} from "../src/PlateDeployer.sol";

/// Deploy the two creators, then the factory. Refuses mainnet.
/// Version 1 is store-then-register: 3% developer, 7% artist.
/// The factory does not contain the photograph or book creation code.
/// `SENDER` is the public address of the broadcasting key. The script does not read a key.
contract DeployFactory is Script {
    function run() external {
        uint256 devIn = 300;
        uint256 artistIn = 700;
        address sender = vm.envAddress("SENDER");
        if (block.chainid != 1) {
            devIn = vm.envOr("ONPLATE_DEV_BPS", uint256(300));
            artistIn = vm.envOr("ONPLATE_ARTIST_BPS", uint256(700));
        }
        require(sender != address(0), "sender");
        require(devIn <= 10_000 && artistIn <= 10_000 && devIn + artistIn <= 10_000, "royalty");
        require(block.chainid != 1, "mainnet");
        uint256 nonce = vm.getNonce(sender);
        address predicted = vm.computeCreateAddress(sender, nonce + 2);
        vm.startBroadcast(sender);
        PlateDeployer plates = new PlateDeployer(predicted);
        BookDeployer books = new BookDeployer(predicted);
        OnPlateFactory factory = new OnPlateFactory(uint16(devIn), uint16(artistIn), address(plates), address(books));
        vm.stopBroadcast();
        require(address(factory) == predicted, "predicted");
        console2.log("plates", address(plates));
        console2.log("books", address(books));
        console2.log("factory", address(factory));
        console2.log("devBps", devIn);
        console2.log("defaultArtistBps", artistIn);
    }
}
