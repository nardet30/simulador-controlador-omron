/**
 * OMRON E5CC Temperature Controller Simulator
 * Advanced Implementation for Industrial Instrumentation
 * 
 * Technical Reference (Manual E5CC-CX):
 * - [in-t]: Input Type (5: K Thermocouple, 6: K Thermocouple Decimal)
 * - [cntl]: Control Method (pid: 2-PID, onof: ON/OFF)
 * - [orev]: Direct/Reverse Action (not implemented, defaults to Reverse/Heating)
 * - [At]: Autotuning (at-2: 100% Tuning)
 * - [oAPt]: Operation/Adjustment Protection
 * 
 * Levels:
 * - Operation (Default): PV and SV
 * - Adjustment (Level pulse < 1s): PID and HYS params
 * - Initial Setting (Level hold 3s): Setup (Stops Control)
 * - Protection (Level + Mode hold 3s): Security Locks
 */

class E5CCSimulator {
  constructor() {
    // --- Process State ---
    this.pv = 22.5;
    this.sv = 100.0;
    this.mv = 0.0;       // Output 0.0 - 100.0%

    // --- Control Parameters ---
    this.params = {
      at: "off",
      p: 8.0,
      i: 240,
      d: 40,
      hys: 1.0,
      "in-t": 5,
      cntl: "pid",
      alt1: 2,
      oapt: 0,
    };

    // --- Physics Engine ---
    this.ambientTemp = 25.0;
    this.thermalInertia = 0.15;
    this.coolingRate = 0.025;
    this.sensorConnected = true;
    this.lastUpdateTime = Date.now();
    this.integralSum = 0;
    this.lastPv = 22.5;

    // --- UI & Menu State ---
    this.currentLevel = "operation";
    this.menuIndex = 0;
    this.levels = {
      operation: ["pv_sv"],
      adjustment: ["at", "p", "i", "d", "hys"],
      initial: ["in-t", "cntl", "alt1"],
      protection: ["oapt"]
    };

    this.displayLabels = {
      "at": "At", "p": "P", "i": "I", "d": "d", "hys": "HyS",
      "in-t": "in-t", "cntl": "CntL", "alt1": "ALt1", "oapt": "oAPt"
    };

    this.stopControl = false;
    this.atActive = false;
    this.atStartTime = 0;

    this.buttonTimers = {};
    this.activeButtons = new Set();

    // --- Audio Sensor Logic ---
    this.micActive = false;
    this.micVolume = 0;
    this.micGain = 1.0;
    this.audioContext = null;
    this.analyser = null;
    this.dataArray = null;

    this.init();
  }

  init() {
    console.log("%c OMRON E5CC SIMULATOR - BOOTING ", "background: #222; color: #fff; font-weight: bold;");
    this.bindDOM();
    this.startLoops();
  }

