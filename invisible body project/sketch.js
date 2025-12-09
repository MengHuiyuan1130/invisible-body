let video;
let poseNet;
let poses = [];

// 会话 ID（从 firebase-config.js 里拿）
let sessionId = window.SESSION_ID || "session-001";

// phase: "waiting" | "training" | "transition" | "inference" | "done"
let phase = "waiting";
let currentAction = 0; // 0=无动作, 1–4 对应四个动作

// 计时控制
let performanceStarted = false;
let trainingStartTime = 0;
let inferenceStartTime = 0;

const segmentDuration = 30000;  // 每个动作 30 秒
const numActions = 4;           // 4 个动作

let lastStateSent = "";

// 主标签与统计
let actionLabels = {};       // { 1: "xxx", 2: "yyy", ... }
let actionLabelStats = {};   // { 1: [ {label, avg, count}, ...], 2: [...] }

// 平滑用的 pose
let smoothPose = null;

// 语音相关
let lastAnnouncedAction = 0;
let secondIntroPlayed = false;
let secondIntroFinished = false;

// ===== 配色：柔和、有情绪 =====
function getActionColor(action) {
  switch (action) {
    case 1:
      return color(147, 197, 253);   // soft blue
    case 2:
      return color(252, 165, 165);   // soft coral red
    case 3:
      return color(190, 242, 100);   // spring green
    case 4:
      return color(196, 181, 253);   // lavender
    default:
      return color(200, 200, 200);   // neutral grey
  }
}

function setup() {
  createCanvas(1280, 720);

  // 摄像头
  video = createCapture(VIDEO);
  video.size(width, height);
  video.hide();

  // PoseNet
  poseNet = ml5.poseNet(video, modelReady);
  poseNet.on("pose", (results) => {
    poses = results;
  });

  textFont("monospace");

  // 监听观众投票
  subscribeToVotes();
}

function modelReady() {
  console.log("PoseNet ready");
}

function draw() {
  background(0);

  // 时间与阶段更新 + 语音
  updatePhaseAndAction();

  // 骨架
  drawSkeleton();

  // 左上 UI
  drawUI();

  // 第二遍时显示观众标签
  drawAudienceLabelOverlay();

  // 同步状态到 Firebase
  syncStateIfChanged();
}

/* =======================
   计时 & 阶段逻辑 + 语音
   ======================= */

function updatePhaseAndAction() {
  if (!performanceStarted) {
    phase = "waiting";
    currentAction = 0;
    return;
  }

  if (phase === "training") {
    const elapsed = millis() - trainingStartTime;
    const segmentIndex = floor(elapsed / segmentDuration);

    if (segmentIndex >= numActions) {
      // 第一遍结束 → 进入过渡段
      phase = "transition";
      currentAction = 0;
      return;
    }

    const newAction = segmentIndex + 1;
    if (newAction !== currentAction) {
      currentAction = newAction;
      announceTrainingAction(currentAction);
    }

  } else if (phase === "transition") {
    currentAction = 0;

    if (!secondIntroPlayed) {
      playSecondPartIntro();
    }

    // 语音播完后再进入第二部分
    if (secondIntroFinished) {
      phase = "inference";
      inferenceStartTime = millis();
      lastAnnouncedAction = 0;
    }

  } else if (phase === "inference") {
    const elapsed = millis() - inferenceStartTime;
    const segmentIndex = floor(elapsed / segmentDuration);

    if (segmentIndex >= numActions) {
      phase = "done";
      currentAction = 0;
      return;
    }

    const newAction = segmentIndex + 1;
    if (newAction !== currentAction) {
      currentAction = newAction;
      announceInferenceAction(currentAction);
    }

  } else if (phase === "done") {
    currentAction = 0;
  }
}

// 简单封装：用浏览器的语音合成
function speak(text, onEnd) {
  if (!("speechSynthesis" in window)) {
    if (onEnd) onEnd();
    return;
  }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-GB";
  u.rate = 1.0;
  u.pitch = 1.0;
  if (onEnd) {
    u.onend = onEnd;
  }
  window.speechSynthesis.speak(u);
}

