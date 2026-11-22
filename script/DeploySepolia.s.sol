// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {BookDeployer} from "../src/BookDeployer.sol";
import {ChunkBatch} from "../src/ChunkBatch.sol";
import {OnPlateFactory} from "../src/OnPlateFactory.sol";
import {PlateDeployer} from "../src/PlateDeployer.sol";
import {PlatePage} from "../src/PlatePage.sol";

/// Sepolia factory, piece helper, and fallback page in one broadcast.
/// `web/page.html` has to name the predicted factory before this runs.
/// Refuses every chain except Sepolia. Mainnet waits for DEPLOY MAINNET.
contract DeploySepolia is Script {
    function run() external {
        require(block.chainid == 11155111, "sepolia");
        uint256 devIn = vm.envOr("ONPLATE_DEV_BPS", uint256(300));
        uint256 artistIn = vm.envOr("ONPLATE_ARTIST_BPS", uint256(700));
        address sender = vm.envAddress("SENDER");
        require(sender != address(0), "sender");
        require(devIn <= 10_000 && artistIn <= 10_000 && devIn + artistIn <= 10_000, "royalty");
        uint256 nonce = vm.getNonce(sender);
        address predicted = vm.computeCreateAddress(sender, nonce + 2);
        bytes memory html = vm.readFileBinary("web/page.html");
        require(html.length > 0 && html.length <= 18432, "page size");
        require(_contains(html, bytes(vm.toString(predicted))), "factory address");
        vm.startBroadcast(sender);
        PlateDeployer plates = new PlateDeployer(predicted);
        BookDeployer books = new BookDeployer(predicted);
        OnPlateFactory factory = new OnPlateFactory(uint16(devIn), uint16(artistIn), address(plates), address(books));
        ChunkBatch batch = new ChunkBatch();
        factory.setBatch(address(batch));
        PlatePage page = new PlatePage(address(factory), html);
        factory.setPage{gas: 1_000_000}(address(page));
        vm.stopBroadcast();
        require(address(factory) == predicted, "predicted");
        console2.log("plates", address(plates));
        console2.log("books", address(books));
        console2.log("factory", address(factory));
        console2.log("batch", address(batch));
        console2.log("page", address(page));
        console2.log("devBps", devIn);
        console2.log("defaultArtistBps", artistIn);
    }

    function _contains(bytes memory hay, bytes memory needle) internal pure returns (bool) {
        if (needle.length == 0 || hay.length < needle.length) return false;
        uint256 last = hay.length - needle.length;
        for (uint256 i = 0; i <= last; ++i) {
            bool same = true;
            for (uint256 j = 0; j < needle.length; ++j) {
                if (hay[i + j] != needle[j]) {
                    same = false;
                    break;
                }
            }
            if (same) return true;
        }
        return false;
    }
}
