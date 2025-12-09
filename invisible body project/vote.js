// Use the same session ID as the performance screen
const sessionId = window.SESSION_ID || "session-001";

let currentPhase = "waiting";
let currentAction = 0;

// Give each viewer a persistent random id (stored in localStorage)
let viewerId = localStorage.getItem("invisibleBodyViewerId");
if (!viewerId) {
  viewerId = "viewer-" + Math.random().toString(36).slice(2, 10);
  localStorage.setItem("invisibleBodyViewerId", viewerId);
}

// DOM references
const connectionStatusEl = document.getElementById("connectionStatus");
const phaseTagEl = document.getElementById("phaseTag");
const phaseValueEl = phaseTagEl.querySelector(".pill-value");
const actionTagEl = document.getElementById("actionTag");
const actionValueEl = actionTagEl.querySelector(".pill-value");

const voteForm = document.getElementById("voteForm");
const labelInput = document.getElementById("labelInput");
const confidenceInput = document.getElementById("confidenceInput");
const submitButton = document.getElementById("submitButton");
const formMessageEl = document.getElementById("formMessage");

// Listen to live state from performance screen
const stateRef = db.ref(`sessions/${sessionId}/state`);

stateRef.on(
  "value",
  (snapshot) => {
    const state = snapshot.val();
    if (!state) {
      connectionStatusEl.textContent = "Waiting for the performance to start…";
      updatePhaseAndActionUI("waiting", 0);
      setFormEnabled(false, "You can vote once the training phase begins.");
      return;
    }

    currentPhase = state.phase || "waiting";
    currentAction = state.currentAction || 0;

    connectionStatusEl.textContent = `Connected to session: ${sessionId}`;
    updatePhaseAndActionUI(currentPhase, currentAction);

    if (currentPhase === "training" && currentAction > 0) {
      setFormEnabled(
        true,
        `You are annotating action ${currentAction} in the training phase.`
      );
    } else if (currentPhase === "inference") {
      setFormEnabled(
        false,
        "The system is now replaying your collective labels. New votes are disabled."
      );
    } else if (currentPhase === "done") {
      setFormEnabled(false, "The performance has ended. Thank you for participating.");
    } else {
      setFormEnabled(false, "Waiting for the next segment to begin…");
    }
  },
  (error) => {
    console.error("Error listening to state:", error);
    connectionStatusEl.textContent =
      "Could not connect to the live session. Please refresh later.";
    setFormEnabled(false, "Connection error.");
  }
);

function updatePhaseAndActionUI(phase, action) {
  // Update phase pill
  phaseValueEl.textContent = phase;
  phaseTagEl.classList.remove(
    "phase-training",
    "phase-inference",
    "phase-waiting",
    "phase-done"
  );

  if (phase === "training") {
    phaseTagEl.classList.add("phase-training");
  } else if (phase === "inference") {
    phaseTagEl.classList.add("phase-inference");
  } else if (phase === "done") {
    phaseTagEl.classList.add("phase-done");
  } else {
    phaseTagEl.classList.add("phase-waiting");
  }

  // Update action pill
  actionValueEl.textContent = action;
}

function setFormEnabled(enabled, message) {
  labelInput.disabled = !enabled;
  confidenceInput.disabled = !enabled;
  submitButton.disabled = !enabled;

  formMessageEl.textContent = message || "";
  formMessageEl.className = "message" + (enabled ? "" : " error");
}

// Handle form submit
voteForm.addEventListener("submit", (e) => {
  e.preventDefault();

  if (currentPhase !== "training" || currentAction <= 0) {
    formMessageEl.textContent =
      "You can only submit during the training phase when an action is active.";
    formMessageEl.className = "message error";
    return;
  }

  const label = labelInput.value.trim();
  const confidence = Number(confidenceInput.value);

  if (!label) {
    formMessageEl.textContent = "Please describe the action before submitting.";
    formMessageEl.className = "message error";
    return;
  }

  if (Number.isNaN(confidence) || confidence < 0 || confidence > 100) {
    formMessageEl.textContent = "Confidence must be a number between 0 and 100.";
    formMessageEl.className = "message error";
    return;
  }

  const voteRef = db
    .ref(`sessions/${sessionId}/votes/action_${currentAction}`)
    .push();

  const payload = {
    viewerId,
    phase: currentPhase,
    action: currentAction,
    label,
    confidence,
    createdAt: Date.now(),
  };

  voteRef
    .set(payload)
    .then(() => {
      formMessageEl.textContent =
        "Thank you. Your annotation has been recorded.";
      formMessageEl.className = "message ok";

      // Optionally clear the text field, keep confidence empty too
      labelInput.value = "";
      confidenceInput.value = "";
      labelInput.blur();
      confidenceInput.blur();
    })
    .catch((err) => {
      console.error("Error submitting vote:", err);
      formMessageEl.textContent =
        "Submission failed. Please try again in a moment.";
      formMessageEl.className = "message error";
    });
});
