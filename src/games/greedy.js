const DICE_STATE_NONE = "";
const DICE_STATE_FRESH = "fresh";
const DICE_STATE_PICKED = "picked";
const DICE_STATE_LOCKED = "locked";

const sounds_roll = [
  document.getElementById("snd-roll-1"),
  document.getElementById("snd-roll-2"),
  document.getElementById("snd-roll-3")
];

const sounds_throw = [
  document.getElementById("snd-throw-1"),
  document.getElementById("snd-throw-2"),
  document.getElementById("snd-throw-3")
];

const DICE_VAL_1 = 1;
const DICE_VAL_2 = 2;
const DICE_VAL_3 = 3;
const DICE_VAL_4 = 4;
const DICE_VAL_5 = 5;
const DICE_VAL_6 = 6;
const DICE_VAL_WILD = "wild";

const ROLL_TIME = 600;

const wildPick = document.getElementById("wild-pick");

const die0 = document.getElementById("die-0");
const die1 = document.getElementById("die-1");
const die2 = document.getElementById("die-2");
const die3 = document.getElementById("die-3");
const die4 = document.getElementById("die-4");
const die5 = document.getElementById("die-5");
const dice = [die0, die1, die2, die3, die4, die5];

const tglZilch = document.getElementById("tgl-zilch");
const tglWild = document.getElementById("tgl-wild");
const tglCrazy = document.getElementById("tgl-crazy");
const tglBarrier = document.getElementById("tgl-barrier");
const tgls = [tglZilch, tglWild, tglCrazy, tglBarrier];

const livesRow = document.getElementById("lives");

const life1 = document.getElementById("life-1");
const life2 = document.getElementById("life-2");
const life3 = document.getElementById("life-3");
const lives = [life1, life2, life3];

const rollBtn = document.getElementById("roll");
const plusBtn = document.getElementById("plus");
const bankBtn = document.getElementById("bank");
const bankedPoints = document.getElementById("banked-points");
const points = document.getElementById("points");
const feedback = document.getElementById("feedback");
const dicePickModal = document.getElementById("dice-pick-modal");
const scoresModal = document.getElementById("scores-modal");
const scoresDisplay = document.getElementById("scores");
const scoreModal = document.getElementById("score-modal");
const scoreDisplay = document.getElementById("score");

let dieVals = [DICE_VAL_1, DICE_VAL_2, DICE_VAL_3, DICE_VAL_4, DICE_VAL_5, DICE_VAL_6];
let dieStates = [DICE_STATE_NONE, DICE_STATE_NONE, DICE_STATE_NONE, DICE_STATE_NONE, DICE_STATE_NONE, DICE_STATE_NONE];
let banked = 0;
let score = 0;
let busts = 0;
let started = false;
let gameOver = true;
let zilches = 0;
let turns = 0;
let scores = [];

function clearDice() {
  dieStates = [DICE_STATE_NONE, DICE_STATE_NONE, DICE_STATE_NONE, DICE_STATE_NONE, DICE_STATE_NONE, DICE_STATE_NONE];
  dieVals = [DICE_VAL_1, DICE_VAL_2, DICE_VAL_3, DICE_VAL_4, DICE_VAL_5, DICE_VAL_6];
  started = false;
  render();
}

let dieCycle = 0;

function roll() {
  setFeedback("");
  sounds_roll[Math.floor(Math.random() * 3)].play();
  const all = dieStates.filter(s => s == DICE_STATE_PICKED || s == DICE_STATE_LOCKED).length == 6;
  if (all) {
    dieStates.fill(DICE_STATE_NONE);
  }
  const rolled = [];
  for (let i = 0; i < 6; i++) {
    const state = dieStates[i];
    if (state == DICE_STATE_LOCKED) continue;
    if (state == DICE_STATE_PICKED) {
      dieStates[i] = DICE_STATE_LOCKED;
      continue;
    }
    dieCycle++;
    dice[i].classList.add("die-cycle", `die-cycle-${dieCycle % 6}`);
    dieVals[i] = 1 + Math.floor(Math.random() * 6);
    dieStates[i] = DICE_STATE_FRESH;
    rolled.push(i);
  }
  if (tglWild.checked && Math.ceil(Math.random() * 100) > 95) {
    dieVals[rolled[Math.floor(Math.random() * rolled.length)]] = DICE_VAL_WILD;
  }
  setTimeout(() => {
    for (const die of dice) {
      die.classList.remove(
        "die-cycle",
        "die-cycle-0",
        "die-cycle-1",
        "die-cycle-2",
        "die-cycle-3",
        "die-cycle-4",
        "die-cycle-5"
      );
    }
  }, ROLL_TIME);
}

