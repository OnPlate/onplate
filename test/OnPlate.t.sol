// SPDX-License-Identifier: MIT
pragma solidity ^0.8.37;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {BookDeployer} from "../src/BookDeployer.sol";
import {ChunkBatch} from "../src/ChunkBatch.sol";
import {ChunkBook} from "../src/ChunkBook.sol";
import {OnPlate} from "../src/OnPlate.sol";
import {OnPlateFactory} from "../src/OnPlateFactory.sol";
import {PlateChunk} from "../src/PlateChunk.sol";
import {PlateDeployer} from "../src/PlateDeployer.sol";
import {PlatePage} from "../src/PlatePage.sol";
import {PlateLimits} from "../src/PlateLimits.sol";

contract Puller {
    receive() external payable {}

    function pull(OnPlate plate, address from, address to) external {
        plate.transferFrom(from, to, 1);
    }

    function approve(OnPlate plate, address who) external {
        plate.approve(who, 1);
    }
}

contract ReenterWithdraw {
    OnPlate public plate;
    uint256 public calls;
    bool public catchIt;

    constructor(bool catchIt_) {
        catchIt = catchIt_;
    }

    function setPlate(OnPlate plate_) external {
        plate = plate_;
    }

    receive() external payable {
        calls += 1;
        if (calls == 1) {
            if (catchIt) {
                try plate.withdraw() {} catch {}
            } else {
                plate.withdraw();
            }
        }
    }
}

contract NoReceiver {
    function buy(OnPlate plate) external payable {
        plate.buy{value: msg.value}();
    }
}

contract RejectingReceiver {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        revert("no");
    }

    function buy(OnPlate plate) external payable {
        plate.buy{value: msg.value}();
    }
}

contract EvilPage {
    OnPlateFactory public hall;
    bool public catchIt;
    uint256 public hits;

    constructor(OnPlateFactory hall_, bool catchIt_) {
        hall = hall_;
        catchIt = catchIt_;
    }

    function factory() external returns (address) {
        hits += 1;
        if (catchIt) {
            try hall.setPage(address(this)) {} catch {}
            try hall.setAuthorized(address(this), true) {} catch {}
        } else {
            hall.setPage(address(this));
        }
        return address(hall);
    }
}

contract WrongPage {
    function factory() external pure returns (address) {
        return address(0x1234);
    }
}

contract ForwardNominate {
    function go(OnPlate plate, address nominee) external {
        plate.nominate(nominee);
    }
}

contract DoubleNominate {
    function go(OnPlate plate, address nominee) external {
        plate.nominate(nominee);
        plate.nominate(nominee);
    }
}

