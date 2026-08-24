// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {Test} from "forge-std/Test.sol";
import {PixelFlores} from "../src/PixelFlores.sol";

contract DeployTest is Test {
    function test_deployAndMint() public {
        PixelFlores nft = new PixelFlores("ipfs://cid/");
        assertEq(nft.baseURI(), "ipfs://cid/");
        assertEq(nft.totalMinted(), 0);
        uint256 id = nft.mint();
        assertEq(id, 1);
        assertEq(nft.ownerOf(1), address(this));
        assertEq(nft.tokenURI(1), "ipfs://cid/1.json");
        assertEq(nft.mint(), 2);
        assertEq(nft.balanceOf(address(this)), 2);
    }
}