function setDice(vals) {
  for (const index in dieVals) {
    dieVals[index] = vals[index] || 1
  }
  render();
}

let feedbackTimer;

function setFeedback(text, type) {
  clearTimeout(feedbackTimer);
  feedback.textContent = text;
  feedback.classList.remove("success", "info", "warning", "fail");
  if (type) feedback.classList.add(type);
  if (text) {
    feedbackTimer = setTimeout(() => setFeedback(""), 5000);
  }
}

function openDicePickModal() {
  dicePickModal.showModal();
}

function closeDicePickModal() {
  dicePickModal.close();
}

function openScoresModal() {
  scoresModal.showModal();
}

function closeScoresModal() {
  scoresModal.close();
}

function openScoreModal(score) {
  scoreDisplay.textContent = score.toString();
  scoreModal.showModal();
}

function closeScoreModal() {
  scoreModal.close();
}

function render() {
  for (let i = 0; i < 6; i++) {
    const die = dice[i];
    die.dataset.val = dieVals[i];
    die.dataset.state = dieStates[i];
  }
  bankBtn.disabled = !started;
  plusBtn.disabled = !started;
  renderPoints(bankedPoints, banked);
  const picked = getPickedDice();
  const pickedScore = isValidDiceSelection(picked) ? scoreSelection(picked) : 0;
  renderPoints(points, score + pickedScore);
  renderLives();
}

function renderPoints(elem, points) {
  const digits = elem.querySelectorAll("span");
  const str = points.toString().padStart(5, "0");
  for (let i = 0; i < 5; i++) {
    digits[i].textContent = str[i];
  }
}

function getDiceAtState(state) {
  const dice = [];
  for (let i = 0; i < 6; i++) {
    const at = dieStates[i];
    if (at == state) {
      dice.push(i);
    }
  }
  return dice;
}

function getDiceAtValue(value) {
  const dice = [];
  for (let i = 0; i < 6; i++) {
    const at = dieVals[i];
    if (at == value) {
      dice.push(i);
    }
  }
  return dice;
}

function getDiceNotAtState(state) {
  const dice = [];
  for (let i = 0; i < 6; i++) {
    const at = dieStates[i];
    if (at != state) {
      dice.push(i);
    }
  }
  return dice;
}

function getWildDice() {
  return getDiceAtValue(DICE_VAL_WILD);
}

function getPickedDice() {
  return getDiceAtState(DICE_STATE_PICKED);
}

function getLockedDice() {
  return getDiceAtState(DICE_STATE_LOCKED);
}

function getNotLockedDice() {
  return getDiceNotAtState(DICE_STATE_LOCKED);
}

function getAlwaysValidPickedDiceValues() {
  const valid = [1, 5];
  const locked = getLockedDice();
  const values = countUpSelectionValues(locked);
  for (const index in values) {
    if (values[index] > 2) {
      valid.push(parseInt(index) + 1);
    }
  }
  return valid.filter((val, i) => valid.indexOf(val) == i);
}

function countUpSelectionValues(selection) {
  const values = [0, 0, 0, 0, 0, 0];
  for (const index of selection) {
    values[dieVals[index] - 1] += 1;
  }
  return values;
}

function checkSpecialHands(picked, reduce) {
  reduce = reduce || false;
  const counted = countUpSelectionValues(picked);
  const sorted = [...counted];
  sorted.sort();
  const getFiltered = (values) => values.filter(val => val > 0);
  const getUnique = (values) => values.filter((val, i) => values.indexOf(val) == i).sort();


  let filtered = getFiltered(counted);
  let unique = getUnique(filtered);

  if (filtered.length == 6 && unique.length == 1 && unique[0] == 1) {
    return true;
  }

  if (filtered.length == 5) {
    if (reduce) return true;
    if (unique.length == 1) {
      return unique[0] == 1 && (counted[0] == 0 || counted[5] == 0);
    } else if (unique.length == 2 && unique[0] == 1 && unique[1] == 2) {
      return counted[0] == 2 || counted[4] == 2;
    } else {
      return false;
    }
  }

  if (filtered.length == 5 && (reduce || (unique.length == 1 && unique[0] == 1 && (counted[0] == 0 || counted[6] == 0)))) {
    return true;
  }

  if (filtered.length == 2 && unique.length == 2 && unique[0] == 2 && unique[1] == 4) {
    return true;
  }

  if (filtered.length == 3 && unique.length == 1 && unique[0] == 2) {
    return true;
  }

  const minusOnesAndFives = [counted[1], counted[2], counted[3], counted[5]];
  filtered = getFiltered(minusOnesAndFives);

  if (reduce) {
    if (sorted[sorted.length - 1] >= 3) {
      return true;
    }
  } else {
    if (filtered.length == 1 && filtered[0] >= 3) {
      return true;
    }
  }

  return false;
}