/// Red-team cases for the factory, the photograph, and the page.
contract OnPlateTest is Test {
    OnPlateFactory internal factory;
    address internal owner;
    address internal artist;
    address internal buyer;
    address internal vault;
    address internal artistPayee;

    function setUp() public {
        owner = makeAddr("owner");
        artist = makeAddr("artist");
        buyer = makeAddr("buyer");
        vault = makeAddr("vault");
        artistPayee = makeAddr("artistPayee");
        factory = _deploy(owner, 450, 700);
        vm.deal(address(this), 100 ether);
        vm.deal(owner, 100 ether);
        vm.deal(artist, 100 ether);
        vm.deal(buyer, 100 ether);
        vm.deal(vault, 100 ether);
    }

    function test_startsEmpty() public view {
        assertEq(factory.photoCount(), 0);
        assertEq(factory.photoAt(1), address(0));
        assertEq(factory.owner(), owner);
        assertEq(factory.devRecipient(), owner);
        assertEq(factory.page(), address(0));
        assertEq(factory.devBps(), 450);
        assertEq(factory.defaultArtistBps(), 700);
        assertTrue(factory.batch() != address(0));
    }

    function test_setBatchOnce() public {
        address helper = factory.batch();
        vm.prank(buyer);
        vm.expectRevert();
        factory.setBatch(helper);
        vm.prank(owner);
        vm.expectRevert(OnPlateFactory.Hook.selector);
        factory.setBatch(helper);
        vm.prank(owner);
        vm.expectRevert(OnPlateFactory.Hook.selector);
        factory.setBatch(address(0));
    }

    function test_renounceOwnershipReverts() public {
        vm.prank(owner);
        vm.expectRevert(OnPlateFactory.Hook.selector);
        factory.renounceOwnership();
        vm.prank(buyer);
        vm.expectRevert(OnPlateFactory.Hook.selector);
        factory.renounceOwnership();
        assertEq(factory.owner(), owner);
    }

    function test_transferMovesTheRoleOnly() public {
        vm.prank(owner);
        factory.setAuthorized(artist, true);
        OnPlate plate = _add(artist, 450, 1000, artistPayee);
        address chunk = plate.chunkAt(0);
        bytes32 hash = plate.contentHash();
        PlatePage page = new PlatePage(address(factory), "<p>one</p>");
        vm.prank(owner);
        factory.setPage(address(page));

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, buyer));
        factory.transferOwnership(buyer);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        factory.transferOwnership(address(0));

        vm.prank(owner);
        factory.transferOwnership(buyer);
        assertEq(factory.owner(), buyer);
        assertEq(factory.devRecipient(), owner);
        assertTrue(factory.authorized(artist));
        assertEq(factory.page(), address(page));
        assertEq(factory.photoCount(), 1);
        _samePlate(plate, chunk, hash, owner, artistPayee, 1000, artist);

        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        factory.setDevRecipient(artistPayee);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        factory.setAuthorized(buyer, true);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        factory.setPage(address(page));
        vm.stopPrank();

        assertTrue(factory.canAdd(buyer));
        assertFalse(factory.authorized(buyer));
        assertFalse(factory.canAdd(owner));
        vm.prank(buyer);
        factory.setAuthorized(artist, false);
        vm.prank(buyer);
        factory.setDevRecipient(vault);
        PlatePage next = new PlatePage(address(factory), "<p>two</p>");
        vm.prank(buyer);
        factory.setPage(address(next));
        assertEq(factory.devRecipient(), vault);
        assertEq(factory.page(), address(next));
        assertEq(page.page(), "<p>one</p>");
        assertFalse(factory.authorized(artist));
        _samePlate(plate, chunk, hash, owner, artistPayee, 1000, artist);
    }

    function test_strangerCannotAdd() public {
        vm.expectRevert(OnPlateFactory.BadChunk.selector);
        vm.prank(buyer);
        factory.addPhoto("Chaise", "A photograph.", "", keccak256(hex"010203"), address(0), _thumb(), 450, 500, artistPayee);
        vm.prank(buyer);
        vm.expectRevert(OnPlateFactory.NotAllowed.selector);
        factory.openBook(5);
        vm.prank(buyer);
        vm.expectRevert(OnPlateFactory.NotAllowed.selector);
        factory.openBook(1150);
        vm.prank(buyer);
        vm.expectRevert(OnPlateFactory.BadChunk.selector);
        factory.openBook(0);
        vm.prank(buyer);
        vm.expectRevert(OnPlateFactory.BadChunk.selector);
        factory.openBook(1151);
        assertEq(factory.photoCount(), 0);
        assertFalse(factory.canAdd(buyer));
    }

    function test_ownerCanAddWithoutBeingAuthorized() public {
        assertFalse(factory.authorized(owner));
        OnPlate plate = _add(owner, 450, 0, address(0));
        assertEq(factory.photoCount(), 1);
        assertEq(factory.photoAt(1), address(plate));
        assertTrue(factory.isPhoto(address(plate)));
        assertTrue(plate.nominationAllowed());
        assertEq(plate.artistName(), "");
        assertEq(plate.ownerOf(1), owner);
        assertEq(plate.title(), owner);
        assertEq(plate.devRecipient(), owner);
        assertEq(plate.balanceOf(owner), 1);
    }

    function test_authorizedArtist() public {
        vm.prank(owner);
        factory.setAuthorized(artist, true);
        assertTrue(factory.canAdd(artist));
        OnPlate plate = _add(artist, 450, 1000, artistPayee);
        address chunk = plate.chunkAt(0);
        bytes32 hash = plate.contentHash();
        assertEq(plate.title(), artist);
        assertEq(plate.devRecipient(), owner);
        assertEq(plate.devBps(), 450);
        assertEq(plate.artistBps(), 1000);
        assertEq(plate.artistRecipient(), artistPayee);
        assertEq(plate.ownerOf(1), artist);

        vm.prank(owner);
        factory.setAuthorized(artist, false);
        vm.expectRevert(OnPlateFactory.BadChunk.selector);
        vm.prank(artist);
        factory.addPhoto("Chaise", "A photograph.", "", keccak256(hex"010203"), address(0), _thumb(), 450, 0, artist);
        vm.prank(artist);
        vm.expectRevert(OnPlateFactory.NotAllowed.selector);
        factory.openBook(5);
        assertEq(factory.photoCount(), 1);
        assertTrue(plate.nominationAllowed());
        _samePlate(plate, chunk, hash, owner, artistPayee, 1000, artist);

        vm.prank(owner);
        factory.setAuthorized(artist, true);
        _samePlate(plate, chunk, hash, owner, artistPayee, 1000, artist);
    }

    function test_devRecipientChangesFuturePlatesOnly() public {
        OnPlate first = _add(owner, 450, 100, artistPayee);
        address chunk = first.chunkAt(0);
        bytes32 hash = first.contentHash();
        assertEq(factory.devRecipient(), owner);
        assertEq(first.devRecipient(), owner);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, buyer));
        factory.setDevRecipient(vault);
        vm.prank(owner);
        vm.expectRevert(OnPlateFactory.Hook.selector);
        factory.setDevRecipient(address(0));
        vm.prank(owner);
        vm.expectRevert(OnPlateFactory.Hook.selector);
        factory.setDevRecipient(address(factory));

        vm.prank(owner);
        factory.setDevRecipient(vault);
        _samePlate(first, chunk, hash, owner, artistPayee, 100, owner);

        OnPlate second = _add(owner, 450, 100, artistPayee);
        assertEq(second.devRecipient(), vault);
        assertEq(second.artistRecipient(), artistPayee);
        assertEq(first.devRecipient(), owner);
        assertEq(factory.photoCount(), 2);

        vm.prank(owner);
        first.list(1 ether);
        vm.prank(buyer);
        first.buy{value: 1 ether}();
        vm.prank(owner);
        second.list(1 ether);
        vm.prank(buyer);
        second.buy{value: 1 ether}();

        assertEq(first.claimable(owner), 1 ether * 9900 / 10_000);
        assertEq(first.claimable(artistPayee), 1 ether * 100 / 10_000);
        assertEq(first.claimable(vault), 0);
        assertEq(second.claimable(vault), 1 ether * 450 / 10_000);
        assertEq(second.claimable(artistPayee), 1 ether * 100 / 10_000);
        assertEq(second.claimable(owner), 1 ether * 9450 / 10_000);
        assertEq(first.devRecipient(), owner);
        assertEq(first.chunkAt(0), chunk);
        assertEq(first.contentHash(), hash);
    }

    function test_artistCannotAuthorize() public {
        vm.prank(owner);
        factory.setAuthorized(artist, true);
        vm.prank(artist);
        vm.expectRevert();
        factory.setAuthorized(buyer, true);
        assertFalse(factory.authorized(buyer));
    }

    function test_zeroAuthorizerRejected() public {
        vm.prank(owner);
        vm.expectRevert(OnPlateFactory.NotAllowed.selector);
        factory.setAuthorized(address(0), true);
    }

    function test_directPlateDeployReverts() public {
        OnPlate.Terms memory terms = OnPlate.Terms({
            title: artist,
            plateId: 1,
            contentHash: keccak256("x"),
            devBps: 450,
            artistBps: 0,
            artist: artist
        });
        vm.expectRevert(OnPlate.Hook.selector);
        new OnPlate(address(factory), terms, "Chaise", "A photograph.", "", false, address(0), _thumb(), 1);
    }

    function test_badTerms() public {
        address book = _ready(owner);
        bytes memory thumb = _thumb();

        vm.prank(owner);
        vm.expectRevert(OnPlate.Hook.selector);
        factory.addPhoto("Chaise", "", "", bytes32(0), book, thumb, 450, 0, owner);

        vm.prank(owner);
        vm.expectRevert(OnPlateFactory.Royalty.selector);
        factory.addPhoto("Chaise", "", "", keccak256("a"), book, thumb, 10001, 0, owner);

        vm.prank(owner);
        vm.expectRevert(OnPlate.Royalty.selector);
        factory.addPhoto("Chaise", "", "", keccak256("a"), book, thumb, 450, 9551, owner);

        vm.prank(owner);
        vm.expectRevert(OnPlate.Royalty.selector);
        factory.addPhoto("Chaise", "", "", keccak256("a"), book, thumb, 450, 1, address(0));

        vm.prank(owner);
        address plate = factory.addPhoto("Chaise", "", "", keccak256("a"), book, thumb, 450, 0, address(0));
        assertEq(OnPlate(plate).artistRecipient(), address(0));
        assertEq(OnPlate(plate).artistBps(), 0);

        address badName = _ready(owner);
        vm.prank(owner);
        vm.expectRevert(OnPlate.BadText.selector);
        factory.addPhoto('Say "no"', "", "", keccak256("b"), badName, thumb, 450, 0, owner);

        address badThumb = _ready(owner);
        vm.prank(owner);
        vm.expectRevert(OnPlate.BadThumb.selector);
        factory.addPhoto("Chaise", "", "", keccak256("c"), badThumb, hex"89504e470d0a1a0a", 450, 0, owner);
        assertEq(factory.photoCount(), 1);
    }

    function test_chunksMustBeReal() public {
        vm.prank(owner);
        vm.expectRevert(OnPlateFactory.BadChunk.selector);
        factory.openBook(0);

        address[] memory chunks = new address[](2);
        address one = _chunk(hex"01");
        chunks[0] = one;
        chunks[1] = one;
        vm.prank(owner);
        address book = factory.openBook(2);
        vm.prank(owner);
        vm.expectRevert(ChunkBook.BadChunk.selector);
        factory.addChunks(book, chunks);

        chunks = new address[](1);
        chunks[0] = address(new WrongPage());
        vm.prank(owner);
        book = factory.openBook(1);
        vm.prank(owner);
        vm.expectRevert(ChunkBook.BadChunk.selector);
        factory.addChunks(book, chunks);

        chunks[0] = address(0);
        vm.prank(owner);
        vm.expectRevert(ChunkBook.BadChunk.selector);
        factory.addChunks(book, chunks);
        assertEq(factory.photoCount(), 0);
        assertFalse(ChunkBook(book).locked());
    }

    function test_chunkRoundTripAndCallStops() public {
        bytes memory a = hex"ff0001";
        bytes memory b = hex"0203";
        address ca = _chunk(a);
        address cb = _chunk(b);
        (bool ok, bytes memory ret) = ca.call("");
        assertTrue(ok);
        assertEq(ret.length, 0);

        bytes memory whole = bytes.concat(a, b);
        bytes32 hash = keccak256(whole);
        OnPlate plate = _addChunks(owner, hash, _two(ca, cb), 450, 100, artistPayee);
        assertEq(plate.chunkCount(), 2);
        assertEq(plate.chunkAt(0), ca);
        assertEq(plate.readChunk(0), a);
        assertEq(plate.readChunk(1), b);
        assertEq(keccak256(bytes.concat(plate.readChunk(0), plate.readChunk(1))), hash);
        assertEq(uint8(ca.code[0]), 0);
    }

    function test_maxChunkFitsAMainnetTx() public {
        bytes memory data = new bytes(PlateLimits.CHUNK_MAX);
        data[0] = 0xff;
        data[data.length - 1] = 0xaa;
        address chunk = address(new PlateChunk(data));
        bytes memory back = _codePayload(chunk);
        assertEq(back.length, PlateLimits.CHUNK_MAX);
        assertEq(uint8(back[0]), 0xff);
        assertEq(uint8(back[back.length - 1]), 0xaa);
        assertEq(chunk.code.length, PlateLimits.CHUNK_MAX + 1);

        bytes memory too = new bytes(PlateLimits.CHUNK_MAX + 1);
        vm.expectRevert(PlateChunk.TooBig.selector);
        new PlateChunk(too);
        vm.expectRevert(PlateChunk.Empty.selector);
        new PlateChunk("");
    }

    function test_tokenURIIsOnChain() public {
        OnPlate plate = _add(owner, 450, 100, artistPayee);
        string memory json = string.concat(
            '{"name":"',
            plate.name(),
            '","description":"',
            plate.description(),
            '","artist_name":"',
            plate.artistName(),
            '","content_hash":"',
            Strings.toHexString(uint256(plate.contentHash()), 32),
            '","image":"data:image/png;base64,',
            Base64.encode(plate.thumbnail()),
            '"}'
        );
        string memory uri = plate.tokenURI(1);
        assertEq(uri, string.concat("data:application/json;base64,", Base64.encode(bytes(json))));
        assertEq(_has(uri, "http"), false);
        assertEq(_has(uri, "ipfs"), false);
        assertEq(_has(uri, "arweave"), false);
        vm.expectRevert();
        plate.tokenURI(2);
    }

    function test_approvalsAndTransfersOff() public {
        OnPlate plate = _add(owner, 450, 0, owner);
        vm.startPrank(owner);
        vm.expectRevert(OnPlate.ApprovalsOff.selector);
        plate.approve(buyer, 1);
        vm.expectRevert(OnPlate.ApprovalsOff.selector);
        plate.setApprovalForAll(buyer, true);
        vm.expectRevert(OnPlate.TransfersOff.selector);
        plate.transferFrom(owner, buyer, 1);
        vm.expectRevert(OnPlate.TransfersOff.selector);
        plate.safeTransferFrom(owner, buyer, 1);
        vm.expectRevert(OnPlate.TransfersOff.selector);
        plate.safeTransferFrom(owner, buyer, 1, "");
        vm.stopPrank();
        assertEq(plate.ownerOf(1), owner);
        assertFalse(plate.isApprovedForAll(owner, buyer));
    }

    function test_strangerTransferReverts() public {
        OnPlate plate = _add(owner, 450, 0, owner);
        Puller puller = new Puller();
        vm.prank(buyer);
        vm.expectRevert(OnPlate.TransfersOff.selector);
        puller.pull(plate, owner, buyer);
        assertEq(plate.ownerOf(1), owner);
    }

    function test_splitAndWithdraw() public {
        vm.prank(owner);
        factory.setAuthorized(artist, true);
        OnPlate plate = _add(artist, 450, 1000, artistPayee);
        vm.prank(artist);
        plate.list(10_000);
        vm.prank(buyer);
        plate.buy{value: 10_000}();

        assertEq(plate.ownerOf(1), buyer);
        assertEq(plate.title(), buyer);
        assertEq(plate.listedPrice(), 0);
        assertEq(plate.claimable(owner), 450);
        assertEq(plate.claimable(artistPayee), 1000);
        assertEq(plate.claimable(artist), 8550);
        assertEq(plate.accounted(), 10_000);
        assertEq(plate.devBps(), 450);
        assertEq(plate.artistBps(), 1000);

        uint256 payeeBefore = artistPayee.balance;
        vm.prank(artistPayee);
        plate.withdraw();
        assertEq(artistPayee.balance - payeeBefore, 1000);
        assertEq(plate.claimable(artistPayee), 0);

        vm.prank(buyer);
        vm.expectRevert(OnPlate.Nothing.selector);
        plate.withdraw();

        vm.prank(owner);
        plate.withdraw();
        vm.prank(artist);
        plate.withdraw();
        assertEq(plate.accounted(), 0);
        assertEq(address(plate).balance, 0);
    }

    function test_roundingDustStaysWithSeller() public {
        _factory(5000, 5000);
        OnPlate plate = _add(owner, 5000, 5000, artistPayee);
        vm.prank(owner);
        plate.list(3);
        vm.prank(buyer);
        plate.buy{value: 3}();
        assertEq(plate.claimable(owner), 1 + 1);
        assertEq(plate.claimable(artistPayee), 1);
        assertEq(plate.accounted(), 3);
    }

    function test_fullRoyaltyLeavesSellerTheDustOnly() public {
        _factory(10_000, 0);
        OnPlate plate = _add(owner, 10_000, 0, address(0));
        vm.prank(owner);
        plate.list(9999);
        vm.prank(buyer);
        plate.buy{value: 9999}();
        assertEq(plate.claimable(owner), 9999);
        assertEq(plate.claimable(address(0)), 0);
    }

    function test_shortAndOverPaymentRevert() public {
        OnPlate plate = _add(owner, 450, 0, owner);
        vm.prank(owner);
        plate.list(1 ether);
        vm.prank(buyer);
        vm.expectRevert(OnPlate.BadPrice.selector);
        plate.buy{value: 1 ether - 1}();
        vm.prank(buyer);
        vm.expectRevert(OnPlate.BadPrice.selector);
        plate.buy{value: 1 ether + 1}();
        assertEq(plate.ownerOf(1), owner);
        assertEq(address(plate).balance, 0);
    }

    function test_selfBuyReverts() public {
        OnPlate plate = _add(owner, 450, 0, owner);
        vm.prank(owner);
        plate.list(1 ether);
        vm.prank(owner);
        vm.expectRevert(OnPlate.Hook.selector);
        plate.buy{value: 1 ether}();
    }

    function test_publicPriceUpdateThenSale() public {
        OnPlate plate = _add(owner, 450, 1000, artistPayee);
        vm.startPrank(owner);
        plate.list(1 ether);
        plate.list(2 ether);
        assertEq(plate.listedPrice(), 2 ether);
        assertEq(plate.allowedBuyer(), address(0));
        plate.cancel();
        assertEq(plate.listedPrice(), 0);
        plate.list(1 ether);
        vm.stopPrank();

        vm.prank(buyer);
        plate.buy{value: 1 ether}();
        assertEq(plate.ownerOf(1), buyer);
        assertEq(plate.title(), buyer);
        assertEq(plate.listedPrice(), 0);
        assertEq(plate.allowedBuyer(), address(0));
        assertEq(plate.claimable(owner), 0.9 ether);
        assertEq(plate.claimable(artistPayee), 0.1 ether);
        assertEq(plate.claimable(owner) + plate.claimable(artistPayee), 1 ether);
    }

    function test_namedBuyerIsTheOnlyPurchaser() public {
        OnPlate plate = _add(owner, 450, 0, address(0));
        address other = makeAddr("other");
        vm.deal(other, 2 ether);
        vm.startPrank(owner);
        plate.setAllowedBuyer(buyer);
        plate.list(1 ether);
        plate.list(2 ether);
        assertEq(plate.allowedBuyer(), buyer);
        assertEq(plate.listedPrice(), 2 ether);
        vm.stopPrank();

        vm.prank(other);
        vm.expectRevert(OnPlate.NotBuyer.selector);
        plate.buy{value: 2 ether}();
        assertEq(plate.ownerOf(1), owner);
        assertEq(plate.listedPrice(), 2 ether);

        vm.prank(buyer);
        plate.buy{value: 2 ether}();
        assertEq(plate.ownerOf(1), buyer);
        assertEq(plate.title(), buyer);
        assertEq(plate.allowedBuyer(), address(0));
    }

    function test_ownerReplacesAndClearsBuyer() public {
        OnPlate plate = _add(owner, 0, 0, address(0));
        address other = makeAddr("other");
        vm.deal(other, 2 ether);
        vm.startPrank(owner);
        plate.setAllowedBuyer(buyer);
        plate.setAllowedBuyer(other);
        plate.list(1 ether);
        vm.stopPrank();

        vm.prank(buyer);
        vm.expectRevert(OnPlate.NotBuyer.selector);
        plate.buy{value: 1 ether}();

        vm.prank(owner);
        plate.setAllowedBuyer(address(0));
        vm.prank(buyer);
        plate.buy{value: 1 ether}();
        assertEq(plate.ownerOf(1), buyer);
        assertEq(plate.allowedBuyer(), address(0));
    }

    function test_buyerChangeRevertsWhileParked() public {
        OnPlate plate = _add(owner, 0, 0, address(0));
        vm.startPrank(owner);
        plate.setAllowedBuyer(buyer);
        plate.list(1 ether);
        plate.setMailbox(vault);
        assertEq(plate.listedPrice(), 0);
        assertEq(plate.allowedBuyer(), address(0));
        vm.expectRevert(OnPlate.Hook.selector);
        plate.setAllowedBuyer(address(0));
        vm.expectRevert(OnPlate.Hook.selector);
        plate.setAllowedBuyer(artist);
        vm.expectRevert(OnPlate.Hook.selector);
        plate.cancel();
        vm.stopPrank();
        vm.prank(vault);
        vm.expectRevert(OnPlate.Hook.selector);
        plate.setAllowedBuyer(vault);
        vm.prank(vault);
        vm.expectRevert(OnPlate.Hook.selector);
        plate.cancel();
        assertEq(plate.allowedBuyer(), address(0));
        assertEq(plate.listedPrice(), 0);
        assertTrue(plate.parked());

        vm.prank(vault);
        plate.release();
        assertEq(plate.allowedBuyer(), address(0));
        assertEq(plate.listedPrice(), 0);
        assertFalse(plate.parked());
        vm.prank(buyer);
        vm.expectRevert(OnPlate.NotListed.selector);
        plate.buy{value: 1 ether}();
        vm.prank(owner);
        plate.list(1 ether);
        vm.prank(buyer);
        plate.buy{value: 1 ether}();
        assertEq(plate.ownerOf(1), buyer);
        assertEq(plate.title(), buyer);
    }

    function test_uploaderCannotListAfterSale() public {
        vm.prank(owner);
        factory.setAuthorized(artist, true);
        OnPlate plate = _add(artist, 0, 0, address(0));
        vm.prank(artist);
        plate.list(1 ether);
        vm.prank(buyer);
        plate.buy{value: 1 ether}();

        vm.prank(artist);
        vm.expectRevert(OnPlate.NotTitle.selector);
        plate.list(1 ether);
        vm.prank(artist);
        vm.expectRevert(OnPlate.NotTitle.selector);
        plate.cancel();
        vm.prank(artist);
        vm.expectRevert(OnPlate.NotTitle.selector);
        plate.setAllowedBuyer(artist);

        vm.startPrank(buyer);
        plate.setAllowedBuyer(artist);
        plate.list(1 ether);
        vm.stopPrank();
        assertEq(plate.allowedBuyer(), artist);
        assertEq(plate.title(), buyer);
    }

    function test_strangerListReverts() public {
        OnPlate plate = _add(owner, 450, 0, owner);
        vm.prank(buyer);
        vm.expectRevert(OnPlate.NotTitle.selector);
        plate.list(1 ether);
    }

    function test_cancelAndRelist() public {
        OnPlate plate = _add(owner, 450, 0, owner);
        vm.startPrank(owner);
        vm.expectRevert(OnPlate.BadPrice.selector);
        plate.list(0);
        plate.list(1 ether);
        plate.setAllowedBuyer(buyer);
        plate.list(2 ether);
        plate.cancel();
        assertEq(plate.listedPrice(), 0);
        assertEq(plate.allowedBuyer(), buyer);
        vm.stopPrank();
        vm.prank(buyer);
        vm.expectRevert(OnPlate.NotListed.selector);
        plate.buy{value: 2 ether}();
        vm.prank(buyer);
        vm.expectRevert(OnPlate.NotTitle.selector);
        plate.cancel();
    }

    function test_buyDoesNotCallReceiver() public {
        OnPlate plate = _add(owner, 0, 0, owner);
        vm.prank(owner);
        plate.list(1 ether);

        NoReceiver plain = new NoReceiver();
        vm.deal(address(plain), 2 ether);
        plain.buy{value: 1 ether}(plate);
        assertEq(plate.ownerOf(1), address(plain));

        vm.prank(address(plain));
        plate.list(1 ether);
        RejectingReceiver picky = new RejectingReceiver();
        vm.deal(address(picky), 2 ether);
        picky.buy{value: 1 ether}(plate);
        assertEq(plate.ownerOf(1), address(picky));
    }

    function test_reentrancyOnWithdrawPaysOnce() public {
        ReenterWithdraw sink = new ReenterWithdraw(true);
        _factory(0, 0);
        OnPlate plate = _add(owner, 0, 10_000, address(sink));
        sink.setPlate(plate);
        vm.prank(owner);
        plate.list(1 ether);
        vm.prank(buyer);
        plate.buy{value: 1 ether}();
        assertEq(plate.claimable(address(sink)), 1 ether);
        uint256 before = address(sink).balance;
        vm.prank(address(sink));
        plate.withdraw();
        assertEq(address(sink).balance - before, 1 ether);
        assertEq(sink.calls(), 1);
        assertEq(plate.claimable(address(sink)), 0);
        vm.prank(address(sink));
        vm.expectRevert(OnPlate.Nothing.selector);
        plate.withdraw();
    }

    function test_revertingReceiverDoesNotTakeTheBalance() public {
        ReenterWithdraw sink = new ReenterWithdraw(false);
        _factory(0, 0);
        OnPlate plate = _add(owner, 0, 10_000, address(sink));
        sink.setPlate(plate);
        vm.prank(owner);
        plate.list(1 ether);
        vm.prank(buyer);
        plate.buy{value: 1 ether}();
        vm.prank(address(sink));
        vm.expectRevert(OnPlate.Unpaid.selector);
        plate.withdraw();
        assertEq(plate.claimable(address(sink)), 1 ether);
        assertEq(plate.accounted(), 1 ether);
    }

    function test_forceFedEthIsNotWithdrawable() public {
        OnPlate plate = _add(owner, 0, 0, owner);
        vm.prank(owner);
        plate.list(1 ether);
        vm.prank(buyer);
        plate.buy{value: 1 ether}();
        vm.deal(address(plate), address(plate).balance + 5 ether);
        vm.prank(owner);
        plate.withdraw();
        assertEq(address(plate).balance, 5 ether);
        assertEq(plate.accounted(), 0);
    }

    function test_directEthReverts() public {
        OnPlate plate = _add(owner, 0, 0, owner);
        vm.prank(buyer);
        (bool ok,) = address(plate).call{value: 1 ether}("");
        assertFalse(ok);
        vm.prank(buyer);
        (ok,) = address(factory).call{value: 1 ether}("");
        assertFalse(ok);
    }

    function test_vaultRoundTrip() public {
        OnPlate plate = _add(owner, 450, 0, owner);
        vm.startPrank(owner);
        plate.setAllowedBuyer(buyer);
        plate.list(1 ether);
        plate.setMailbox(vault);
        vm.stopPrank();
        assertEq(plate.ownerOf(1), vault);
        assertEq(plate.title(), owner);
        assertEq(plate.mailbox(), vault);
        assertTrue(plate.parked());
        assertEq(plate.listedPrice(), 0);
        assertEq(plate.allowedBuyer(), address(0));

        vm.prank(buyer);
        vm.expectRevert(OnPlate.NotListed.selector);
        plate.buy{value: 1 ether}();
        vm.prank(owner);
        vm.expectRevert(OnPlate.Hook.selector);
        plate.cancel();
        vm.prank(owner);
        vm.expectRevert(OnPlate.NotTitle.selector);
        plate.list(1 ether);
        vm.prank(owner);
        vm.expectRevert(OnPlate.NotTitle.selector);
        plate.clearMailbox();
        vm.prank(vault);
        vm.expectRevert(OnPlate.TransfersOff.selector);
        plate.transferFrom(vault, buyer, 1);
        vm.prank(owner);
        vm.expectRevert(OnPlate.Hook.selector);
        plate.release();

        vm.prank(vault);
        plate.release();
        assertEq(plate.ownerOf(1), owner);
        assertEq(plate.title(), owner);
        assertEq(plate.mailbox(), vault);
        assertFalse(plate.parked());
        assertEq(plate.listedPrice(), 0);
        assertEq(plate.allowedBuyer(), address(0));

        vm.prank(owner);
        plate.clearMailbox();
        assertEq(plate.mailbox(), address(0));
        vm.prank(buyer);
        vm.expectRevert(OnPlate.NotListed.selector);
        plate.buy{value: 1 ether}();
    }

    function test_titleCannotPull() public {
        OnPlate plate = _add(owner, 0, 0, owner);
        vm.prank(owner);
        plate.setMailbox(vault);
        Puller puller = new Puller();
        vm.prank(owner);
        vm.expectRevert(OnPlate.TransfersOff.selector);
        puller.pull(plate, vault, owner);
        assertEq(plate.ownerOf(1), vault);
    }

    function test_badVaultRejected() public {
        OnPlate plate = _add(owner, 0, 0, owner);
        vm.startPrank(owner);
        vm.expectRevert(OnPlate.Hook.selector);
        plate.setMailbox(address(0));
        vm.expectRevert(OnPlate.Hook.selector);
        plate.setMailbox(address(plate));
        vm.expectRevert(OnPlate.Hook.selector);
        plate.setMailbox(owner);
        vm.stopPrank();
        assertEq(plate.ownerOf(1), owner);
    }

    function test_typoParkIsPermanentUntilThatVaultReturns() public {
        address typo = makeAddr("typo");
        OnPlate plate = _add(owner, 0, 0, owner);
        vm.prank(owner);
        plate.setMailbox(typo);
        vm.startPrank(owner);
        vm.expectRevert(OnPlate.NotTitle.selector);
        plate.clearMailbox();
        vm.expectRevert(OnPlate.Hook.selector);
        plate.release();
        vm.expectRevert(OnPlate.TransfersOff.selector);
        plate.transferFrom(typo, owner, 1);
        vm.stopPrank();
        assertEq(plate.ownerOf(1), typo);
        vm.prank(typo);
        plate.release();
        assertEq(plate.ownerOf(1), owner);
    }

    function test_saleClearsANamedVault() public {
        OnPlate plate = _add(owner, 0, 0, owner);
        vm.prank(owner);
        plate.setMailbox(vault);
        vm.prank(vault);
        plate.release();
        assertEq(plate.mailbox(), vault);
        vm.prank(owner);
        plate.list(1 ether);
        vm.prank(buyer);
        plate.buy{value: 1 ether}();
        assertEq(plate.ownerOf(1), buyer);
        assertEq(plate.title(), buyer);
        assertEq(plate.mailbox(), address(0));
        assertFalse(plate.parked());
    }

    function test_twoPhotosDoNotShareAVault() public {
        OnPlate first = _add(owner, 0, 0, owner);
        OnPlate second = _add(owner, 0, 0, owner);
        vm.prank(owner);
        first.setMailbox(vault);
        assertEq(second.ownerOf(1), owner);
        assertEq(second.mailbox(), address(0));
        vm.prank(vault);
        vm.expectRevert(OnPlate.Hook.selector);
        second.release();
    }

    function test_pageReplacesWithoutTouchingPlates() public {
        OnPlate plate = _add(owner, 450, 0, address(0));
        address chunk = plate.chunkAt(0);
        bytes32 hash = plate.contentHash();
        PlatePage page = new PlatePage(address(factory), "<!doctype html><p>OnPlate</p>");
        vm.prank(artist);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, artist));
        factory.setPage(address(page));
        vm.prank(owner);
        factory.setPage(address(page));
        assertEq(factory.page(), address(page));
        assertEq(page.page(), "<!doctype html><p>OnPlate</p>");

        vm.prank(owner);
        vm.expectRevert(OnPlateFactory.BadPage.selector);
        factory.setPage(address(0));
        vm.prank(owner);
        vm.expectRevert(OnPlateFactory.BadPage.selector);
        factory.setPage(owner);
        bytes memory big = new bytes(PlateLimits.CHUNK_MAX + 1);
        vm.expectRevert(PlatePage.BadPage.selector);
        new PlatePage(address(factory), big);
        assertEq(factory.page(), address(page));

        PlatePage next = new PlatePage(address(factory), "<p>next</p>");
        vm.prank(owner);
        factory.setPage(address(next));
        assertEq(factory.page(), address(next));
        assertEq(page.page(), "<!doctype html><p>OnPlate</p>");
        assertEq(next.page(), "<p>next</p>");
        assertEq(factory.photoCount(), 1);
        _samePlate(plate, chunk, hash, owner, address(0), 0, owner);

        WrongPage wrong = new WrongPage();
        vm.prank(owner);
        vm.expectRevert(OnPlateFactory.BadPage.selector);
        factory.setPage(address(wrong));
        assertEq(factory.page(), address(next));
        _samePlate(plate, chunk, hash, owner, address(0), 0, owner);
    }

    function test_pageMustNameThisFactory() public {
        WrongPage wrong = new WrongPage();
        vm.prank(owner);
        vm.expectRevert(OnPlateFactory.BadPage.selector);
        factory.setPage(address(wrong));
        assertEq(factory.page(), address(0));

        OnPlateFactory other = _deploy(owner, 450, 700);
        PlatePage foreign = new PlatePage(address(other), "<p>no</p>");
        vm.prank(owner);
        vm.expectRevert(OnPlateFactory.BadPage.selector);
        factory.setPage(address(foreign));
    }

    function test_evilPageCannotReenter() public {
        EvilPage evil = new EvilPage(factory, false);
        vm.prank(owner);
        vm.expectRevert();
        factory.setPage(address(evil));
        assertEq(factory.page(), address(0));
        assertEq(factory.photoCount(), 0);

        EvilPage caught = new EvilPage(factory, true);
        vm.prank(owner);
        factory.setPage(address(caught));
        assertEq(factory.page(), address(caught));
        assertEq(factory.photoCount(), 0);
        assertFalse(factory.authorized(address(caught)));
        assertEq(caught.hits(), 1);
    }

    function test_royaltiesDoNotMove() public {
        OnPlate plate = _add(owner, 450, 100, artistPayee);
        vm.prank(owner);
        plate.list(1 ether);
        vm.prank(buyer);
        plate.buy{value: 1 ether}();
        vm.prank(buyer);
        plate.setMailbox(vault);
        vm.prank(vault);
        plate.release();
        assertEq(plate.devBps(), 450);
        assertEq(plate.artistBps(), 100);
        assertEq(plate.devRecipient(), owner);
        assertEq(plate.artistRecipient(), artistPayee);
    }

    function _samePlate(
        OnPlate plate,
        address chunk,
        bytes32 hash,
        address dev,
        address artistTo,
        uint16 artistBps,
        address holder
    ) internal view {
        assertEq(plate.chunkAt(0), chunk);
        assertEq(plate.contentHash(), hash);
        assertEq(plate.devRecipient(), dev);
        assertEq(plate.artistRecipient(), artistTo);
        assertEq(plate.devBps(), 450);
        assertEq(plate.artistBps(), artistBps);
        assertEq(plate.ownerOf(1), holder);
        assertEq(plate.title(), holder);
    }

    function _terms(address title, bytes32 hash, uint16 devBps, uint16 artistBps, address artist_)
        internal
        pure
        returns (OnPlate.Terms memory)
    {
        return OnPlate.Terms({
            title: title,
            plateId: 0,
            contentHash: hash,
            devBps: devBps,
            artistBps: artistBps,
            artist: artist_
        });
    }

    function _codePayload(address chunk) internal view returns (bytes memory out) {
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

    function _init(bytes memory data) internal pure returns (bytes memory) {
        return abi.encodePacked(type(PlateChunk).creationCode, abi.encode(data));
    }

    function _mintOn(OnPlateFactory hall, address who, bytes memory data) internal returns (address) {
        bytes[] memory inits = new bytes[](1);
        inits[0] = _init(data);
        address helper = hall.batch();
        vm.prank(who);
        return ChunkBatch(helper).createPieces(inits)[0];
    }

    function _mint(address who, bytes memory data) internal returns (address) {
        return _mintOn(factory, who, data);
    }

    function _chunk(bytes memory data) internal returns (address) {
        return _mint(owner, data);
    }

    function _two(address a, address b) internal pure returns (address[] memory chunks) {
        chunks = new address[](2);
        chunks[0] = a;
        chunks[1] = b;
    }

    function _thumb() internal pure returns (bytes memory t) {
        t = new bytes(32);
        t[0] = 0x89;
        t[1] = 0x50;
        t[2] = 0x4e;
        t[3] = 0x47;
        t[4] = 0x0d;
        t[5] = 0x0a;
        t[6] = 0x1a;
        t[7] = 0x0a;
        t[11] = bytes1(uint8(13));
        t[12] = "I";
        t[13] = "H";
        t[14] = "D";
        t[15] = "R";
        t[19] = bytes1(uint8(48));
        t[23] = bytes1(uint8(48));
        t[24] = bytes1(uint8(8));
    }

    function test_factoryRejectsBadRoyaltyDefaults() public {
        vm.expectRevert(OnPlateFactory.Royalty.selector);
        new OnPlateFactory(10001, 0, address(1), address(2));
        vm.expectRevert(OnPlateFactory.Royalty.selector);
        new OnPlateFactory(0, 10001, address(1), address(2));
        vm.expectRevert(OnPlateFactory.Royalty.selector);
        new OnPlateFactory(6000, 4001, address(1), address(2));
        OnPlateFactory ok = _deploy(owner, 10_000, 0);
        assertEq(ok.devBps(), 10_000);
        assertEq(ok.defaultArtistBps(), 0);
    }

    function test_addPhotoRejectsOtherDevBps() public {
        bytes memory thumb = _thumb();
        vm.prank(owner);
        vm.expectRevert(OnPlateFactory.Royalty.selector);
        factory.addPhoto("Chaise", "", "", keccak256("a"), address(0), thumb, 0, 0, address(0));
        vm.prank(owner);
        vm.expectRevert(OnPlateFactory.Royalty.selector);
        factory.addPhoto("Chaise", "", "", keccak256("b"), address(0), thumb, 451, 0, address(0));
        assertEq(factory.photoCount(), 0);
    }

    function _factory(uint16 devBps_, uint16 defaultArtistBps_) internal {
        factory = _deploy(owner, devBps_, defaultArtistBps_);
    }

    /// The owner creates all three. Nonce N and N+1 are the creators. Nonce N+2 is the factory.
    /// `vm.prank` also changes who `new` deploys from, so the prediction uses the owner.
    /// The piece helper is deployed next and set once.
    function _deploy(address owner_, uint16 devBps_, uint16 artistBps_) internal returns (OnPlateFactory made) {
        address predicted = vm.computeCreateAddress(owner_, vm.getNonce(owner_) + 2);
        vm.startPrank(owner_);
        PlateDeployer plateSource = new PlateDeployer(predicted);
        BookDeployer bookSource = new BookDeployer(predicted);
        made = new OnPlateFactory(devBps_, artistBps_, address(plateSource), address(bookSource));
        ChunkBatch helper = new ChunkBatch();
        made.setBatch(address(helper));
        vm.stopPrank();
        assertEq(address(made), predicted);
        assertEq(made.batch(), address(helper));
    }

    function _add(address title, uint16 devBps, uint16 artistBps, address artist_) internal returns (OnPlate) {
        address[] memory chunks = new address[](1);
        chunks[0] = _mint(title, hex"010203");
        return _addChunks(title, keccak256(hex"010203"), chunks, devBps, artistBps, artist_);
    }

    function _addChunks(
        address title,
        bytes32 hash,
        address[] memory chunks,
        uint16,
        uint16 artistBps,
        address artist_
    ) internal returns (OnPlate) {
        uint16 dev = factory.devBps();
        vm.startPrank(title);
        address book = factory.openBook(chunks.length);
        uint256 off = 0;
        while (off < chunks.length) {
            uint256 n = chunks.length - off;
            if (n > factory.APPEND_MAX()) n = factory.APPEND_MAX();
            address[] memory batch = new address[](n);
            for (uint256 i = 0; i < n; ++i) batch[i] = chunks[off + i];
            factory.addChunks(book, batch);
            off += n;
        }
        factory.sealBook(book);
        address plate = factory.addPhoto("Chaise", "A photograph.", "", hash, book, _thumb(), dev, artistBps, artist_);
        vm.stopPrank();
        return OnPlate(plate);
    }

    function _ready(address title) internal returns (address book) {
        address[] memory chunks = new address[](1);
        chunks[0] = _mint(title, hex"abcdef");
        vm.startPrank(title);
        book = factory.openBook(1);
        factory.addChunks(book, chunks);
        factory.sealBook(book);
        vm.stopPrank();
    }

    function _has(string memory s, string memory needle) internal pure returns (bool) {
        bytes memory hay = bytes(s);
        bytes memory pin = bytes(needle);
        if (pin.length == 0 || hay.length < pin.length) return false;
        for (uint256 i = 0; i <= hay.length - pin.length; ++i) {
            bool match_ = true;
            for (uint256 j = 0; j < pin.length; ++j) {
                if (hay[i + j] != pin[j]) {
                    match_ = false;
                    break;
                }
            }
            if (match_) return true;
        }
        return false;
    }

    function _sell(OnPlate plate, address from, address to, uint256 price) internal {
        vm.prank(from);
        plate.list(price);
        vm.prank(to);
        plate.buy{value: price}();
    }

    function test_nominateOnceThenDenied() public {
        address nominee = makeAddr("nominee");
        OnPlate plate = _add(owner, 0, 0, address(0));
        assertEq(plate.vaultedSince(), 0);
        assertFalse(plate.nominationOpen());
        vm.warp(block.timestamp + 30 days);
        vm.prank(owner);
        plate.setMailbox(vault);
        uint256 since = plate.vaultedSince();
        assertEq(since, block.timestamp);
        assertTrue(plate.nominationOpen());

        vm.prank(vault);
        vm.expectRevert(OnPlate.Nomination.selector);
        plate.nominate(nominee);
        vm.prank(owner);
        vm.expectRevert(OnPlate.Nomination.selector);
        plate.nominate(nominee);
        assertFalse(plate.nominated());

        vm.warp(block.timestamp + 30 days);
        assertEq(plate.vaultedSince(), since);
        vm.prank(vault);
        vm.expectRevert(OnPlate.Nomination.selector);
        plate.nominate(nominee);
        vm.expectEmit(true, false, false, true, address(factory));
        emit OnPlateFactory.Authorized(nominee, true);
        vm.expectEmit(true, true, false, true, address(plate));
        emit OnPlate.Nominated(nominee, owner);
        vm.prank(owner);
        plate.nominate(nominee);
        assertTrue(plate.nominated());
        assertFalse(plate.nominationRevoked());
        assertFalse(plate.nominationOpen());
        assertTrue(factory.authorized(nominee));
        assertTrue(factory.canAdd(nominee));
        assertEq(plate.ownerOf(1), vault);
        assertEq(plate.title(), owner);
        assertEq(plate.listedPrice(), 0);
        assertEq(plate.accounted(), 0);
        assertEq(address(plate).balance, 0);

        vm.prank(owner);
        vm.expectRevert(OnPlate.Nomination.selector);
        plate.nominate(nominee);
        vm.prank(vault);
        vm.expectRevert(OnPlate.Nomination.selector);
        plate.nominate(makeAddr("later"));
        vm.warp(block.timestamp + 30 days);
        vm.prank(vault);
        vm.expectRevert(OnPlate.Nomination.selector);
        plate.nominate(nominee);

        vm.prank(vault);
        plate.release();
        assertEq(plate.ownerOf(1), owner);
        OnPlate second = _add(nominee, 0, 0, address(0));
        assertEq(second.title(), nominee);
        assertEq(factory.photoCount(), 2);
    }

    function test_unvaultRestoresPotential() public {
        address nominee = makeAddr("nominee");
        OnPlate plate = _add(owner, 0, 0, address(0));
        vm.warp(block.timestamp + 30 days);
        vm.prank(owner);
        plate.setMailbox(vault);
        vm.prank(owner);
        vm.expectRevert(OnPlate.Nomination.selector);
        plate.nominate(nominee);
        vm.warp(block.timestamp + 30 days);
        vm.prank(vault);
        plate.release();
        assertFalse(plate.nominated());
        assertFalse(plate.nominationRevoked());
        assertFalse(plate.nominationOpen());
        assertEq(plate.vaultedSince(), 0);
        vm.prank(owner);
        plate.setMailbox(vault);
        assertTrue(plate.nominationOpen());
        assertEq(plate.vaultedSince(), block.timestamp);
        vm.prank(owner);
        vm.expectRevert(OnPlate.Nomination.selector);
        plate.nominate(nominee);
        vm.warp(block.timestamp + 29 days);
        vm.prank(vault);
        vm.expectRevert(OnPlate.Nomination.selector);
        plate.nominate(nominee);
        assertFalse(plate.nominated());
        vm.warp(block.timestamp + 1 days);
        vm.prank(owner);
        plate.nominate(nominee);
        assertTrue(plate.nominated());
        assertTrue(factory.authorized(nominee));
    }

    function test_vaultOf29DaysCannotNominate() public {
        address nominee = makeAddr("nominee");
        OnPlate plate = _add(owner, 0, 0, address(0));
        vm.warp(block.timestamp + 30 days);
        vm.prank(owner);
        plate.setMailbox(vault);
        vm.warp(block.timestamp + 29 days);
        vm.prank(owner);
        vm.expectRevert(OnPlate.Nomination.selector);
        plate.nominate(nominee);
        vm.prank(vault);
        vm.expectRevert(OnPlate.Nomination.selector);
        plate.nominate(nominee);
        assertFalse(plate.nominated());
        assertFalse(factory.authorized(nominee));

        OnPlate other = _add(owner, 0, 0, address(0));
        vm.prank(owner);
        other.setMailbox(vault);
        vm.warp(block.timestamp + 30 days - 1);
        vm.prank(owner);
        vm.expectRevert(OnPlate.Nomination.selector);
        other.nominate(nominee);
        vm.warp(block.timestamp + 1);
        vm.prank(vault);
        vm.expectRevert(OnPlate.Nomination.selector);
        other.nominate(nominee);
        vm.prank(owner);
        other.nominate(nominee);
        assertTrue(other.nominated());
        assertTrue(factory.authorized(nominee));
    }

    function test_nominateRequiresVault() public {
        address nominee = makeAddr("nominee");
        OnPlate plate = _add(owner, 0, 0, address(0));
        vm.warp(block.timestamp + 30 days);
        vm.prank(owner);
        vm.expectRevert(OnPlate.Nomination.selector);
        plate.nominate(nominee);
        vm.prank(buyer);
        vm.expectRevert(OnPlate.Nomination.selector);
        plate.nominate(nominee);
        assertFalse(plate.nominated());
        assertFalse(factory.authorized(nominee));

        vm.prank(owner);
        plate.setMailbox(vault);
        vm.warp(block.timestamp + 30 days);
        vm.prank(buyer);
        vm.expectRevert(OnPlate.Nomination.selector);
        plate.nominate(nominee);
        vm.prank(owner);
        vm.expectRevert(OnPlateFactory.NotAllowed.selector);
        plate.nominate(address(0));
        vm.prank(owner);
        vm.expectRevert(OnPlateFactory.NotAllowed.selector);
        plate.nominate(address(factory));
        assertFalse(plate.nominated());
        assertFalse(factory.authorized(address(0)));
        assertFalse(factory.authorized(address(factory)));
        vm.prank(owner);
        plate.nominate(nominee);
        assertTrue(plate.nominated());
        assertTrue(factory.authorized(nominee));
        assertEq(plate.ownerOf(1), vault);
    }

    function test_saleBelowRevokesNomination() public {
        address nominee = makeAddr("nominee");
        address again = makeAddr("again");
        vm.deal(again, 10 ether);
        OnPlate plate = _add(owner, 450, 1000, artistPayee);
        vm.prank(owner);
        plate.setMailbox(vault);
        assertEq(plate.originalPrice(), 0);
        assertTrue(plate.nominationOpen());
        vm.prank(vault);
        plate.release();
        assertEq(plate.vaultedSince(), 0);
        vm.prank(owner);
        plate.clearMailbox();
        vm.startPrank(owner);
        plate.list(1 ether);
        plate.cancel();
        vm.stopPrank();
        vm.prank(owner);
        vm.expectRevert(OnPlate.TransfersOff.selector);
        plate.transferFrom(owner, buyer, 1);
        assertFalse(plate.nominationOpen());
        assertEq(plate.originalPrice(), 0);
        assertFalse(plate.nominationRevoked());
        assertFalse(plate.nominated());

        _sell(plate, owner, buyer, 2 ether);
        assertEq(plate.originalPrice(), 2 ether);
        assertFalse(plate.nominationRevoked());
        assertEq(plate.vaultedSince(), 0);
        assertEq(plate.claimable(owner), 1.8 ether);
        assertEq(plate.claimable(artistPayee), 0.2 ether);
        assertEq(plate.accounted(), 2 ether);

        _sell(plate, buyer, again, 2 ether);
        assertFalse(plate.nominationRevoked());
        _sell(plate, again, buyer, 3 ether);
        assertFalse(plate.nominationRevoked());
        assertEq(plate.originalPrice(), 2 ether);

        uint256 devBefore = plate.claimable(owner);
        uint256 artistBefore = plate.claimable(artistPayee);
        uint256 sellerBefore = plate.claimable(buyer);
        vm.prank(buyer);
        plate.list(1 ether);
        vm.expectEmit(true, true, true, true, address(plate));
        emit IERC721.Transfer(buyer, again, 1);
        vm.expectEmit(false, false, false, true, address(plate));
        emit OnPlate.NominationRevoked(1 ether);
        vm.prank(again);
        plate.buy{value: 1 ether}();
        assertTrue(plate.nominationRevoked());
        assertEq(plate.originalPrice(), 2 ether);
        assertEq(plate.claimable(owner) - devBefore, 0.045 ether);
        assertEq(plate.claimable(artistPayee) - artistBefore, 0.1 ether);
        assertEq(plate.claimable(buyer) - sellerBefore, 0.855 ether);

        vm.prank(again);
        plate.setMailbox(vault);
        vm.warp(block.timestamp + 30 days);
        assertGt(plate.vaultedSince(), 0);
        vm.prank(again);
        vm.expectRevert(OnPlate.Nomination.selector);
        plate.nominate(nominee);
        vm.prank(vault);
        vm.expectRevert(OnPlate.Nomination.selector);
        plate.nominate(nominee);
        assertFalse(plate.nominated());
        assertFalse(factory.authorized(nominee));
        vm.prank(vault);
        plate.release();
        uint256 due = plate.claimable(buyer);
        uint256 bal = buyer.balance;
        vm.prank(buyer);
        plate.withdraw();
        assertEq(buyer.balance - bal, due);
        assertEq(plate.claimable(buyer), 0);
        _sell(plate, again, buyer, 1 ether);
        assertTrue(plate.nominationRevoked());
        assertEq(plate.ownerOf(1), buyer);
    }

    function test_saleAboveKeepsPotential() public {
        address nominee = makeAddr("nominee");
        OnPlate plate = _add(owner, 0, 0, address(0));
        _sell(plate, owner, buyer, 1 ether);
        assertEq(plate.originalPrice(), 1 ether);
        assertFalse(plate.nominationRevoked());
        assertEq(plate.vaultedSince(), 0);
        vm.prank(owner);
        plate.withdraw();
        assertEq(plate.accounted(), 0);
        assertEq(address(plate).balance, 0);

        vm.warp(block.timestamp + 30 days);
        _sell(plate, buyer, owner, 1 ether);
        assertFalse(plate.nominationRevoked());
        _sell(plate, owner, buyer, 2 ether);
        assertFalse(plate.nominationRevoked());
        assertEq(plate.originalPrice(), 1 ether);
        assertEq(plate.vaultedSince(), 0);
        vm.prank(buyer);
        plate.setMailbox(vault);
        vm.prank(buyer);
        vm.expectRevert(OnPlate.Nomination.selector);
        plate.nominate(nominee);
        vm.warp(block.timestamp + 30 days);
        vm.prank(buyer);
        plate.nominate(nominee);
        assertTrue(plate.nominated());
        assertTrue(factory.authorized(nominee));
        assertEq(plate.ownerOf(1), vault);
        // Artist share is 0. The factory dev share is still 450 bps.
        // The equal 1 ether sale left 0.045 with the dev recipient.
        // The 2 ether sale adds 0.09 dev and 1.91 seller, both the owner.
        assertEq(plate.claimable(owner), 2.045 ether);
        assertEq(plate.claimable(buyer), 0.955 ether);
        assertEq(plate.accounted(), 3 ether);
        assertEq(address(plate).balance, 3 ether);
    }

    function test_ownerAuthorizeIgnoresNomination() public {
        address nominee = makeAddr("nominee");
        address other = makeAddr("other");
        OnPlate plate = _add(owner, 0, 0, address(0));
        vm.prank(owner);
        plate.setMailbox(vault);
        vm.prank(owner);
        factory.setAuthorized(other, true);
        assertFalse(plate.nominated());
        assertTrue(plate.nominationOpen());
        assertTrue(factory.canAdd(other));
        assertFalse(factory.authorized(owner));
        vm.prank(owner);
        vm.expectRevert(OnPlate.Nomination.selector);
        plate.nominate(nominee);
        assertFalse(plate.nominated());
        vm.warp(block.timestamp + 30 days);
        vm.prank(owner);
        plate.nominate(nominee);
        assertTrue(factory.authorized(nominee));
        assertTrue(factory.authorized(other));
        vm.prank(owner);
        factory.setAuthorized(nominee, false);
        assertFalse(factory.authorized(nominee));
        assertTrue(plate.nominated());
        vm.prank(owner);
        vm.expectRevert(OnPlate.Nomination.selector);
        plate.nominate(nominee);
        vm.prank(owner);
        factory.setAuthorized(nominee, true);
        assertTrue(factory.canAdd(nominee));
        vm.prank(owner);
        vm.expectRevert(OnPlateFactory.NotAllowed.selector);
        factory.authorizeNominee(other);
        vm.prank(buyer);
        vm.expectRevert(OnPlateFactory.NotAllowed.selector);
        factory.authorizeNominee(buyer);
    }

    function test_factoryNomineeRollsBack() public {
        OnPlate plate = _add(owner, 0, 0, address(0));
        vm.deal(address(factory), 1 ether);
        vm.prank(owner);
        plate.list(1 ether);
        vm.prank(address(factory));
        plate.buy{value: 1 ether}();
        vm.prank(owner);
        plate.withdraw();
        assertEq(address(plate).balance, 0);
        assertEq(plate.accounted(), 0);
        assertEq(plate.vaultedSince(), 0);
        vm.prank(address(factory));
        plate.setMailbox(vault);
        vm.prank(address(factory));
        vm.expectRevert(OnPlate.Nomination.selector);
        plate.nominate(address(factory));
        vm.warp(block.timestamp + 30 days);
        vm.prank(address(factory));
        vm.expectRevert(OnPlateFactory.NotAllowed.selector);
        plate.nominate(address(factory));
        assertFalse(plate.nominated());
        assertFalse(plate.nominationRevoked());
        assertTrue(plate.nominationOpen());
        assertFalse(factory.authorized(address(factory)));
        vm.prank(vault);
        plate.release();
        assertEq(plate.ownerOf(1), address(factory));
        assertEq(plate.title(), address(factory));
    }

    function test_forwarderCannotNominate() public {
        address nominee = makeAddr("nominee");
        OnPlate plate = _add(owner, 0, 0, address(0));
        vm.prank(owner);
        plate.setMailbox(vault);
        ForwardNominate fwd = new ForwardNominate();
        vm.prank(owner);
        vm.expectRevert(OnPlate.Nomination.selector);
        fwd.go(plate, nominee);
        vm.warp(block.timestamp + 30 days);
        vm.prank(owner);
        vm.expectRevert(OnPlate.Nomination.selector);
        fwd.go(plate, nominee);
        assertFalse(plate.nominated());
        assertFalse(factory.authorized(nominee));
        assertEq(plate.ownerOf(1), vault);
        assertEq(plate.vaultedSince(), block.timestamp - 30 days);
        vm.prank(owner);
        plate.nominate(nominee);
        assertTrue(factory.authorized(nominee));
    }

    function test_doubleNominateRollsBack() public {
        address nominee = makeAddr("nominee");
        DoubleNominate twice = new DoubleNominate();
        vm.prank(owner);
        factory.setAuthorized(address(twice), true);
        OnPlate plate = _add(address(twice), 0, 0, address(0));
        assertTrue(plate.nominationAllowed());
        vm.prank(address(twice));
        plate.setMailbox(vault);
        vm.warp(block.timestamp + 30 days);
        vm.prank(vault);
        vm.expectRevert(OnPlate.Nomination.selector);
        plate.nominate(nominee);
        vm.expectRevert(OnPlate.Nomination.selector);
        twice.go(plate, nominee);
        assertFalse(plate.nominated());
        assertFalse(factory.authorized(nominee));
        assertEq(plate.ownerOf(1), vault);
        vm.prank(address(twice));
        plate.nominate(nominee);
        assertTrue(plate.nominated());
        assertTrue(factory.authorized(nominee));
        vm.prank(address(twice));
        vm.expectRevert(OnPlate.Nomination.selector);
        plate.nominate(nominee);
        vm.prank(vault);
        plate.release();
        assertEq(plate.ownerOf(1), address(twice));
    }

    function test_twoPlatesHaveSeparatePotential() public {
        address first = makeAddr("first");
        address second = makeAddr("second");
        OnPlate a = _add(owner, 0, 0, address(0));
        OnPlate b = _add(owner, 0, 0, address(0));
        vm.prank(owner);
        a.setMailbox(vault);
        vm.prank(owner);
        b.setMailbox(vault);
        vm.warp(block.timestamp + 30 days);
        vm.prank(owner);
        a.nominate(first);
        vm.prank(owner);
        b.nominate(first);
        assertTrue(a.nominated());
        assertTrue(b.nominated());
        assertTrue(factory.authorized(first));
        vm.prank(owner);
        vm.expectRevert(OnPlate.Nomination.selector);
        a.nominate(second);
        assertFalse(factory.authorized(second));
        vm.prank(vault);
        a.release();
        vm.prank(vault);
        b.release();
        assertEq(a.ownerOf(1), owner);
        assertEq(b.ownerOf(1), owner);
    }

    function test_whitelistDoesNotGrantNomination() public {
        address nominee = makeAddr("nominee");
        OnPlate plate = _add(owner, 0, 0, address(0));
        vm.prank(owner);
        factory.setAuthorized(artist, true);
        vm.prank(owner);
        plate.setMailbox(vault);
        vm.warp(block.timestamp + 30 days);
        vm.prank(artist);
        vm.expectRevert(OnPlate.Nomination.selector);
        plate.nominate(nominee);
        assertFalse(plate.nominated());
        assertFalse(factory.authorized(nominee));
        assertTrue(factory.authorized(artist));
        vm.prank(vault);
        plate.release();
        vm.prank(owner);
        plate.list(1 ether);
        vm.prank(artist);
        plate.buy{value: 1 ether}();
        vm.prank(artist);
        plate.setMailbox(vault);
        vm.prank(artist);
        vm.expectRevert(OnPlate.Nomination.selector);
        plate.nominate(nominee);
        assertFalse(plate.nominated());
        vm.warp(block.timestamp + 30 days);
        vm.prank(artist);
        plate.nominate(nominee);
        assertTrue(plate.nominated());
        assertTrue(factory.authorized(nominee));
        assertEq(plate.ownerOf(1), vault);
        vm.prank(vault);
        plate.release();
        assertEq(plate.ownerOf(1), artist);
    }

    function test_bookCapAndBatchLimit() public {
        assertEq(factory.maxChunks(), 1150);
        assertEq(factory.openMax(), 4);
        assertEq(factory.appendMax(), 80);
        vm.prank(owner);
        address opened = factory.openBook(1);
        assertEq(ChunkBook(opened).MAX_CHUNKS(), 1150);
        vm.prank(owner);
        vm.expectRevert(OnPlateFactory.BadChunk.selector);
        factory.openBook(1151);
        vm.prank(owner);
        address full = factory.openBook(1150);
        assertEq(ChunkBook(full).expected(), 1150);
        vm.prank(buyer);
        vm.expectRevert(OnPlateFactory.NotAllowed.selector);
        factory.openBook(5);
        vm.prank(buyer);
        address small = factory.openBook(4);
        assertEq(ChunkBook(small).expected(), 4);
        assertEq(ChunkBook(small).artist(), buyer);
    }

    function test_appendOverTheBatchReverts() public {
        uint256 n = factory.APPEND_MAX() + 1;
        address[] memory chunks = new address[](n);
        for (uint256 i = 0; i < n; ++i) chunks[i] = _chunk(abi.encodePacked(uint16(i + 1)));
        vm.startPrank(owner);
        address book = factory.openBook(n);
        vm.expectRevert(OnPlateFactory.BadChunk.selector);
        factory.addChunks(book, chunks);
        vm.stopPrank();
        assertEq(ChunkBook(book).chunkCount(), 0);
        assertEq(factory.photoCount(), 0);
    }

    function test_bookLinksInBatchesAndSecondUseReverts() public {
        address a = _chunk(hex"aa");
        address b = _chunk(hex"bb");
        address c = _chunk(hex"cc");
        vm.startPrank(owner);
        address book = factory.openBook(3);
        address[] memory first = new address[](2);
        first[0] = a;
        first[1] = b;
        factory.addChunks(book, first);
        assertEq(factory.photoCount(), 0);
        vm.expectRevert(ChunkBook.BadChunk.selector);
        factory.sealBook(book);
        address[] memory again = new address[](1);
        again[0] = a;
        vm.expectRevert(ChunkBook.BadChunk.selector);
        factory.addChunks(book, again);
        address[] memory last = new address[](1);
        last[0] = c;
        factory.addChunks(book, last);
        factory.sealBook(book);
        vm.expectRevert(ChunkBook.BadChunk.selector);
        factory.addChunks(book, last);
        address plate = factory.addPhoto("Chaise", "A photograph.", "", keccak256(hex"aabbcc"), book, _thumb(), 450, 0, address(0));
        vm.expectRevert(OnPlateFactory.BadChunk.selector);
        factory.addPhoto("Chaise", "A photograph.", "", keccak256(hex"aabbcc"), book, _thumb(), 450, 0, address(0));
        vm.stopPrank();
        assertEq(factory.photoCount(), 1);
        vm.roll(block.number + 4);
        vm.warp(block.timestamp + 3 days);
        OnPlate made = OnPlate(plate);
        assertEq(made.chunkCount(), 3);
        assertEq(made.chunkAt(0), a);
        assertEq(made.chunkAt(2), c);
        assertEq(made.readChunk(0), hex"aa");
        assertEq(made.readChunk(1), hex"bb");
        assertEq(made.readChunk(2), hex"cc");
        assertEq(keccak256(bytes.concat(made.readChunk(0), made.readChunk(1), made.readChunk(2))), made.contentHash());
    }

    function test_strangerCannotWriteSomeoneElsesBook() public {
        vm.prank(owner);
        factory.setAuthorized(artist, true);
        vm.prank(artist);
        address book = factory.openBook(1);
        address[] memory chunks = new address[](1);
        chunks[0] = _chunk(hex"01");
        vm.prank(owner);
        vm.expectRevert(OnPlateFactory.NotAllowed.selector);
        factory.addChunks(book, chunks);
        vm.prank(buyer);
        vm.expectRevert(OnPlateFactory.NotAllowed.selector);
        factory.sealBook(book);
        vm.prank(owner);
        vm.expectRevert(OnPlateFactory.BadChunk.selector);
        factory.addPhoto("Chaise", "", "", keccak256("a"), book, _thumb(), 450, 0, address(0));
        assertEq(factory.photoCount(), 0);
        assertFalse(ChunkBook(book).locked());
    }

    function test_removedArtistCannotFinishTheBook() public {
        vm.prank(owner);
        factory.setAuthorized(artist, true);
        vm.prank(artist);
        address wide = factory.openBook(5);
        vm.prank(owner);
        factory.setAuthorized(artist, false);
        address[] memory five = _pieces(artist, 5, 51);
        vm.prank(artist);
        vm.expectRevert(OnPlateFactory.NotAllowed.selector);
        factory.addChunks(wide, five);
        vm.prank(artist);
        vm.expectRevert(OnPlateFactory.NotAllowed.selector);
        factory.sealBook(wide);
        assertEq(ChunkBook(wide).chunkCount(), 0);
        assertEq(factory.photoCount(), 0);

        address[] memory four = _pieces(artist, 4, 52);
        vm.startPrank(artist);
        address narrow = factory.openBook(4);
        factory.addChunks(narrow, four);
        factory.sealBook(narrow);
        address plate = factory.addPhoto("Chaise", "A photograph.", "", keccak256("a"), narrow, _thumb(), 450, 0, artist);
        vm.stopPrank();
        assertFalse(OnPlate(plate).nominationAllowed());
        assertEq(factory.photoCount(), 1);

        vm.prank(owner);
        factory.setAuthorized(artist, true);
        vm.startPrank(artist);
        factory.addChunks(wide, five);
        factory.sealBook(wide);
        address widePlate = factory.addPhoto("Window", "A photograph.", "Ada", keccak256("b"), wide, _thumb(), 450, 0, artist);
        vm.stopPrank();
        assertTrue(OnPlate(widePlate).nominationAllowed());
        assertEq(OnPlate(widePlate).artistName(), "Ada");
        assertEq(factory.photoCount(), 2);
    }

    function test_bookFromAnotherFactoryIsRefused() public {
        OnPlateFactory other = _deploy(owner, 450, 700);
        address[] memory chunks = new address[](1);
        chunks[0] = _chunk(hex"01");
        vm.startPrank(owner);
        address book = other.openBook(1);
        other.addChunks(book, chunks);
        other.sealBook(book);
        vm.expectRevert(OnPlateFactory.BadChunk.selector);
        factory.addPhoto("Chaise", "A photograph.", "", keccak256("a"), book, _thumb(), 450, 0, address(0));
        vm.stopPrank();
        assertEq(factory.photoCount(), 0);
        assertEq(other.photoCount(), 0);
    }

    function test_directBookDeployReverts() public {
        vm.expectRevert(ChunkBook.Hook.selector);
        new ChunkBook(address(factory), owner, 1);
    }

    function test_factoryAndBookAreNotChunks() public {
        vm.startPrank(owner);
        address book = factory.openBook(1);
        address[] memory chunks = new address[](1);
        chunks[0] = address(factory);
        vm.expectRevert(ChunkBook.BadChunk.selector);
        factory.addChunks(book, chunks);
        chunks[0] = book;
        vm.expectRevert(ChunkBook.BadChunk.selector);
        factory.addChunks(book, chunks);
        chunks[0] = factory.plates();
        vm.expectRevert(ChunkBook.BadChunk.selector);
        factory.addChunks(book, chunks);
        chunks[0] = factory.books();
        vm.expectRevert(ChunkBook.BadChunk.selector);
        factory.addChunks(book, chunks);
        vm.stopPrank();
        assertEq(factory.photoCount(), 0);
    }

    function test_strangerCannotUseDeployers() public {
        PlateDeployer plates = PlateDeployer(factory.plates());
        BookDeployer books = BookDeployer(factory.books());
        OnPlate.Terms memory terms = OnPlate.Terms({
            title: owner,
            plateId: 1,
            contentHash: keccak256("a"),
            devBps: 450,
            artistBps: 0,
            artist: address(0)
        });
        assertEq(plates.factory(), address(factory));
        assertEq(books.factory(), address(factory));
        assertEq(plates.kind(), 1);
        assertEq(books.kind(), 2);
        vm.expectRevert(PlateDeployer.Hook.selector);
        plates.deploy(terms, "Chaise", "A photograph.", "", false, address(0), _thumb(), 1);
        vm.expectRevert(BookDeployer.Hook.selector);
        books.deploy(owner, 1);
        assertEq(factory.photoCount(), 0);
    }

    function test_factoryRejectsMismatchedDeployers() public {
        uint256 nonce = vm.getNonce(owner);
        address predicted = vm.computeCreateAddress(owner, nonce + 2);
        vm.startPrank(owner);
        PlateDeployer plateSource = new PlateDeployer(predicted);
        BookDeployer bookSource = new BookDeployer(predicted);
        vm.expectRevert(OnPlateFactory.Hook.selector);
        new OnPlateFactory(450, 700, address(bookSource), address(plateSource));
        new PlateChunk(hex"01");
        vm.expectRevert(OnPlateFactory.Hook.selector);
        new OnPlateFactory(450, 700, address(plateSource), address(bookSource));
        vm.expectRevert(OnPlateFactory.Hook.selector);
        new OnPlateFactory(450, 700, address(1), address(2));
        vm.stopPrank();
    }

    /// Plate creation code lives in the plate creator, not in the factory.
    /// 16,000 bytes of factory at 1,530 gas per byte still fits a 30,000,000 gas block.
    function test_factoryCodeOmitsPlateCreation() public view {
        assertLt(address(factory).code.length, 16_000);
        assertGt(factory.plates().code.length, address(factory).code.length);
        assertLt(factory.books().code.length, 12_000);
        assertGt(address(factory).code.length, 0);
    }

    function test_imageBytesAreNotCopiedIntoStorage() public {
        bytes memory mark = new bytes(64);
        for (uint256 i = 0; i < mark.length; ++i) mark[i] = 0xa5;
        bytes32 paint = hex"a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5";
        address chunk = _chunk(mark);
        address[] memory chunks = new address[](1);
        chunks[0] = chunk;
        vm.startPrank(owner);
        address book = factory.openBook(1);
        vm.record();
        factory.addChunks(book, chunks);
        _rejectPaint(book, paint);
        _rejectPaint(address(factory), paint);
        factory.sealBook(book);
        vm.record();
        address plate = factory.addPhoto("Chaise", "A photograph.", "", keccak256(mark), book, _thumb(), 450, 0, address(0));
        _rejectPaint(plate, paint);
        _rejectPaint(address(factory), paint);
        vm.stopPrank();
        assertTrue(_hasBytes(chunk.code, mark));
        assertFalse(_hasBytes(address(book).code, mark));
        assertFalse(_hasBytes(plate.code, mark));
        assertFalse(_hasBytes(address(factory).code, mark));
        assertFalse(_hasBytes(factory.plates().code, mark));
        assertFalse(_hasBytes(factory.books().code, mark));
        vm.roll(block.number + 2);
        assertEq(OnPlate(plate).readChunk(0), mark);
        assertEq(OnPlate(plate).book(), book);
    }


    /// Four pieces is the open door. That plate cannot nominate, even after a later whitelist.
    function test_openTierStoresFourAndCannotNominate() public {
        assertFalse(factory.canAdd(buyer));
        OnPlate plate = _register(buyer, 4, "Small", "Ada", keccak256("open-four"));
        assertEq(plate.artistName(), "Ada");
        assertFalse(plate.nominationAllowed());
        assertEq(plate.chunkCount(), 4);

        address nominee = makeAddr("open-nominee");
        vm.prank(buyer);
        plate.setMailbox(vault);
        vm.warp(block.timestamp + 30 days);
        vm.prank(buyer);
        vm.expectRevert(OnPlate.Nomination.selector);
        plate.nominate(nominee);
        assertFalse(plate.nominated());
        assertFalse(factory.authorized(nominee));
        vm.prank(nominee);
        vm.expectRevert(OnPlateFactory.NotAllowed.selector);
        factory.openBook(5);

        vm.prank(owner);
        factory.setAuthorized(buyer, true);
        assertTrue(factory.canAdd(buyer));
        assertFalse(plate.nominationAllowed());
        vm.prank(buyer);
        vm.expectRevert(OnPlate.Nomination.selector);
        plate.nominate(nominee);
        assertFalse(factory.authorized(nominee));
    }

    /// A plate registered while the artist could add a full photograph keeps that chance.
    function test_whitelistedPlateStillNominatesAfterRevoke() public {
        vm.prank(owner);
        factory.setAuthorized(artist, true);
        OnPlate plate = _add(artist, 450, 0, address(0));
        assertTrue(plate.nominationAllowed());
        vm.prank(owner);
        factory.setAuthorized(artist, false);
        assertFalse(factory.canAdd(artist));
        address nominee = makeAddr("kept-nominee");
        vm.prank(artist);
        plate.setMailbox(vault);
        vm.warp(block.timestamp + 30 days);
        vm.prank(artist);
        plate.nominate(nominee);
        assertTrue(plate.nominated());
        assertTrue(factory.authorized(nominee));
        vm.prank(nominee);
        assertEq(ChunkBook(factory.openBook(5)).expected(), 5);
        vm.prank(nominee);
        assertEq(ChunkBook(factory.openBook(1150)).expected(), 1150);
    }

    /// Sealing a wide book does not let a revoked artist register it. The book stays unused.
    function test_sealedWideBookCannotRegisterAfterRevoke() public {
        vm.prank(owner);
        factory.setAuthorized(artist, true);
        address[] memory chunks = _pieces(artist, 5, 99);
        vm.startPrank(artist);
        address book = factory.openBook(5);
        factory.addChunks(book, chunks);
        factory.sealBook(book);
        vm.stopPrank();
        vm.prank(owner);
        factory.setAuthorized(artist, false);
        vm.prank(artist);
        vm.expectRevert(OnPlateFactory.NotAllowed.selector);
        factory.addPhoto("Wide", "A photograph.", "", keccak256("wide"), book, _thumb(), 450, 0, address(0));
        assertFalse(ChunkBook(book).used());
        assertEq(factory.photoCount(), 0);
        vm.prank(owner);
        factory.setAuthorized(artist, true);
        vm.prank(artist);
        address plate = factory.addPhoto("Wide", "A photograph.", "Ada", keccak256("wide"), book, _thumb(), 450, 0, address(0));
        assertTrue(OnPlate(plate).nominationAllowed());
        assertEq(OnPlate(plate).artistName(), "Ada");
        assertTrue(ChunkBook(book).used());
    }

    /// A four-piece book opened while allowed can be finished after the flag is removed.
    /// The nomination flag is taken at registration, so this plate cannot nominate.
    function test_fourBookOpenedWhileAllowedFinishesAfterRevoke() public {
        vm.prank(owner);
        factory.setAuthorized(artist, true);
        vm.prank(artist);
        address book = factory.openBook(4);
        vm.prank(owner);
        factory.setAuthorized(artist, false);
        address[] memory chunks = _pieces(artist, 4, 77);
        vm.startPrank(artist);
        factory.addChunks(book, chunks);
        factory.sealBook(book);
        address plate = factory.addPhoto(
            "Narrow", "A photograph.", "", keccak256("narrow"), book, _thumb(), 450, 0, address(0)
        );
        vm.stopPrank();
        assertFalse(OnPlate(plate).nominationAllowed());
        assertEq(OnPlate(plate).artistName(), "");
        assertEq(factory.photoCount(), 1);
    }

    /// Two strangers can each register four pieces. The contract does not stop that.
    function test_twoStrangersEachStoreFour() public {
        OnPlate a = _register(buyer, 4, "One", "", keccak256("sybil-a"));
        OnPlate b = _register(vault, 4, "Two", "", keccak256("sybil-b"));
        assertFalse(a.nominationAllowed());
        assertFalse(b.nominationAllowed());
        assertFalse(factory.canAdd(buyer));
        assertFalse(factory.canAdd(vault));
        assertEq(factory.photoCount(), 2);
    }

    /// An open book stays at the count it was given. A fifth piece does not fit in a four-piece book.
    function test_openBookCannotGrow() public {
        vm.prank(buyer);
        address book = factory.openBook(4);
        address[] memory extra = _pieces(buyer, 5, 5);
        vm.prank(buyer);
        vm.expectRevert(ChunkBook.BadChunk.selector);
        factory.addChunks(book, extra);
        assertEq(ChunkBook(book).chunkCount(), 0);
        assertEq(ChunkBook(book).expected(), 4);
    }

    /// Four pieces, the open tier, register in one call. The plate cannot nominate.
    /// The gas stays under the 16,777,216 mainnet transaction cap.
    function test_linkPhotoRegistersFourInOneCall() public {
        address[] memory chunks = _pieces(buyer, 4, 41);
        uint16 share = factory.devBps();
        bytes memory text = abi.encode("Oahu", "A photograph.", "Boo", _thumb());
        uint256 before = gasleft();
        vm.prank(buyer);
        address made = factory.linkPhoto(keccak256("link-four"), chunks, share, 0, address(0), text);
        uint256 used = before - gasleft();
        OnPlate plate = OnPlate(made);
        assertLt(used, 16_777_216);
        assertEq(factory.photoCount(), 1);
        assertFalse(plate.nominationAllowed());
        assertEq(plate.artistName(), "Boo");
        assertEq(plate.title(), buyer);
        assertEq(plate.contentHash(), keccak256("link-four"));
        ChunkBook book = ChunkBook(plate.book());
        assertEq(book.artist(), buyer);
        assertEq(book.expected(), 4);
        assertEq(book.chunkCount(), 4);
        assertTrue(book.locked());
        assertTrue(book.used());
        assertEq(book.chunkAt(0), chunks[0]);
        assertEq(book.chunkAt(3), chunks[3]);
    }

    /// A stranger still cannot link five pieces. The cap is OPEN_MAX, and the revert is NotAllowed.
    function test_linkPhotoRefusesFiveFromStranger() public {
        address[] memory chunks = _pieces(buyer, 5, 55);
        uint16 share = factory.devBps();
        bytes memory text = abi.encode("Wide", "A photograph.", "", _thumb());
        vm.prank(buyer);
        vm.expectRevert(OnPlateFactory.NotAllowed.selector);
        factory.linkPhoto(keccak256("link-five"), chunks, share, 0, address(0), text);
        assertEq(factory.photoCount(), 0);
        assertFalse(factory.canAdd(buyer));
    }

    /// A nominated signer registers twelve pieces in one call. The plate can nominate.
    /// The gas stays under the 16,777,216 mainnet transaction cap.
    function test_linkPhotoRegistersTwelveForNominated() public {
        address[] memory chunks = _pieces(artist, 12, 77);
        uint16 share = factory.devBps();
        bytes memory text = abi.encode("Chaise", "A photograph.", "Boo", _thumb());
        vm.prank(owner);
        factory.setAuthorized(artist, true);
        uint256 before = gasleft();
        vm.prank(artist);
        address made = factory.linkPhoto(keccak256("link-twelve"), chunks, share, 0, address(0), text);
        uint256 used = before - gasleft();
        OnPlate plate = OnPlate(made);
        assertLt(used, 16_777_216);
        assertEq(factory.photoCount(), 1);
        assertTrue(plate.nominationAllowed());
        assertEq(plate.artistName(), "Boo");
        assertEq(plate.title(), artist);
        assertEq(plate.contentHash(), keccak256("link-twelve"));
        ChunkBook book = ChunkBook(plate.book());
        assertEq(book.artist(), artist);
        assertEq(book.expected(), 12);
        assertEq(book.chunkCount(), 12);
        assertTrue(book.locked());
        assertTrue(book.used());
        assertEq(book.chunkAt(0), chunks[0]);
        assertEq(book.chunkAt(11), chunks[11]);
    }

    /// Eighty pieces still fit in one nominated linkPhoto, which is one addChunks batch.
    function test_linkPhotoRegistersEightyForNominated() public {
        address[] memory chunks = _pieces(artist, 80, 88);
        uint16 share = factory.devBps();
        bytes memory text = abi.encode("Wide", "A photograph.", "", _thumb());
        vm.prank(owner);
        factory.setAuthorized(artist, true);
        uint256 before = gasleft();
        vm.prank(artist);
        address made = factory.linkPhoto(keccak256("link-eighty"), chunks, share, 0, address(0), text);
        uint256 used = before - gasleft();
        assertLt(used, 16_777_216);
        assertEq(factory.photoCount(), 1);
        assertTrue(OnPlate(made).nominationAllowed());
        assertEq(ChunkBook(OnPlate(made).book()).chunkCount(), 80);
    }

    /// Creating a piece contract stays open. Linking more than four pieces does not.
    function test_pieceCreateStaysOpen() public {
        vm.prank(buyer);
        address chunk = address(new PlateChunk(hex"010203"));
        assertGt(chunk.code.length, 1);
        vm.prank(buyer);
        vm.expectRevert(OnPlateFactory.NotAllowed.selector);
        factory.openBook(5);
        assertEq(factory.photoCount(), 0);
    }

    /// The origin's burn finishes that ordered list. Neither the origin nor anyone else can register it again.
    function test_originBurnFinishesTheList() public {
        address[] memory chunks = _pieces(buyer, 2, 90);
        OnPlate plate = _link(buyer, chunks, keccak256("burn-a"));
        bytes32 key = factory.workKey(plate.book());
        (address origin, bool ended, bool chance) = factory.lineage(key);
        assertEq(factory.liveWork(key), address(plate));
        assertEq(origin, buyer);
        assertFalse(ended);
        assertFalse(chance);
        vm.prank(artist);
        vm.expectRevert(OnPlate.NotHolder.selector);
        plate.burn();
        vm.prank(buyer);
        plate.list(1 ether);
        bytes memory text = abi.encode("Taken", "A photograph.", "", _thumb());
        uint16 share = factory.devBps();
        vm.expectRevert(OnPlateFactory.WorkTaken.selector);
        vm.prank(artist);
        factory.linkPhoto(keccak256("burn-taken"), chunks, share, 0, address(0), text);
        vm.prank(buyer);
        plate.burn();
        assertTrue(plate.burned());
        assertEq(plate.burnedBy(), buyer);
        assertEq(factory.photoAt(1), address(0));
        assertEq(factory.liveWork(key), address(0));
        assertFalse(factory.isPhoto(address(plate)));
        (origin, ended, chance) = factory.lineage(key);
        assertEq(origin, buyer);
        assertTrue(ended);
        assertFalse(chance);
        vm.expectRevert();
        plate.ownerOf(1);
        vm.prank(buyer);
        vm.expectRevert();
        plate.burn();
        vm.expectRevert(OnPlateFactory.WorkEnded.selector);
        vm.prank(buyer);
        factory.linkPhoto(keccak256("burn-again"), chunks, share, 0, address(0), text);
        vm.expectRevert(OnPlateFactory.WorkEnded.selector);
        vm.prank(artist);
        factory.linkPhoto(keccak256("burn-stranger"), chunks, share, 0, address(0), text);
        assertEq(factory.photoCount(), 1);
    }

    /// After a sale the buyer holds the token. The seller cannot burn it.
    /// The buyer's burn still lets the seller withdraw the credited share.
    function test_onlyHolderBurnsAndWithdrawSurvives() public {
        address[] memory chunks = _pieces(buyer, 1, 91);
        OnPlate plate = _link(buyer, chunks, keccak256("burn-sale"));
        vm.prank(buyer);
        plate.list(1 ether);
        vm.prank(artist);
        plate.buy{value: 1 ether}();
        vm.prank(buyer);
        vm.expectRevert(OnPlate.NotHolder.selector);
        plate.burn();
        uint256 owed = plate.claimable(buyer);
        assertGt(owed, 0);
        vm.prank(artist);
        plate.burn();
        (address origin, bool ended,) = factory.lineage(factory.workKey(plate.book()));
        assertEq(origin, buyer);
        assertFalse(ended);
        assertEq(factory.liveWork(factory.workKey(plate.book())), address(0));
        uint256 before = buyer.balance;
        vm.prank(buyer);
        plate.withdraw();
        assertEq(buyer.balance, before + owed);
        assertEq(plate.claimable(buyer), 0);
    }

    /// While parked, nobody can burn. Release brings it home, and then the title can burn.
    function test_parkedPlateCannotBeBurned() public {
        address[] memory chunks = _pieces(buyer, 1, 92);
        OnPlate plate = _link(buyer, chunks, keccak256("burn-vault"));
        vm.prank(buyer);
        plate.setMailbox(vault);
        vm.prank(buyer);
        vm.expectRevert(OnPlate.Hook.selector);
        plate.burn();
        vm.prank(vault);
        vm.expectRevert(OnPlate.Hook.selector);
        plate.burn();
        vm.prank(artist);
        vm.expectRevert(OnPlate.Hook.selector);
        plate.burn();
        assertFalse(plate.burned());
        assertEq(factory.liveWork(factory.workKey(plate.book())), address(plate));
        vm.prank(vault);
        plate.release();
        vm.prank(artist);
        vm.expectRevert(OnPlate.NotHolder.selector);
        plate.burn();
        vm.prank(buyer);
        plate.burn();
        assertTrue(plate.burned());
        assertEq(plate.burnedBy(), buyer);
        assertEq(factory.photoAt(plate.plateId()), address(0));
        (address origin, bool ended,) = factory.lineage(factory.workKey(plate.book()));
        assertEq(origin, buyer);
        assertTrue(ended);
    }

    /// Burning a listed plate removes the sale. The same bytes in new chunk contracts
    /// are a different work and can both be alive. A reversed list is also a different work.
    function test_burnClearsSaleAndNewBytesAreAnotherWork() public {
        address[] memory chunks = _pieces(buyer, 2, 93);
        OnPlate plate = _link(buyer, chunks, keccak256("burn-list"));
        address[] memory copy = new address[](2);
        copy[0] = _mint(artist, abi.encodePacked(uint256(93), uint256(0)));
        copy[1] = _mint(artist, abi.encodePacked(uint256(93), uint256(1)));
        OnPlate twin = _link(artist, copy, keccak256("burn-copy"));
        assertEq(twin.ownerOf(1), artist);
        assertTrue(address(twin) != address(plate));
        vm.prank(buyer);
        plate.list(1 ether);
        vm.prank(buyer);
        plate.burn();
        (, bool ended,) = factory.lineage(factory.workKey(plate.book()));
        assertTrue(ended);
        vm.prank(vault);
        vm.expectRevert();
        plate.buy{value: 1 ether}();
        bytes memory text = abi.encode("Burn", "A photograph.", "", _thumb());
        uint16 share = factory.devBps();
        vm.expectRevert(OnPlateFactory.WorkEnded.selector);
        vm.prank(buyer);
        factory.linkPhoto(keccak256("burn-no-return"), chunks, share, 0, address(0), text);
        address[] memory flipped = new address[](2);
        flipped[0] = chunks[1];
        flipped[1] = chunks[0];
        OnPlate other = _link(buyer, flipped, keccak256("burn-flip"));
        assertEq(other.ownerOf(1), buyer);
        assertTrue(factory.liveWork(factory.workKey(twin.book())) != factory.liveWork(factory.workKey(other.book())));
    }

    /// Pieces are bound to the wallet that stored them. Another account cannot register that list.
    /// A raw PlateChunk with no maker also cannot register. The deployer can.
    function test_strangerCannotRegisterOthersPieces() public {
        address[] memory chunks = _pieces(artist, 1, 94);
        bytes memory text = abi.encode("Late", "A photograph.", "", _thumb());
        uint16 share = factory.devBps();
        vm.expectRevert(OnPlateFactory.NotAllowed.selector);
        vm.prank(buyer);
        factory.linkPhoto(keccak256("late"), chunks, share, 0, address(0), text);
        vm.prank(buyer);
        address raw = address(new PlateChunk(hex"99"));
        address[] memory one = new address[](1);
        one[0] = raw;
        vm.expectRevert(OnPlateFactory.BadChunk.selector);
        vm.prank(buyer);
        factory.linkPhoto(keccak256("raw"), one, share, 0, address(0), text);
        OnPlate plate = _link(artist, chunks, keccak256("own"));
        assertEq(factory.liveWork(factory.workKey(plate.book())), address(plate));
        assertEq(plate.title(), artist);
        vm.expectRevert(OnPlateFactory.WorkTaken.selector);
        vm.prank(artist);
        factory.linkPhoto(keccak256("again"), chunks, share, 0, address(0), text);
        vm.prank(artist);
        plate.burn();
        vm.expectRevert(OnPlateFactory.WorkEnded.selector);
        vm.prank(artist);
        factory.linkPhoto(keccak256("late-artist"), chunks, share, 0, address(0), text);
        assertEq(factory.photoCount(), 1);
        assertFalse(factory.isPhoto(address(plate)));
    }

    /// A later holder can burn once the plate is home. The list comes back only to the account that registered it.
    /// Authorizing that account before the remint does not give an open-tier plate a nomination.
    function test_holderBurnReturnsTheListOnlyToOrigin() public {
        address[] memory chunks = _pieces(buyer, 1, 95);
        OnPlate plate = _link(buyer, chunks, keccak256("return-list"));
        _sell(plate, buyer, artist, 1 ether);
        vm.prank(owner);
        factory.setAuthorized(buyer, true);
        vm.prank(artist);
        plate.burn();
        bytes memory text = abi.encode("Burn", "A photograph.", "", _thumb());
        uint16 share = factory.devBps();
        vm.expectRevert(OnPlateFactory.WorkTaken.selector);
        vm.prank(artist);
        factory.linkPhoto(keccak256("return-holder"), chunks, share, 0, address(0), text);
        vm.expectRevert(OnPlateFactory.WorkTaken.selector);
        vm.prank(vault);
        factory.linkPhoto(keccak256("return-vault"), chunks, share, 0, address(0), text);
        OnPlate again = _link(buyer, chunks, keccak256("return-origin"));
        assertEq(again.title(), buyer);
        assertFalse(again.nominationAllowed());
        assertTrue(factory.canAdd(buyer));
        (address origin, bool ended, bool chance) = factory.lineage(factory.workKey(again.book()));
        assertEq(origin, buyer);
        assertFalse(ended);
        assertFalse(chance);
    }

    /// A second wallet used as the vault cannot burn. It cannot finish the list or return it.
    /// After release, the origin's own burn finishes the list.
    function test_vaultCannotBurnForTheArtist() public {
        vm.prank(owner);
        factory.setAuthorized(artist, true);
        OnPlate plate = _register(artist, 1, "Vault", "", keccak256("vault-self"));
        address[] memory chunks = _chunkList(plate);
        vm.prank(artist);
        plate.setMailbox(vault);
        vm.prank(vault);
        vm.expectRevert(OnPlate.Hook.selector);
        plate.burn();
        (address origin, bool ended, bool chance) = factory.lineage(factory.workKey(plate.book()));
        assertEq(origin, artist);
        assertFalse(ended);
        assertTrue(chance);
        assertEq(factory.liveWork(factory.workKey(plate.book())), address(plate));
        vm.prank(vault);
        plate.release();
        vm.prank(artist);
        plate.burn();
        (, ended, chance) = factory.lineage(factory.workKey(plate.book()));
        assertTrue(ended);
        assertFalse(chance);
        bytes memory text = abi.encode("Burn", "A photograph.", "", _thumb());
        uint16 share = factory.devBps();
        vm.expectRevert(OnPlateFactory.WorkEnded.selector);
        vm.prank(vault);
        factory.linkPhoto(keccak256("vault-self-no"), chunks, share, 0, address(0), text);
        vm.expectRevert(OnPlateFactory.WorkEnded.selector);
        vm.prank(artist);
        factory.linkPhoto(keccak256("vault-self-artist"), chunks, share, 0, address(0), text);
    }

    /// A nomination that was used does not come back, even while the origin can still add.
    function test_spentNominationDoesNotReturn() public {
        address nominee = makeAddr("spent-nominee");
        vm.prank(owner);
        factory.setAuthorized(artist, true);
        OnPlate plate = _register(artist, 1, "Spent", "", keccak256("spent-life"));
        address[] memory chunks = _chunkList(plate);
        vm.prank(artist);
        plate.setMailbox(vault);
        vm.warp(block.timestamp + 30 days);
        vm.prank(artist);
        plate.nominate(nominee);
        assertTrue(plate.nominated());
        vm.prank(vault);
        vm.expectRevert(OnPlate.Hook.selector);
        plate.burn();
        vm.prank(vault);
        plate.release();
        _sell(plate, artist, buyer, 1 ether);
        vm.prank(buyer);
        plate.burn();
        OnPlate again = _link(artist, chunks, keccak256("spent-again"));
        assertFalse(again.nominationAllowed());
        assertTrue(factory.canAdd(artist));
        vm.prank(artist);
        again.setMailbox(vault);
        vm.warp(block.timestamp + 30 days);
        vm.prank(artist);
        vm.expectRevert(OnPlate.Nomination.selector);
        again.nominate(nominee);
        assertFalse(again.nominated());
    }

    /// A chance revoked by a cheaper sale stays revoked on the remint.
    function test_revokedNominationDoesNotReturn() public {
        vm.prank(owner);
        factory.setAuthorized(artist, true);
        OnPlate plate = _register(artist, 1, "Revoked", "", keccak256("revoked-life"));
        address[] memory chunks = _chunkList(plate);
        _sell(plate, artist, buyer, 1 ether);
        _sell(plate, buyer, vault, 0.5 ether);
        assertTrue(plate.nominationRevoked());
        vm.prank(vault);
        plate.burn();
        OnPlate again = _link(artist, chunks, keccak256("revoked-again"));
        assertFalse(again.nominationAllowed());
        assertTrue(factory.canAdd(artist));
    }

    /// An unused chance survives a holder's burn. Removing the origin from the whitelist does not take it.
    function test_unusedChanceSurvivesAHolderBurn() public {
        vm.prank(owner);
        factory.setAuthorized(artist, true);
        OnPlate plate = _register(artist, 1, "Unused", "", keccak256("unused-life"));
        address[] memory chunks = _chunkList(plate);
        _sell(plate, artist, buyer, 1 ether);
        vm.prank(owner);
        factory.setAuthorized(artist, false);
        assertFalse(factory.canAdd(artist));
        vm.prank(buyer);
        plate.burn();
        OnPlate again = _link(artist, chunks, keccak256("unused-again"));
        assertTrue(again.nominationAllowed());
        assertFalse(factory.canAdd(artist));
        vm.prank(artist);
        again.setMailbox(vault);
        vm.warp(block.timestamp + 30 days);
        vm.prank(artist);
        again.nominate(buyer);
        assertTrue(again.nominated());
        assertTrue(factory.canAdd(buyer));
    }

    /// A large work can be restored after the origin is removed from the whitelist.
    /// That credit does not register a different file, and it is spent by the restore.
    function test_restoreLargeWorkWithoutWhitelist() public {
        vm.prank(owner);
        factory.setAuthorized(artist, true);
        OnPlate plate = _register(artist, 5, "Wide", "", keccak256("wide-life"));
        address[] memory chunks = _chunkList(plate);
        _sell(plate, artist, buyer, 1 ether);
        vm.prank(owner);
        factory.setAuthorized(artist, false);
        vm.prank(buyer);
        plate.burn();
        assertEq(factory.restores(artist, 5), 1);
        assertEq(factory.restores(artist, 6), 0);
        vm.prank(artist);
        vm.expectRevert(OnPlateFactory.NotAllowed.selector);
        factory.openBook(6);
        vm.prank(buyer);
        vm.expectRevert(OnPlateFactory.NotAllowed.selector);
        factory.openBook(5);
        address[] memory other = _pieces(artist, 5, 205);
        uint16 share = factory.devBps();
        bytes memory thumb = _thumb();
        vm.startPrank(artist);
        address wrong = factory.openBook(5);
        factory.addChunks(wrong, other);
        factory.sealBook(wrong);
        vm.expectRevert(OnPlateFactory.NotAllowed.selector);
        factory.addPhoto("Other", "A photograph.", "", keccak256("wide-other"), wrong, thumb, share, 0, address(0));
        vm.stopPrank();
        assertEq(factory.restores(artist, 5), 1);
        OnPlate again = _restore(artist, chunks, keccak256("wide-again"));
        assertTrue(again.nominationAllowed());
        assertFalse(factory.canAdd(artist));
        assertEq(again.chunkCount(), 5);
        assertEq(again.chunkAt(0), chunks[0]);
        assertEq(factory.restores(artist, 5), 0);
        vm.prank(artist);
        vm.expectRevert(OnPlateFactory.NotAllowed.selector);
        factory.openBook(5);
    }

    function _chunkList(OnPlate plate) internal view returns (address[] memory chunks) {
        uint256 n = plate.chunkCount();
        chunks = new address[](n);
        for (uint256 i = 0; i < n; ++i) chunks[i] = plate.chunkAt(i);
    }

    function _restore(address who, address[] memory chunks, bytes32 hash) internal returns (OnPlate plate) {
        vm.startPrank(who);
        address book = factory.openBook(chunks.length);
        factory.addChunks(book, chunks);
        factory.sealBook(book);
        address made = factory.addPhoto(
            "Burn", "A photograph.", "", hash, book, _thumb(), factory.devBps(), 0, address(0)
        );
        vm.stopPrank();
        plate = OnPlate(made);
    }

    function _link(address who, address[] memory chunks, bytes32 hash) internal returns (OnPlate plate) {
        bytes memory text = abi.encode("Burn", "A photograph.", "", _thumb());
        uint16 share = factory.devBps();
        vm.prank(who);
        plate = OnPlate(factory.linkPhoto(hash, chunks, share, 0, address(0), text));
    }

    function test_artistNameIsStoredAndBounded() public {
        bytes memory thumb = _thumb();
        string memory fortyEight = "0123456789abcdef0123456789abcdef0123456789abcdef";
        assertEq(bytes(fortyEight).length, 48);
        address book = _ready(owner);
        vm.prank(owner);
        address plate = factory.addPhoto("Chaise", "", fortyEight, keccak256("name-48"), book, thumb, 450, 0, address(0));
        assertEq(OnPlate(plate).artistName(), fortyEight);
        string memory json = string.concat(
            '{"name":"',
            OnPlate(plate).name(),
            '","description":"',
            OnPlate(plate).description(),
            '","artist_name":"',
            fortyEight,
            '","content_hash":"',
            Strings.toHexString(uint256(OnPlate(plate).contentHash()), 32),
            '","image":"data:image/png;base64,',
            Base64.encode(OnPlate(plate).thumbnail()),
            '"}'
        );
        string memory uri = OnPlate(plate).tokenURI(1);
        assertEq(uri, string.concat("data:application/json;base64,", Base64.encode(bytes(json))));
        assertFalse(_has(json, "http://"));
        assertFalse(_has(json, "ipfs://"));
        assertFalse(_has(json, "arweave"));

        address emptyBook = _ready(owner);
        vm.prank(owner);
        address blank = factory.addPhoto("Chaise", "", "", keccak256("name-0"), emptyBook, thumb, 450, 0, address(0));
        assertEq(OnPlate(blank).artistName(), "");

        _rejectName(string(bytes.concat(bytes(fortyEight), "x")));
        _rejectName('Say "no"');
        _rejectName(string(bytes.concat("Ada", bytes1(0x01))));
        _rejectName(string(bytes.concat("Ada", bytes1(0x7f))));
        _rejectName("Ada<");
        _rejectName("Ada>");
        _rejectName("Ada&");
        _rejectName("Ada\\");
        _rejectName(string(bytes.concat("Ada", hex"c3a9")));
        assertEq(factory.photoCount(), 2);
    }

    function _rejectName(string memory artistName_) internal {
        address book = _ready(owner);
        vm.prank(owner);
        vm.expectRevert(OnPlate.BadText.selector);
        factory.addPhoto("Chaise", "", artistName_, keccak256(bytes(artistName_)), book, _thumb(), 450, 0, address(0));
    }

    function _pieces(address who, uint256 n, uint256 salt) internal returns (address[] memory chunks) {
        chunks = new address[](n);
        uint256 off;
        while (off < n) {
            uint256 k = n - off;
            if (k > 4) k = 4;
            bytes[] memory inits = new bytes[](k);
            for (uint256 i = 0; i < k; ++i) {
                inits[i] = _init(abi.encodePacked(salt, off + i));
            }
            address helper = factory.batch();
            vm.prank(who);
            address[] memory made = ChunkBatch(helper).createPieces(inits);
            for (uint256 i = 0; i < k; ++i) chunks[off + i] = made[i];
            off += k;
        }
    }

    function _register(
        address who,
        uint256 n,
        string memory photoName,
        string memory artistName_,
        bytes32 hash
    ) internal returns (OnPlate plate) {
        address[] memory chunks = _pieces(who, n, uint256(uint160(who)) + n);
        vm.startPrank(who);
        address book = factory.openBook(n);
        factory.addChunks(book, chunks);
        factory.sealBook(book);
        address made = factory.addPhoto(
            photoName, "A photograph.", artistName_, hash, book, _thumb(), factory.devBps(), 0, address(0)
        );
        vm.stopPrank();
        plate = OnPlate(made);
    }

    function _rejectPaint(address target, bytes32 paint) internal {
        (, bytes32[] memory writes) = vm.accesses(target);
        for (uint256 i = 0; i < writes.length; ++i) {
            assertTrue(vm.load(target, writes[i]) != paint);
        }
    }

    function _hasBytes(bytes memory hay, bytes memory pin) internal pure returns (bool) {
        if (pin.length == 0 || hay.length < pin.length) return false;
        for (uint256 i = 0; i <= hay.length - pin.length; ++i) {
            bool same = true;
            for (uint256 j = 0; j < pin.length; ++j) {
                if (hay[i + j] != pin[j]) {
                    same = false;
                    break;
                }
            }
            if (same) return true;
        }
        return false;
    }

    /// The signer pays. The named wallet is the title, the holder, and the origin.
    /// The registration log still names the signer. A contract wallet does not get a callback.
    function test_signedUploadGivesTheWalletThePlate() public {
        address home = makeAddr("home");
        uint16 share = factory.devBps();
        address[] memory chunks = _pieces(artist, 1, 81);
        bytes memory text = abi.encode("Chaise", "A photograph.", "", _thumb());
        Puller box = new Puller();
        vm.recordLogs();
        vm.prank(artist);
        OnPlate plate = OnPlate(factory.linkPhoto(keccak256("deliver"), chunks, share, 0, address(0), text, home));
        assertEq(plate.title(), home);
        assertEq(plate.ownerOf(1), home);
        assertEq(ChunkBook(plate.book()).artist(), home);
        assertEq(factory.openedBy(plate.book()), address(0));
        (address origin, bool ended, bool chance) = factory.lineage(factory.workKey(plate.book()));
        assertEq(origin, home);
        assertFalse(ended);
        assertFalse(chance);
        assertFalse(factory.canAdd(home));
        _signerLog(address(plate), artist, home);
        vm.prank(artist);
        vm.expectRevert(OnPlate.NotTitle.selector);
        plate.list(1 ether);
        vm.prank(home);
        plate.list(1 ether);
        assertEq(plate.listedPrice(), 1 ether);
        vm.prank(home);
        plate.burn();
        vm.prank(artist);
        vm.expectRevert(OnPlateFactory.WorkEnded.selector);
        factory.linkPhoto(keccak256("deliver-ended"), chunks, share, 0, address(0), text, home);
        vm.prank(home);
        vm.expectRevert(OnPlateFactory.WorkEnded.selector);
        factory.linkPhoto(keccak256("deliver-ended-home"), chunks, share, 0, address(0), text);

        address[] memory boxed = _pieces(artist, 1, 82);
        vm.prank(artist);
        OnPlate quiet = OnPlate(factory.linkPhoto(keccak256("deliver-box"), boxed, share, 0, address(0), text, address(box)));
        assertEq(quiet.ownerOf(1), address(box));
        assertEq(quiet.title(), address(box));
    }

    /// The plate's one nomination follows the signer. The receiving wallet is the only account that can use it.
    function test_deliveredPlateNominatesOnceFromTheWallet() public {
        address home = makeAddr("home");
        address nominee = makeAddr("nominee");
        vm.prank(owner);
        factory.setAuthorized(artist, true);
        uint16 share = factory.devBps();
        bytes memory text = abi.encode("Chaise", "A photograph.", "", _thumb());
        address[] memory chunks = _pieces(artist, 1, 83);
        vm.prank(artist);
        OnPlate plate = OnPlate(factory.linkPhoto(keccak256("deliver-nom"), chunks, share, 0, address(0), text, home));
        assertTrue(plate.nominationAllowed());
        assertFalse(factory.canAdd(home));
        vm.prank(home);
        plate.setMailbox(vault);
        vm.warp(block.timestamp + 30 days);
        vm.prank(vault);
        vm.expectRevert(OnPlate.Nomination.selector);
        plate.nominate(nominee);
        vm.prank(artist);
        vm.expectRevert(OnPlate.Nomination.selector);
        plate.nominate(nominee);
        vm.prank(home);
        plate.nominate(nominee);
        assertTrue(factory.canAdd(nominee));
        assertFalse(factory.canAdd(home));
        assertTrue(plate.nominated());
        vm.prank(home);
        vm.expectRevert(OnPlate.Nomination.selector);
        plate.nominate(makeAddr("second"));
    }

    /// An open-tier signer cannot hand the receiver a nomination.
    function test_openTierDeliveryCannotNominate() public {
        address home = makeAddr("home");
        uint16 share = factory.devBps();
        bytes memory text = abi.encode("Chaise", "A photograph.", "", _thumb());
        address[] memory chunks = _pieces(buyer, 1, 84);
        vm.prank(buyer);
        OnPlate plate = OnPlate(factory.linkPhoto(keccak256("deliver-open"), chunks, share, 0, address(0), text, home));
        assertFalse(plate.nominationAllowed());
        assertEq(plate.title(), home);
        vm.prank(home);
        plate.setMailbox(vault);
        vm.warp(block.timestamp + 30 days);
        vm.prank(home);
        vm.expectRevert(OnPlate.Nomination.selector);
        plate.nominate(artist);
        assertFalse(factory.canAdd(artist));
    }

    /// A stranger, even a whitelisted one, cannot write a book opened for someone else.
    function test_strangerCannotFinishADeliveredBook() public {
        address home = makeAddr("home");
        address[] memory chunks = _pieces(artist, 1, 85);
        vm.prank(owner);
        factory.setAuthorized(buyer, true);
        vm.prank(artist);
        address book = factory.openBook(1, home);
        assertEq(factory.openedBy(book), artist);
        assertEq(ChunkBook(book).artist(), home);
        uint16 share = factory.devBps();
        bytes memory thumb = _thumb();
        vm.expectRevert(OnPlateFactory.NotAllowed.selector);
        vm.prank(buyer);
        factory.addChunks(book, chunks);
        vm.prank(home);
        factory.addChunks(book, chunks);
        vm.expectRevert(OnPlateFactory.NotAllowed.selector);
        vm.prank(buyer);
        factory.sealBook(book);
        vm.prank(artist);
        factory.sealBook(book);
        vm.expectRevert(OnPlateFactory.NotAllowed.selector);
        vm.prank(buyer);
        factory.addPhoto("Chaise", "A photograph.", "", keccak256("deliver-book"), book, thumb, share, 0, address(0));
        vm.prank(artist);
        OnPlate plate = OnPlate(
            factory.addPhoto("Chaise", "A photograph.", "", keccak256("deliver-book"), book, thumb, share, 0, address(0))
        );
        assertEq(plate.title(), home);
        assertEq(factory.openedBy(book), address(0));
    }

    /// After a sale, a burn by the buyer returns the list to the receiving wallet, not to the signer.
    function test_restoreStaysWithTheReceivingWallet() public {
        address home = makeAddr("home");
        vm.prank(owner);
        factory.setAuthorized(artist, true);
        uint16 share = factory.devBps();
        bytes memory thumb = _thumb();
        address[] memory chunks = _pieces(artist, 5, 86);
        vm.startPrank(artist);
        address book = factory.openBook(5, home);
        factory.addChunks(book, chunks);
        factory.sealBook(book);
        OnPlate plate = OnPlate(
            factory.addPhoto("Wide", "A photograph.", "", keccak256("deliver-wide"), book, thumb, share, 0, address(0))
        );
        vm.stopPrank();
        bytes32 key = factory.workKey(plate.book());
        (address origin,,) = factory.lineage(key);
        assertEq(origin, home);
        vm.prank(home);
        plate.list(1 ether);
        vm.prank(buyer);
        plate.buy{value: 1 ether}();
        vm.prank(buyer);
        plate.burn();
        assertEq(factory.restores(home, 5), 1);
        assertEq(factory.restores(artist, 5), 0);
        vm.startPrank(artist);
        address stolen = factory.openBook(5, home);
        factory.addChunks(stolen, chunks);
        factory.sealBook(stolen);
        vm.expectRevert(OnPlateFactory.WorkTaken.selector);
        factory.addPhoto("Wide", "A photograph.", "", keccak256("deliver-again"), stolen, thumb, share, 0, address(0));
        vm.stopPrank();
        assertEq(factory.restores(home, 5), 1);
        address attacker = makeAddr("attacker");
        vm.startPrank(home);
        address diverted = factory.openBook(5, attacker);
        factory.addChunks(diverted, chunks);
        factory.sealBook(diverted);
        vm.expectRevert(OnPlateFactory.WorkTaken.selector);
        factory.addPhoto("Wide", "A photograph.", "", keccak256("deliver-divert"), diverted, thumb, share, 0, address(0));
        vm.stopPrank();
        assertEq(factory.restores(home, 5), 1);
        assertFalse(factory.canAdd(home));
        OnPlate again = _restore(home, chunks, keccak256("deliver-restored"));
        assertEq(again.title(), home);
        assertEq(factory.restores(home, 5), 0);
        (origin,,) = factory.lineage(key);
        assertEq(origin, home);
    }

    /// The factory cannot be the home. A removed signer cannot finish a large delivery.
    /// The receiver's own whitelist does not let the signer open a large book.
    function test_badHomeAndSpentSignerAreRefused() public {
        address home = makeAddr("home");
        uint16 share = factory.devBps();
        bytes memory thumb = _thumb();
        bytes memory text = abi.encode("No", "", "", thumb);
        address[] memory one = _pieces(artist, 1, 87);
        vm.expectRevert(OnPlateFactory.Hook.selector);
        vm.prank(artist);
        factory.openBook(1, address(factory));
        vm.expectRevert(OnPlateFactory.Hook.selector);
        vm.prank(artist);
        factory.linkPhoto(keccak256("factory-home"), one, share, 0, address(0), text, address(factory));
        vm.prank(artist);
        address book = factory.openBook(1, address(0));
        assertEq(ChunkBook(book).artist(), artist);
        assertEq(factory.openedBy(book), artist);

        vm.prank(owner);
        factory.setAuthorized(home, true);
        vm.expectRevert(OnPlateFactory.NotAllowed.selector);
        vm.prank(artist);
        factory.openBook(5, home);

        vm.prank(owner);
        factory.setAuthorized(artist, true);
        vm.prank(artist);
        address wide = factory.openBook(5, home);
        address[] memory chunks = _pieces(artist, 5, 88);
        vm.prank(artist);
        factory.addChunks(wide, chunks);
        vm.prank(artist);
        factory.sealBook(wide);
        vm.prank(owner);
        factory.setAuthorized(artist, false);
        vm.expectRevert(OnPlateFactory.NotAllowed.selector);
        vm.prank(artist);
        factory.addPhoto("Wide", "A photograph.", "", keccak256("cut-off"), wide, thumb, share, 0, address(0));
        assertEq(factory.photoCount(), 0);
        assertEq(factory.restores(home, 5), 0);
    }

    /// The royalty payee stays the address typed on the form. The sale pays that payee, not the signer.
    function test_royaltyPayeeIsNotTheNewTitle() public {
        address home = makeAddr("home");
        uint16 share = factory.devBps();
        bytes memory text = abi.encode("Chaise", "A photograph.", "Ada", _thumb());
        address[] memory chunks = _pieces(artist, 1, 89);
        vm.prank(artist);
        OnPlate plate = OnPlate(factory.linkPhoto(keccak256("deliver-royalty"), chunks, share, 1000, artistPayee, text, home));
        assertEq(plate.title(), home);
        assertEq(plate.artistRecipient(), artistPayee);
        assertEq(plate.artistName(), "Ada");
        vm.prank(home);
        plate.list(1 ether);
        vm.prank(buyer);
        plate.buy{value: 1 ether}();
        assertEq(plate.title(), buyer);
        assertEq(plate.claimable(owner), 0.045 ether);
        assertEq(plate.claimable(artistPayee), 0.1 ether);
        assertEq(plate.claimable(home), 0.855 ether);
        assertEq(plate.claimable(artist), 0);
        (address origin,,) = factory.lineage(factory.workKey(plate.book()));
        assertEq(origin, home);
    }

    function _signerLog(address plate, address signer, address home_) internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 added = keccak256("PhotoAdded(uint256,address,address)");
        bytes32 opened = keccak256("BookOpened(address,address,uint256)");
        bool sawPlate;
        bool sawBook;
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].topics[0] == added) {
                assertEq(address(uint160(uint256(logs[i].topics[2]))), plate);
                assertEq(address(uint160(uint256(logs[i].topics[3]))), signer);
                sawPlate = true;
            }
            if (logs[i].topics[0] == opened) {
                assertEq(address(uint160(uint256(logs[i].topics[2]))), home_);
                sawBook = true;
            }
        }
        assertTrue(sawPlate);
        assertTrue(sawBook);
    }
}