// 第一遍：只读 Action 编号
function announceTrainingAction(actionNum) {
  if (actionNum <= 0 || actionNum === lastAnnouncedAction) return;
  lastAnnouncedAction = actionNum;
  const text = `Action ${actionNum}`;
  speak(text);
}

// 第二遍：读 Action + 最高置信度的 label
function announceInferenceAction(actionNum) {
  if (actionNum <= 0 || actionNum === lastAnnouncedAction) return;
  lastAnnouncedAction = actionNum;

  const stats = actionLabelStats[actionNum];
  const actionText = `Action ${actionNum}`;

  if (!stats || stats.length === 0) {
    // 没有观众数据就只读 action
    speak(actionText);
    return;
  }

  const main = stats[0];
  const conf = Math.round(main.avg || 0); // avg = average confidence
  // 把引号去掉，避免读出来很奇怪
  const labelSpoken = main.label.replace(/["“”']/g, " ");

  const labelText = `Top label: ${labelSpoken}. Confidence ${conf} percent.`;

  // 先读 “Action X”，读完再读 label & confidence
  speak(actionText, () => {
    speak(labelText);
  });
}

// 第二遍开始前提示语音
function playSecondPartIntro() {
  secondIntroPlayed = true;

  const text =
    "Now we enter the second part. You are free to turn around and watch the real body, or stay with the projected system that you have helped to train.";

  speak(text, () => {
    secondIntroFinished = true;
  });

  if (!("speechSynthesis" in window)) {
    secondIntroFinished = true;
  }
}

/* =======================
   骨架（带平滑）
   ======================= */

function updateSmoothPose(rawPose) {
  if (!smoothPose) {
    smoothPose = JSON.parse(JSON.stringify(rawPose));
    return;
  }

  for (let i = 0; i < rawPose.keypoints.length; i++) {
    const rk = rawPose.keypoints[i];
    const sk = smoothPose.keypoints[i];

    if (rk.score > 0.2) {
      sk.position.x = lerp(sk.position.x, rk.position.x, 0.4);
      sk.position.y = lerp(sk.position.y, rk.position.y, 0.4);
      sk.score = rk.score;
      sk.part = rk.part;
    }
  }
}

function drawSkeleton() {
  if (poses.length === 0) return;

  const rawPose = poses[0].pose;
  updateSmoothPose(rawPose);
  const pose = smoothPose || rawPose;

  const col = getActionColor(currentAction);

  const kp = (name) => pose.keypoints.find((k) => k.part === name);
  const has = (p) => p && p.score > 0.3;

  const nose      = kp("nose");
  const lEye      = kp("leftEye");
  const rEye      = kp("rightEye");
  const lEar      = kp("leftEar");
  const rEar      = kp("rightEar");
  const lShoulder = kp("leftShoulder");
  const rShoulder = kp("rightShoulder");
  const lHip      = kp("leftHip");
  const rHip      = kp("rightHip");
  const lElbow    = kp("leftElbow");
  const rElbow    = kp("rightElbow");
  const lWrist    = kp("leftWrist");
  const rWrist    = kp("rightWrist");
  const lKnee     = kp("leftKnee");
  const rKnee     = kp("rightKnee");
  const lAnkle    = kp("leftAnkle");
  const rAnkle    = kp("rightAnkle");

  push();
  stroke(col);
  strokeWeight(4);
  fill(col);

  // 头部
  let headX, headY;
  if (has(nose)) {
    headX = nose.position.x;
    headY = nose.position.y;
  } else if (has(lEye) && has(rEye)) {
    headX = (lEye.position.x + rEye.position.x) / 2;
    headY = (lEye.position.y + rEye.position.y) / 2;
  }

  if (headX !== undefined) {
    const headR = 18;
    noFill();
    stroke(col);
    circle(headX, headY, headR * 2);

    noStroke();
    fill(col);
    if (has(lEye)) circle(lEye.position.x, lEye.position.y, 4);
    if (has(rEye)) circle(rEye.position.x, rEye.position.y, 4);
    if (has(lEar)) circle(lEar.position.x, lEar.position.y, 3);
    if (has(rEar)) circle(rEar.position.x, rEar.position.y, 3);
  }

  // 躯干
  if (has(lShoulder) && has(rShoulder) && has(lHip) && has(rHip)) {
    const ls = lShoulder.position;
    const rs = rShoulder.position;
    const lh = lHip.position;
    const rh = rHip.position;

    stroke(col);
    strokeWeight(4);
    noFill();
    beginShape();
    vertex(ls.x, ls.y);
    vertex(rs.x, rs.y);
    vertex(rh.x, rh.y);
    vertex(lh.x, lh.y);
    endShape(CLOSE);

    const midShoulderX = (ls.x + rs.x) / 2;
    const midShoulderY = (ls.y + rs.y) / 2;
    const midHipX = (lh.x + rh.x) / 2;
    const midHipY = (lh.y + rh.y) / 2;
    line(midShoulderX, midShoulderY, midHipX, midHipY);

    if (headX !== undefined && headY !== undefined) {
      line(headX, headY + 18, midShoulderX, midShoulderY);
    }
  }

  const connect = (a, b) => {
    if (has(a) && has(b)) {
      const pa = a.position;
      const pb = b.position;
      stroke(col);
      strokeWeight(4);
      line(pa.x, pa.y, pb.x, pb.y);
    }
  };

  // 手臂
  connect(lShoulder, lElbow);
  connect(lElbow, lWrist);
  connect(rShoulder, rElbow);
  connect(rElbow, rWrist);

  // 腿
  connect(lHip, lKnee);
  connect(lKnee, lAnkle);
  connect(rHip, rKnee);
  connect(rKnee, rAnkle);

  // 关节点小圆
  const drawJoint = (p, r = 6) => {
    if (has(p)) {
      const pos = p.position;
      noStroke();
      fill(col);
      circle(pos.x, pos.y, r * 2);
    }
  };

  [
    lShoulder, rShoulder, lHip, rHip,
    lElbow, rElbow, lWrist, rWrist,
    lKnee, rKnee, lAnkle, rAnkle
  ].forEach((j) => drawJoint(j, 5));

  pop();
}

/* =======================
   UI
   ======================= */

function drawUI() {
  push();
  noStroke();

  fill(180);
  textSize(14);
  textAlign(LEFT, TOP);

  text(`Session : ${sessionId}`, 20, 20);
  text(`Phase   : ${phase}`, 20, 40);
  text(`Action  : ${currentAction}`, 20, 60);

  if (!performanceStarted) {
    fill(130);
    text(`Press [S] to begin · Press [F] to toggle fullscreen`, 20, 95);
  } else if (phase === "training") {
    const elapsed = millis() - trainingStartTime;
    const segmentIndex = floor(elapsed / segmentDuration);
    const segmentElapsed = elapsed - segmentIndex * segmentDuration;
    const remaining = max(0, segmentDuration - segmentElapsed);
    const remainingSec = (remaining / 1000).toFixed(1);

    fill(130);
    text(`Part 1 · training`, 20, 95);
    text(`Next action switch in: ${remainingSec}s`, 20, 115);
  } else if (phase === "transition") {
    fill(130);
    text(`Transition to part 2`, 20, 95);
    text(`Listening to the system message…`, 20, 115);
  } else if (phase === "inference") {
    const elapsed = millis() - inferenceStartTime;
    const segmentIndex = floor(elapsed / segmentDuration);
    const segmentElapsed = elapsed - segmentIndex * segmentDuration;
    const remaining = max(0, segmentDuration - segmentElapsed);
    const remainingSec = (remaining / 1000).toFixed(1);

    fill(130);
    text(`Part 2 · inference`, 20, 95);
    text(`Next action switch in: ${remainingSec}s`, 20, 115);
  } else if (phase === "done") {
    fill(130);
    text(`Performance finished.`, 20, 95);
  }

  pop();
}

/* =======================
   显示观众生成的标签
   ======================= */

function drawAudienceLabelOverlay() {
  if (phase !== "inference" || currentAction <= 0) return;

  const stats = actionLabelStats[currentAction] || [];

  // 主标签（底部居中）
  push();
  textAlign(CENTER, CENTER);

  if (stats.length > 0) {
    const main = stats[0];
    const txt = `“${main.label}”     confidence ${main.avg.toFixed(0)}%    n=${main.count}`;

    textSize(26);
    const padding = 16;
    const w = textWidth(txt) + padding * 2;
    const h = 46;

    fill(0, 0, 0, 190);
    rect(width / 2 - w / 2, height - 100, w, h, 14);

    fill(255);
    text(txt, width / 2, height - 100 + h / 2);
  } else {
    textSize(20);
    fill(180);
    text(
      `(no audience labels yet for action ${currentAction})`,
      width / 2,
      height - 70
    );
  }
  pop();

  // 右侧标签云（除主标签外的其他语义）
  const list = stats.slice(1);
  if (list.length === 0) return;

  push();
  const panelX = width - 320;
  let y = 80;
  const panelW = 300;

  fill(0, 0, 0, 140);
  noStroke();
  rect(panelX - 10, 50, panelW, height - 120, 18);

  fill(220);
  textAlign(LEFT, TOP);
  textSize(14);
  text(`Other audience labels for action ${currentAction}:`, panelX, 60);

  y = 90;

  for (let i = 0; i < list.length; i++) {
    const item = list[i];

    const brightness = map(item.avg, 0, 100, 130, 255);
    const bgAlpha = map(item.avg, 0, 100, 70, 170);

    const txt = `“${item.label}”`;
    const meta = `confidence ${item.avg.toFixed(0)}%   n=${item.count}`;
    const cardH = 44;
    const cardW = panelW - 20;

    fill(0, 0, 0, bgAlpha);
    rect(panelX, y, cardW, cardH, 10);

    textSize(15);
    fill(brightness);
    textAlign(LEFT, TOP);
    text(txt, panelX + 10, y + 6);

    textSize(12);
    fill(180);
    text(meta, panelX + 10, y + 24);

    y += cardH + 10;
    if (y > height - 70) break;
  }

  pop();
}

/* =======================
   Firebase 同步 & 监听
   ======================= */

function syncStateIfChanged() {
  const stateObj = { phase, currentAction, sessionId };
  const state = JSON.stringify(stateObj);
  if (state === lastStateSent) return;

  lastStateSent = state;

  const ref = db.ref(`sessions/${sessionId}/state`);
  ref.set({
    ...stateObj,
    updatedAt: Date.now(),
  });
}

function subscribeToVotes() {
  const votesRef = db.ref(`sessions/${sessionId}/votes`);

  votesRef.on(
    "value",
    (snapshot) => {
      const votesByAction = snapshot.val() || {};
      const newActionLabels = {};
      const newActionStats = {};

      Object.keys(votesByAction).forEach((actionKey) => {
        const match = actionKey.match(/^action_(\d+)$/);
        if (!match) return;
        const actionNum = parseInt(match[1], 10);
        const votesObj = votesByAction[actionKey];
        if (!votesObj) return;

        const stats = {}; // label -> {sum, count}

        Object.values(votesObj).forEach((vote) => {
          if (!vote || !vote.label) return;
          const rawLabel = String(vote.label).trim();
          if (!rawLabel) return;

          const key = rawLabel;
          const conf = Number(vote.confidence);
          const confidence = Number.isNaN(conf) ? 0 : conf;

          if (!stats[key]) {
            stats[key] = { sum: 0, count: 0 };
          }
          stats[key].sum += confidence;
          stats[key].count += 1;
        });

        const arr = Object.keys(stats).map((labelText) => {
          const s = stats[labelText];
          return {
            label: labelText,
            avg: s.sum / s.count, // avg = average confidence
            count: s.count,
          };
        });

        arr.sort((a, b) => b.avg - a.avg);

        if (arr.length > 0) {
          newActionLabels[actionNum] = arr[0].label;
          newActionStats[actionNum] = arr;
        }
      });

      actionLabels = newActionLabels;
      actionLabelStats = newActionStats;

      console.log("Updated actionLabelStats:", actionLabelStats);
    },
    (err) => {
      console.error("Error listening to votes:", err);
    }
  );
}

/* =======================
   键盘控制
   ======================= */

function keyPressed() {
  if (key === "S" || key === "s") {
    performanceStarted = true;
    phase = "training";
    trainingStartTime = millis();
    lastAnnouncedAction = 0;
    secondIntroPlayed = false;
    secondIntroFinished = false;
    console.log("Performance started (training part)");
  }

  if (key === "F" || key === "f") {
    const fs = fullscreen();
    fullscreen(!fs);
  }
}