function scoreSelection(selection) {
  const values = countUpSelectionValues(selection);
  const str = values.join("");
  if (str == "111111") return 1800;
  if (str == "011111" || str == "111110") return 900;
  if (str == "211110") return 1000;
  if (str == "011121") return 950;

  const getCounted = (values, min) => values.filter(val => val > (min || 0));
  const getUnique = (values) => values.filter((val, i) => values.indexOf(val) == i).sort();
  let counted = getCounted(values);
  let unique = getUnique(counted);

  if (counted.length == 3 && unique.length == 1 && unique[0] == 2) {
    return 1000;
  }
  if (counted.length == 2 && unique.length == 2 && unique[0] == 2 && unique[1] == 4) {
    return 1000;
  }

  let score = 0;
  const val = [100, 20, 30, 40, 50, 60];
  const mults = [0, 0, 10, 20, 40, 80];

  for (let i = 0; i < 6; i++) {
    const count = values[i];
    if (count < 1) continue;
    let mult = mults[count - 1];
    if ((i == 0 || i == 4) && count < 3) {
      mult = count;
    }
    score += val[i] * mult;
  }
  return score;
}

function isValidDiceSelection(selection) {
  if (selection.length < 1) return false;
  const valid = getAlwaysValidPickedDiceValues();
  const invalid = [];
  for (const index of selection) {
    if (!valid.includes(dieVals[index])) {
      invalid.push(index);
    }
  }
  if (invalid.length > 0) {
    if (!checkSpecialHands(selection)) {
      return false;
    }
  }
  return true;
}

function hasValidDiceSelection(selection, reduce) {
  if (selection.length < 1) return false;
  const valid = getAlwaysValidPickedDiceValues();
  for (const index of selection) {
    if (valid.includes(dieVals[index])) {
      return true;
    }
  }
  return checkSpecialHands(selection, reduce);
}

function bust() {
  setFeedback("Bust", "fail");
  if (!tglZilch.checked) return;
  if (banked < 1) return;
  zilches++;
  if (zilches == 2) {
    setTimeout(() => {
      setFeedback("Warning last life", "warning");
    }, 700);
  }
  renderLives();
  if (zilches > 2) {
    busts++;
    gameOver = true;
    setTimeout(() => {
      setFeedback("GAME OVER", "fail");
    }, 700);
  }
  save();
}

function renderLives() {
  for (let i = 0; i < 3; i++) {
    lives[i].classList.toggle("active", i < zilches);
  }
}

rollBtn.addEventListener("click", () => {
  if (gameOver) {
    reset();
    setFeedback("Game Start!", "info");
  }
  if (!started) {
    clearDice();
    started = true;
    turns++;
  } else {
    const picked = getPickedDice();
    if (!isValidDiceSelection(picked)) {
      return;
    }
    score += scoreSelection(picked);
  }
  if (getWildDice().length > 0) {
    setFeedback("Must choose wild dice first", "info");
    return;
  }
  roll();
  const notLocked = getNotLockedDice();
  if (!hasValidDiceSelection(notLocked, true) && getWildDice().length < 1) {
    started = false;
    score = 0;
    dieStates.fill(DICE_STATE_NONE);
    setTimeout(bust, ROLL_TIME);
  }
  render();
  save();
});

function checkSelected(reduce) {
  const picked = getPickedDice();
  console.log(picked, hasValidDiceSelection(picked, !!reduce));
}

plusBtn.addEventListener("click", () => {
  if (!started) return;
  const picked = getPickedDice().length < 6;
  for (let i = 0; i < 6; i++) {
    const state = dieStates[i];
    if (state == DICE_STATE_LOCKED) continue;
    dieStates[i] = picked ? DICE_STATE_PICKED : DICE_STATE_NONE;
  }
  render();
});

