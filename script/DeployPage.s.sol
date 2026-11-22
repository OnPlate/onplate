// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {OnPlateFactory} from "../src/OnPlateFactory.sol";
import {PlatePage} from "../src/PlatePage.sol";

/// Deploy the fallback page and point the factory at it.
/// The owner can call `setPage` again later. This script calls it once.
/// Refuses mainnet. FACTORY is the factory address. web/page.html is the page.
contract DeployPage is Script {
    function run() external {
        require(block.chainid != 1, "mainnet");
        address factory = vm.envAddress("FACTORY");
        bytes memory html = vm.readFileBinary("web/page.html");
        require(html.length > 0 && html.length <= 18432, "page size");
        require(_contains(html, bytes(vm.toString(factory))), "factory address");
        vm.startBroadcast();
        PlatePage page = new PlatePage(factory, html);
        // The estimate for this storage write is tight. A limit equal to that
        // estimate runs out inside the page's factory() call. One million is enough.
        OnPlateFactory(factory).setPage{gas: 1_000_000}(address(page));
        vm.stopBroadcast();
        console2.log("page", address(page));
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