  bindDOM() {
    // Displays
    this.pvDisplay = document.getElementById('pv-value');
    this.svDisplay = document.getElementById('sv-value');
    this.mvFill = document.getElementById('mv-fill');
    this.mvText = document.getElementById('mv-percent');

    // Indicators
    this.leds = {
      out1: document.getElementById('ind-out1'),
      tune: document.getElementById('ind-tune'),
      stop: document.getElementById('ind-stop'),
      lock: document.getElementById('ind-lock')
    };

    // Buttons
    const btns = ['level', 'mode', 'shift', 'down', 'up'];
    btns.forEach(b => {
      const el = document.getElementById(`btn-${b}`);
      el.addEventListener('mousedown', (e) => this.handleBtnDown(b, e));
      el.addEventListener('mouseup', (e) => this.handleBtnUp(b, e));
      el.addEventListener('mouseleave', (e) => this.handleBtnUp(b, e));
      // Touch support
      el.addEventListener('touchstart', (e) => { e.preventDefault(); this.handleBtnDown(b, e); });
      el.addEventListener('touchend', (e) => { e.preventDefault(); this.handleBtnUp(b, e); });
    });

    // External Dashboard
    document.getElementById('input-ambient').addEventListener('input', (e) => {
      this.ambientTemp = parseFloat(e.target.value);
      document.getElementById('ambient-val').innerText = e.target.value;
    });
    document.getElementById('input-load').addEventListener('input', (e) => {
      this.coolingRate = 0.02 * parseFloat(e.target.value);
      document.getElementById('load-val').innerText = e.target.value;
    });
    document.getElementById('btn-toggle-sensor').addEventListener('click', (e) => {
      this.sensorConnected = !this.sensorConnected;
      e.target.innerText = this.sensorConnected ? "Sensor Conectado" : "Error de Sensor";
      e.target.className = `toggle-btn ${this.sensorConnected ? 'ok' : 'err'}`;
    });

    // Audio Controls
    document.getElementById('btn-activate-mic').addEventListener('click', (e) => this.toggleMic(e.target));
    document.getElementById('input-mic-gain').addEventListener('input', (e) => {
      this.micGain = parseFloat(e.target.value) / 100.0;
    });

    // Manual Modal Controls
    const modal = document.getElementById('manual-modal');
    document.getElementById('btn-open-manual').addEventListener('click', () => {
      modal.style.display = 'flex';
    });
    document.getElementById('btn-close-manual').addEventListener('click', () => {
      modal.style.display = 'none';
    });
    window.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });

    this.initChart();
  }

  async toggleMic(btn) {
    if (!this.micActive) {
      const success = await this.initAudio();
      if (success) {
        this.micActive = true;
        btn.innerText = "Micrófono Activo";
        btn.style.background = "#34c759";
      } else {
        btn.innerText = "Error (Sin Permiso)";
        btn.style.background = "#ff3b30";
      }
    } else {
      this.micActive = false;
      btn.innerText = "Activar Micrófono como Sensor";
      btn.style.background = "var(--accent)";
    }
  }

  async initAudio() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      return true;
    } catch (err) {
      console.error("Mic access denied:", err);
      return false;
    }
  }

  startLoops() {
    // Physics Loop (High frequency)
    setInterval(() => this.updatePhysics(), 100);
    // Control Loop (Typical E5CC sampling time: 50ms to 250ms, we use 500ms for stable simulation)
    setInterval(() => this.runControl(), 500);
    // Render Loop
    requestAnimationFrame(this.render.bind(this));
  }

  updatePhysics() {
    const now = Date.now();
    const dt = (now - this.lastUpdateTime) / 1000;
    this.lastUpdateTime = now;

    if (this.sensorConnected) {
      // 1. Audio Processing
      if (this.micActive && this.analyser) {
        this.analyser.getByteFrequencyData(this.dataArray);
        let sum = 0;
        for (let i = 0; i < this.dataArray.length; i++) sum += this.dataArray[i];
        const rawVol = sum / (this.dataArray.length * 255);
        this.micVolume = (this.micVolume * 0.7) + (rawVol * 0.3);
      } else {
        this.micVolume = 0;
      }

      // 2. Heat Inputs
      const soundPower = 80.0 * this.micGain; // Microphone can add significant heat
      const heaterPower = 15.0; // Standard process gain
      const heatGain = (this.micVolume * soundPower) + (this.mv / 100.0 * heaterPower);

      // 3. Realistic Thermal Exchange
      // PV trends towards ambient temperature naturally
      const deltaTemp = this.pv - this.ambientTemp;
      const naturalLoss = deltaTemp * this.coolingRate;

      this.pv += (heatGain * dt) - (naturalLoss * dt);

      // 4. Fine Noise
      this.pv += (Math.random() - 0.5) * 0.02;

      // Limits
      if (this.pv > 1300) this.pv = 1300;
      if (this.pv < -200) this.pv = -200;
    }
  }

  runControl() {
    if (!this.sensorConnected || this.stopControl) {
      this.mv = 0;
      this.integralSum = 0;
      return;
    }

    if (this.atActive) {
      this.runAutotune();
      return;
    }

    if (this.params.cntl === "pid") {
      this.runPID();
    } else {
      this.runOnOff();
    }
  }

  runOnOff() {
    const diff = this.pv - this.sv;
    if (diff < -this.params.hys) this.mv = 100;
    else if (diff > 0) this.mv = 0;
  }

  runPID() {
    // Proportional Band
    const pb = this.params.p;
    const ti = this.params.i;
    const td = this.params.d;

    const error = this.sv - this.pv;

    // Proportional Band (E5CC uses % of range, here we simplify to gain)
    // Gain = 100 / Pb
    const pTerm = (100.0 / pb) * error;

    // Integral with threshold (Deadband logic)
    if (Math.abs(error) > 0.1) {
      // Integration: error / Ti
      this.integralSum += (error / ti);
    }

    // Dynamic Integral Limit (Anti-windup)
    const iLimit = 100;
    this.integralSum = Math.max(-iLimit, Math.min(iLimit, this.integralSum));

    // Reset when crossing setpoint (Prevent over-correction)
    if ((this.lastPv < this.sv && this.pv >= this.sv) || (this.lastPv > this.sv && this.pv <= this.sv)) {
      this.integralSum *= 0.5;
    }

    const iTerm = this.integralSum;

    // Derivative: Td * rate of change
    const dTerm = (100.0 / pb) * td * (this.lastPv - this.pv) / 0.5;

    let output = pTerm + iTerm + dTerm;

    // Final MV calculation
    this.mv = Math.max(0, Math.min(100, output));
    this.lastPv = this.pv;
  }

  runAutotune() {
    // Relay feedback method for AT-2
    if (this.pv < this.sv) {
      this.mv = 100;
    } else {
      this.mv = 0;
    }

    // Simulate tuning convergence (Relay oscillations)
    if (Date.now() - this.atStartTime > 20000) {
      this.finishAT();
    }
  }

  finishAT() {
    console.log("AT-2 Complete. Calculating PID constants...");
    this.atActive = false;
    this.params.at = "off";
    // Calculated values based on process observation
    this.params.p = 5.5;  // Slightly more aggressive
    this.params.i = 180;
    this.params.d = 45;
  }

  // --- Interaction Mechanics ---
  handleBtnDown(btn, e) {
    if (this.activeButtons.has(btn)) return;
    this.activeButtons.add(btn);

    const timestamp = Date.now();
    this.buttonTimers[btn] = { start: timestamp, handled: false };

    // Visual feedback
    document.getElementById(`btn-${btn}`).classList.add('active');
  }

  handleBtnUp(btn, e) {
    if (!this.activeButtons.has(btn)) return;
    this.activeButtons.delete(btn);

    const duration = Date.now() - this.buttonTimers[btn].start;
    const wasHandled = this.buttonTimers[btn].handled;
    delete this.buttonTimers[btn];

    document.getElementById(`btn-${btn}`).classList.remove('active');

    if (wasHandled) return;

    // Simultaneous button release handling or short press
    if (duration < 1000) {
      switch (btn) {
        case 'level': this.navigateLevel(); break;
        case 'mode': this.navigateMenu(); break;
        case 'up': this.adjustValue(1); break;
        case 'down': this.adjustValue(-1); break;
      }
    }
  }

  checkLongPresses() {
    const now = Date.now();
    const levelTimer = this.buttonTimers['level'];
    const modeTimer = this.buttonTimers['mode'];

    // Level + Mode (3s) -> Protection
    if (levelTimer && modeTimer && !levelTimer.handled && !modeTimer.handled) {
      const jointTime = Math.min(now - levelTimer.start, now - modeTimer.start);
      if (jointTime > 3000) {
        this.switchToLevel("protection");
        levelTimer.handled = true;
        modeTimer.handled = true;
      }
      return;
    }

    // Level (3s) -> Initial Setting
    if (levelTimer && !levelTimer.handled && !modeTimer) {
      if (now - levelTimer.start > 3000) {
        this.switchToLevel("initial");
        levelTimer.handled = true;
      }
    }
  }

  navigateLevel() {
    // Operation <-> Adjustment (toggle < 1s)
    if (this.currentLevel === "operation") this.switchToLevel("adjustment");
    else if (this.currentLevel === "adjustment") this.switchToLevel("operation");
    else this.switchToLevel("operation"); // Return from deep menu
  }

  switchToLevel(level) {
    if (this.currentLevel === level) return;
    this.currentLevel = level;
    this.menuIndex = 0;

    // Manual: Control stops in Initial Setting Level
    this.stopControl = (level === "initial");
    console.log(`Entering ${level.toUpperCase()} level.`);
  }

  navigateMenu() {
    this.menuIndex = (this.menuIndex + 1) % this.levels[this.currentLevel].length;
  }

  adjustValue(dir) {
    // Apply Protection Lock
    if (this.params.oapt === 3 && this.currentLevel !== "protection") return;

    const pName = this.levels[this.currentLevel][this.menuIndex];

    if (pName === "pv_sv") {
      this.sv += dir;
      // Limit SV based on Sensor Range
      this.sv = Math.max(-200, Math.min(1300, this.sv));
    } else {
      // Update Parameters
      switch (pName) {
        case 'at':
          this.atActive = (dir > 0);
          this.params.at = this.atActive ? "at-2" : "off";
          if (this.atActive) this.atStartTime = Date.now();
          break;
        case 'cntl':
          this.params.cntl = dir > 0 ? "pid" : "onof";
          break;
        case 'oapt':
          this.params.oapt = Math.min(3, Math.max(0, this.params.oapt + dir));
          break;
        case 'in-t':
          this.params["in-t"] = dir > 0 ? 6 : 5;
          break;
        default:
          const step = (pName === 'p' || pName === 'hys') ? 0.1 : 1;
          this.params[pName] = parseFloat((this.params[pName] + dir * step).toFixed(1));
          if (this.params[pName] < 0.1) this.params[pName] = 0.1;
      }
    }
  }

  // --- Rendering Module ---
  render() {
    this.checkLongPresses();

    if (!this.sensorConnected) {
      this.pvDisplay.innerText = "S.Err";
      this.pvDisplay.classList.add("blink");
      this.svDisplay.innerText = "----";
    } else if (this.pv > 1300 || this.pv < -200) {
      this.pvDisplay.innerText = "oooo";
      this.pvDisplay.classList.add("blink");
    } else {
      this.pvDisplay.classList.remove("blink");
      const pName = this.levels[this.currentLevel][this.menuIndex];

      if (this.currentLevel === "operation" && pName === "pv_sv") {
        this.pvDisplay.innerText = this.pv.toFixed(1).replace(".", "").padStart(4, " ").slice(-4);
        this.svDisplay.innerText = this.sv.toFixed(1).replace(".", "").padStart(4, " ").slice(-4);
      } else {
        this.pvDisplay.innerText = this.displayLabels[pName] || pName.toUpperCase();
        this.svDisplay.innerText = this.formatParamValue(pName);
      }
    }

    // Physical Indicators
    this.leds.out1.classList.toggle('active', this.mv > 0);
    this.leds.tune.classList.toggle('active', this.atActive);
    this.leds.stop.classList.toggle('active', this.stopControl);
    this.leds.lock.classList.toggle('active', this.params.oapt !== 0);

    // Sub indicators
    const sub1 = document.getElementById('ind-sub1');
    if (sub1) sub1.classList.toggle('active', this.pv > this.sv + 5); // Example alarm logic

    // Dashboard sync
    this.mvFill.style.width = `${this.mv}%`;
    this.mvText.innerText = Math.round(this.mv);

    this.updateChart();
    requestAnimationFrame(this.render.bind(this));
  }

  formatParamValue(p) {
    const val = this.params[p];
    if (p === 'at' || p === 'cntl') return val.toUpperCase();
    if (typeof val === 'number') {
      // Formato para parámetros decimales como P o HyS
      if (p === 'p' || p === 'hys') return val.toFixed(1).replace(".", "").padStart(4, " ").slice(-4);
      return val.toString().padStart(4, " ").slice(-4);
    }
    return val.toString().toUpperCase();
  }

  // --- Visualization ---
  initChart() {
    this.chartData = { pv: [], sv: [], mv: [] };
  }

  updateChart() {
    const canvas = document.getElementById('process-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.offsetWidth;
    const h = canvas.height = canvas.offsetHeight;

    this.chartData.pv.push(this.pv);
    this.chartData.sv.push(this.sv);
    this.chartData.mv.push(this.mv);

    if (this.chartData.pv.length > 250) {
      this.chartData.pv.shift();
      this.chartData.sv.shift();
      this.chartData.mv.shift();
    }

    ctx.clearRect(0, 0, w, h);

    // Draw Grid
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 4; i++) {
      const y = h - (i * h / 4);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Dynamic scale based on SV but with a minimum of 200
    const maxVal = Math.max(200, this.sv * 1.5, ...this.chartData.pv);

    // SV Line
    this.drawCurve(ctx, this.chartData.sv, '#1ed760', 1.5, false, maxVal);
    // PV Line
    this.drawCurve(ctx, this.chartData.pv, '#fff', 3, false, maxVal);
    // MV Area
    this.drawCurve(ctx, this.chartData.mv, 'rgba(0, 122, 255, 0.3)', 1, true, 100);
  }

  drawCurve(ctx, data, color, width, isMvArea = false, scaleY = 200) {
    const h = ctx.canvas.height;
    const w = ctx.canvas.width;
    const step = w / 250;

    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();

    data.forEach((val, i) => {
      const y = h - (val / scaleY * h);
      if (i === 0) ctx.moveTo(i * step, y);
      else ctx.lineTo(i * step, y);
    });

    if (isMvArea) {
      ctx.lineTo((data.length - 1) * step, h);
      ctx.lineTo(0, h);
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.stroke();
    }
  }
}

window.addEventListener('load', () => {
  new E5CCSimulator();
});