bankBtn.addEventListener("click", () => {
  if (!started) return;
  const picked = getPickedDice();
  if (!isValidDiceSelection(picked)) {
    return;
  }
  const current = scoreSelection(picked);
  if (tglBarrier.checked) {
    if ((score + current) < 1000 && banked < 1000) {
      setFeedback("First bank must be atleast 1000", "warning");
      return;
    }
  }
  score += current;
  banked += score;
  score = 0;
  for (let i = 0; i < 6; i++) {
    dieStates[i] = DICE_STATE_NONE;
  }
  started = false;
  zilches = 0;
  if (banked >= 10000) {
    gameOver = true;
    scores.push([banked, turns]);
    openScoreModal(banked);
    setFeedback("Success!", "success");
  }
  render();
  save();
});

function dieClick(die, index) {
  if (!started) return;
  const val = dieVals[index];
  if (val == DICE_VAL_WILD) {
    openDicePickModal();
    return;
  }
  for (const i in dieStates) {
    if (dieStates[i] == DICE_STATE_FRESH) {
      dieStates[i] = DICE_STATE_NONE;
    }
  }
  const state = dieStates[index];
  if (state == DICE_STATE_LOCKED) return;
  dieStates[index] = state == DICE_STATE_PICKED ? DICE_STATE_NONE : DICE_STATE_PICKED;
  render();
  save();
}

for (const index in dice) {
  dice[index].addEventListener("click", () => dieClick(dice[index], index));
}

function saveOptions() {
  const data = {
    zilch: tglZilch.checked,
    wild: tglWild.checked,
    crazy: tglCrazy.checked,
    barrier: tglBarrier.checked,
  };
  localStorage.setItem("greedy-options", JSON.stringify(data));
  livesRow.classList.toggle("hidden", !data.zilch);
}

function loadOptions() {
  const savedData = localStorage.getItem("greedy-options");
  if (savedData) {
    const data = JSON.parse(savedData);
    if (typeof data == "object" && data != null) {
      tglZilch.checked = data.zilch;
      tglWild.checked = data.wild;
      tglCrazy.checked = data.crazy;
      tglBarrier.checked = data.barrier;
    }
  }
  saveOptions();
}

for (const tgl of tgls) {
  tgl.addEventListener("input", saveOptions);
}


function reset() {
  started = false;
  banked = 0;
  score = 0;
  zilches = 0;
  dieStates.fill(DICE_STATE_NONE);
  dieVals.fill(0);
  turns = 0;
  gameOver = false;
  render();
}

function save() {
  const data = {
    values: dieVals,
    states: dieStates,
    started: started,
    score: score,
    banked: banked,
    turns: turns,
    zilches: zilches,
    over: gameOver,
    busts: busts,
    scores: scores,
  };
  localStorage.setItem("greedy-save", JSON.stringify(data));
}

function load() {
  const saveData = localStorage.getItem("greedy-save");
  if (saveData) {
    const data = JSON.parse(saveData);
    console.log("Load:", data);
    banked = data.banked || 0;
    score = data.score || 0;
    zilches = data.zilches || 0;
    turns = data.turns || 0;
    started = !!data.started;
    busts = data.busts || 0;
    gameOver = !!data.gameOver;
    if (data.scores instanceof Array) {
      for (const score of data.scores) {
        scores.push(score);
      }
    }
    if (data.values instanceof Array) {
      for (const i in dieVals) {
        dieVals[i] = data.values[i] || false;
        console.log("vals", dieVals, data.values, i);
      }
    }
    if (data.states instanceof Array) {
      for (const i in dieStates) {
        const state = data.states[i];
        dieStates[i] = typeof state === "string" ? state : false;
        console.log("states", dieStates, data.states, i);
      }
    }
    if (dieStates.some(v => v === false) || dieVals.some(v => v === false)) {
      console.log("Save Load Failed");
      reset();
    } else {
      render();
    }
  }
}

wildPick.addEventListener("click", (event) => {
  if (!event.target.classList.contains("die")) return;
  const val = event.target.dataset.val || false;
  if (val) {
    const wilds = getWildDice();
    for (const index of wilds) {
      dieVals[index] = parseInt(val);
    }
    for (const i in dieStates) {
      if (dieStates[i] == DICE_STATE_FRESH) {
        dieStates[i] = DICE_STATE_NONE;
      }
    }
    render();
    closeDicePickModal();
    save();
  }
});

loadOptions();
load();
render();
