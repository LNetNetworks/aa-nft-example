// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title Pixel Flores — ERC-721 de 5000 flores pixel art en IPFS
/// @notice Minteo secuencial: el primer token es el #1 y el último el #5000.
///         Sin dependencias externas para que compile y despliegue en LNET tal cual.
///         `baseURI` se fija en el constructor y no tiene setter: el arte queda
///         inmutable, apuntando al CID de IPFS de la carpeta de metadatos.
contract PixelFlores {
    string public constant name = "Pixel Flores";
    string public constant symbol = "FLOR";
    uint256 public constant MAX_SUPPLY = 5000;

    /// @dev Termina en "/" — tokenURI concatena "<id>.json".
    string public baseURI;

    /// @notice Último id minteado. El próximo es `totalMinted + 1`.
    uint256 public totalMinted;

    mapping(uint256 => address) private _ownerOf;
    mapping(address => uint256) private _balanceOf;
    mapping(uint256 => address) private _approved;
    mapping(address => mapping(address => bool)) private _operators;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    error SoldOut();
    error NotMinted();
    error NotAuthorized();
    error WrongOwner();
    error ZeroAddress();
    error NotReceiver();

    constructor(string memory baseURI_) {
        baseURI = baseURI_;
    }

    // ------------------------------------------------------------------ mint --

    /// @notice Mintea el siguiente token al llamante. Devuelve el id asignado.
    /// @dev Es la única función de escritura que la webapp permite en su policy.
    function mint() external returns (uint256 tokenId) {
        tokenId = totalMinted + 1;
        if (tokenId > MAX_SUPPLY) revert SoldOut();
        totalMinted = tokenId;
        _ownerOf[tokenId] = msg.sender;
        unchecked {
            ++_balanceOf[msg.sender];
        }
        emit Transfer(address(0), msg.sender, tokenId);
    }

    /// @notice Cuántos quedan por mintear.
    function remaining() external view returns (uint256) {
        return MAX_SUPPLY - totalMinted;
    }

    // --------------------------------------------------------------- metadata --

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        if (_ownerOf[tokenId] == address(0)) revert NotMinted();
        return string.concat(baseURI, _toString(tokenId), ".json");
    }

    /// @notice Dueños de un rango de ids, para pintar la galería en una sola llamada.
    ///         Devuelve address(0) en los ids todavía no minteados.
    function ownersOfRange(uint256 from, uint256 count) external view returns (address[] memory out) {
        out = new address[](count);
        for (uint256 i = 0; i < count; ++i) {
            out[i] = _ownerOf[from + i];
        }
    }

    /// @notice Ids que pertenecen a `owner` dentro de un rango, sin ceros al final.
    function tokensOfOwnerIn(address owner, uint256 from, uint256 count)
        external
        view
        returns (uint256[] memory ids)
    {
        uint256[] memory buf = new uint256[](count);
        uint256 n;
        for (uint256 i = 0; i < count; ++i) {
            uint256 id = from + i;
            if (_ownerOf[id] == owner) {
                buf[n] = id;
                ++n;
            }
        }
        ids = new uint256[](n);
        for (uint256 i = 0; i < n; ++i) {
            ids[i] = buf[i];
        }
    }

    // ----------------------------------------------------------------- ERC-721 --

    function ownerOf(uint256 tokenId) public view returns (address owner) {
        owner = _ownerOf[tokenId];
        if (owner == address(0)) revert NotMinted();
    }

    function balanceOf(address owner) external view returns (uint256) {
        if (owner == address(0)) revert ZeroAddress();
        return _balanceOf[owner];
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        if (_ownerOf[tokenId] == address(0)) revert NotMinted();
        return _approved[tokenId];
    }

    function isApprovedForAll(address owner, address operator) external view returns (bool) {
        return _operators[owner][operator];
    }

    function approve(address to, uint256 tokenId) external {
        address owner = ownerOf(tokenId);
        if (msg.sender != owner && !_operators[owner][msg.sender]) revert NotAuthorized();
        _approved[tokenId] = to;
        emit Approval(owner, to, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operators[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        if (to == address(0)) revert ZeroAddress();
        address owner = ownerOf(tokenId);
        if (owner != from) revert WrongOwner();
        if (msg.sender != owner && msg.sender != _approved[tokenId] && !_operators[owner][msg.sender]) {
            revert NotAuthorized();
        }
        delete _approved[tokenId];
        unchecked {
            --_balanceOf[from];
            ++_balanceOf[to];
        }
        _ownerOf[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public {
        transferFrom(from, to, tokenId);
        if (to.code.length != 0) {
            bytes4 retval = IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data);
            if (retval != IERC721Receiver.onERC721Received.selector) revert NotReceiver();
        }
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 // ERC-165
            || interfaceId == 0x80ac58cd // ERC-721
            || interfaceId == 0x5b5e139f; // ERC-721Metadata
    }

    // -------------------------------------------------------------- internals --

    function _toString(uint256 v) private pure returns (string memory) {
        if (v == 0) return "0";
        uint256 digits;
        for (uint256 t = v; t != 0; t /= 10) {
            ++digits;
        }
        bytes memory buf = new bytes(digits);
        while (v != 0) {
            buf[--digits] = bytes1(uint8(48 + (v % 10)));
            v /= 10;
        }
        return string(buf);
    }
}

interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external
        returns (bytes4);
}
