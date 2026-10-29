const version = "0.0.3";

let dif = 14.42;
const columns = [];
for (let i = 0; i < 7; i++) {
    columns.push(dif * i);
}
const toprow = 0.08;
const bottomrow = 22.16;
const rowoffset = 3;


function newBoard() {
    return {
        stock: [],
        waste: [],
        foundations: [[], [], [], []],
        tableau: [[], [], [], [], [], [], []]
    };
}

function newCard(suit, rank, flipped) {
    return { suit, rank, flipped: (flipped || false) };
}

function deal(board) {
    function dealCards(count, flipped) {
        let card = null;
        for (let i = 0; i < count; i++) {
            card = board.stock.pop();
            board.tableau[6 - i].push(card);
            console.log(card, i, count);
            card.flipped = flipped || false;
        }
    }
    for (let i = 0; i < 8; i++) {
        dealCards(i, i == 7);
    }
}

function shuffle() {
    const cards = [];
    const suits = ["s", "h", "c", "d"];
    const ranks = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13"];
    for (const suit of suits) {
        for (const rank of ranks) {
            cards.push(newCard(suit, rank));
        }
    }
    cards.sort(() => Math.random() - 0.5);
    const board = newBoard();
    board.stock = cards;
    deal(board);
    return board;
}

function loadBoardElements(board) {
    for (const card of board.stock) {
        card.element = document.querySelector(`.card.card-${card.suit}${card.rank}`);
    }
    for (const card of board.waste) {
        card.element = document.querySelector(`.card.card-${card.suit}${card.rank}`);
    }
    for (const foundation of board.foundations) {
        for (const card of foundation) {
            card.element = document.querySelector(`.card.card-${card.suit}${card.rank}`);
        }
    }
    for (const pile of board.tableau) {
        for (const card of pile) {
            card.element = document.querySelector(`.card.card-${card.suit}${card.rank}`);
        }
    }
}

function cloneBoard(board) {
    const copy = newBoard();
    copy.stock = board.stock.map(card => newCard(card.suit, card.rank, card.flipped));
    copy.waste = board.waste.map(card => newCard(card.suit, card.rank, card.flipped));
    copy.foundations = board.foundations.map(foundation => foundation.map(card => newCard(card.suit, card.rank, card.flipped)));
    copy.tableau = board.tableau.map(pile => pile.map(card => newCard(card.suit, card.rank, card.flipped)));
    return copy;
}

function saveBoard(board) {
    const boardData = cloneBoard(board);
    boardData.version = version;
    localStorage.setItem("solitaire-board", JSON.stringify(boardData));
}

function loadBoard() {
    const savedBoard = localStorage.getItem("solitaire-board");
    if (savedBoard) {
        const data = JSON.parse(savedBoard);
        if (data.version == version && false) {
            delete data.version;
            return data;
        }
    }
    return shuffle();
}

function renderBoard(board) {
    let index = 0;
    for (const card of board.stock) {
        moveCard(card, columns[0], toprow, ++index);
    }
    for (const card of board.waste) {
        moveCard(card, columns[1], toprow, ++index);
    }
    for (const ind in board.foundations) {
        for (const card of board.foundations[ind]) {
            moveCard(card, columns[ind + 3], toprow, ++index);
        }
    }

    for (const ind in board.tableau) {
        for (const i in board.tableau[ind]) {
            moveCard(board.tableau[ind][i], columns[ind], bottomrow + (i * rowoffset), ++index);
        }
    }
}

function moveCard(card, x, y, z) {
    card.element.style.left = `${x}cqi`;
    card.element.style.top = `${y}cqi`;
    card.element.style.zIndex = z;
    card.element.classList.toggle("flipped", !card.flipped);
}

function getCardPileAndIndex(card, board) {
    let index = board.stock.indexOf(card);
    if (index != -1) return ["stock", index];
    index = board.waste.indexOf(card);
    if (index != -1) return ["waste", index];
    index = board.foundations.indexOf(card);
    for (const ind in board.foundations) {
        const foundation = board.foundations[ind];
        index = foundation.indexOf(card);
        if (index != -1) return [`foundation-${ind}`, index];
    }
    for (const ind in board.tableau) {
        const pile = board.tableau[ind];
        index = pile.indexOf(card);
        if (index != -1) return [`tableau-${ind}`, index];
    }
    return null;
}


const shuffleBtn = document.getElementById("shuffle");
const undoBtn = document.getElementById("undo");
const redoBtn = document.getElementById("redo");
let undoStack = [];
let redoStack = [];
let board = loadBoard();
loadBoardElements(board);
saveBoard(board);
renderBoard(board);
updateToolbar();

function updateToolbar() {
    undoBtn.disabled = undoStack.length === 0;
    redoBtn.disabled = redoStack.length === 0;
}


const cardsEl = document.querySelector(".cards");
let drag = null;
let dragZ = 1000;

function placeDragged(e) {
    const rect = cardsEl.getBoundingClientRect();
    drag.el.style.left = `${e.clientX - rect.left - drag.offsetX}px`;
    drag.el.style.top = `${e.clientY - rect.top - drag.offsetY}px`;
}

function endDrag() {
    if (!drag) return;
    drag.el.classList.remove("dragging");
    drag = null;
}

cardsEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const el = e.target.closest(".card");
    if (!el) return;
    const cardRect = el.getBoundingClientRect();
    drag = {
        el,
        offsetX: e.clientX - cardRect.left,
        offsetY: e.clientY - cardRect.top,
    };
    el.style.zIndex = String(++dragZ);
    el.classList.add("dragging");
    el.setPointerCapture(e.pointerId);
    placeDragged(e);
    e.preventDefault();
});

cardsEl.addEventListener("pointermove", (e) => {
    if (!drag) return;
    placeDragged(e);
});

cardsEl.addEventListener("pointerup", endDrag);
cardsEl.addEventListener("pointercancel", endDrag);

shuffleBtn.addEventListener("click", () => {
    undoStack = [];
    redoStack = [];
    board = shuffle();
    loadBoardElements(board);
    saveBoard(board);
    renderBoard(board);
    updateToolbar();
});

undoBtn.addEventListener("click", () => {
    if (!undoStack.length) return;
    // TODO: Implement undo
});

redoBtn.addEventListener("click", () => {
    if (!redoStack.length) return;
    // TODO: Implement redo
});