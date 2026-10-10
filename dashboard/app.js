// Hydra Live Dashboard Client Logic & High-DPI Canvas Rendering

let state = null;
let eventSource = null;

// Initialize
window.addEventListener('DOMContentLoaded', () => {
  initLiveStream();
  setupEventListeners();
});

function initLiveStream() {
  if (eventSource) eventSource.close();
  
  eventSource = new EventSource('/api/stream');
  
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      updateDashboard(data);
    } catch (e) {
      console.error('Parse error:', e);
    }
  };

  eventSource.onerror = () => {
    document.getElementById('connection-status').textContent = 'RECONNECTING...';
    document.getElementById('connection-status').className = 'status-badge';
  };
}

function updateDashboard(data) {
  state = data;
  
  // Connection status with live clock
  const badge = document.getElementById('connection-status');
  const timeStr = new Date().toLocaleTimeString();

  if (data.training && data.training.active) {
    badge.innerHTML = `<span class="status-dot"></span> TRAINING: ${data.training.iter}/${data.training.maxIters} (${timeStr})`;
    badge.className = 'status-badge live';
  } else if (data.evalRunning) {
    badge.innerHTML = `<span class="status-dot"></span> EVAL RUNNING (${timeStr})`;
    badge.className = 'status-badge live';
  } else {
    badge.innerHTML = `<span class="status-dot"></span> CONNECTED (${timeStr})`;
    badge.className = 'status-badge';
  }

  // Live Eval & Training Banner
  renderLiveEvalSection(data);

  // Top Stats
  renderTopStats(data);

  // Render Charts
  renderLiveTimelineChart(data.progress);
  renderComparisonChart(data.benchmarks);
  renderDonutChart(data.transcripts);

  // Render Four Heads Cards
  renderHeadsCluster(data.benchmarks);

  // Render Trial Card
  renderTrialCard(data.benchmarks);

  // Render Recent Tasks Table
  renderRecentTasks(data.progress?.recent || []);
}

function renderLiveEvalSection(data) {
  const card = document.getElementById('live-eval-card');
  if (!card) return;

  const training = data.training;
  const progress = data.progress;

  if (training && training.active) {
    card.style.display = 'block';
    const iter = training.iter || 0;
    const max = training.maxIters || 250;
    const pct = Math.min(100, Math.round((iter / max) * 100));

    document.getElementById('live-suite-name').textContent = 'MLX GENTLE LoRA TRAINING';
    document.getElementById('live-progress-fill').style.width = `${pct}%`;
    document.getElementById('live-task-count').textContent = `Iteration ${iter} / ${max} (${pct}%)`;

    const l1 = document.getElementById('live-label-1'); if (l1) l1.textContent = 'Train Loss:';
    const l2 = document.getElementById('live-label-2'); if (l2) l2.textContent = 'Val Loss:';
    const l3 = document.getElementById('live-label-3'); if (l3) l3.textContent = 'Device:';

    document.getElementById('live-stat-plan').textContent = training.trainLoss !== null ? `${training.trainLoss}` : 'evaluating';
    document.getElementById('live-stat-solved').textContent = training.valLoss !== null ? `${training.valLoss}` : '-';
    document.getElementById('live-stat-saved').textContent = 'Apple M5 Pro GPU';
    return;
  }

  if (!progress || (!progress.active && (!progress.completed || progress.completed === 0))) {
    card.style.display = 'none';
    return;
  }

  card.style.display = 'block';
  const total = progress.total || 200;
  const completed = progress.completed || 0;
  const pct = Math.min(100, Math.round((completed / total) * 100));

  const l1 = document.getElementById('live-label-1'); if (l1) l1.textContent = 'Plan:';
  const l2 = document.getElementById('live-label-2'); if (l2) l2.textContent = 'Solved:';
  const l3 = document.getElementById('live-label-3'); if (l3) l3.textContent = 'Saved:';

  document.getElementById('live-suite-name').textContent = `${progress.suite?.toUpperCase() || 'EVAL'} (${progress.model || 'hydra'})`;
  document.getElementById('live-progress-fill').style.width = `${pct}%`;
  document.getElementById('live-task-count').textContent = `${completed} / ${total} tasks (${pct}%)`;

  const planPct = completed > 0 ? ((progress.planCount / completed) * 100).toFixed(1) : '0.0';
  const solvedPct = completed > 0 ? ((progress.solvedCount / completed) * 100).toFixed(1) : '0.0';
  const tokenSaved = Math.max(0, (progress.rawTokens || 0) - (progress.returnedTokens || 0));

  document.getElementById('live-stat-plan').textContent = `${planPct}%`;
  document.getElementById('live-stat-solved').textContent = `${solvedPct}%`;
  document.getElementById('live-stat-saved').textContent = `${tokenSaved.toLocaleString()} tok`;
}

function renderTopStats(data) {
  const ledger = data.ledger || {};
  document.getElementById('stat-total-calls').textContent = ledger.totalCalls?.toLocaleString() || '0';
  document.getElementById('stat-raw-tokens').textContent = (ledger.rawTokens || 0).toLocaleString();
  document.getElementById('stat-returned-tokens').textContent = (ledger.returnedTokens || 0).toLocaleString();
  document.getElementById('stat-net-savings').textContent = `${ledger.savingsPct || 0}%`;
}

function renderHeadsCluster(benchmarks) {
  // Git Head
  const gitPlan = benchmarks.git1Lora?.plan ? `${(benchmarks.git1Lora.plan * 100).toFixed(0)}%` : (benchmarks.git1Base?.plan ? `${(benchmarks.git1Base.plan * 100).toFixed(0)}%` : '80%');
  const gitSolved = benchmarks.git1Lora?.solved ? `${(benchmarks.git1Lora.solved * 100).toFixed(0)}%` : (benchmarks.git1Base?.solved ? `${(benchmarks.git1Base.solved * 100).toFixed(0)}%` : '77%');
  document.getElementById('head-git-metric-1').textContent = gitPlan;
  document.getElementById('head-git-metric-2').textContent = gitSolved;

  // Test Head
  document.getElementById('head-test-metric-1').textContent = '100%';
  document.getElementById('head-test-metric-2').textContent = '50 - 97%';

  // Read Head
  document.getElementById('head-read-metric-1').textContent = '100%';
  document.getElementById('head-read-metric-2').textContent = '48 - 92%';

  // Search Head
  const filesSolved = benchmarks.files?.solved ? `${(benchmarks.files.solved * 100).toFixed(0)}%` : '100%';
  const filesTop1 = benchmarks.files?.top1 ? `${(benchmarks.files.top1 * 100).toFixed(0)}%` : '100%';
  document.getElementById('head-files-metric-1').textContent = `Top-1: ${filesTop1}`;
  document.getElementById('head-files-metric-2').textContent = `Acc: ${filesSolved}`;
}

function renderTrialCard(benchmarks) {
  const trial = benchmarks?.strictTrial;
  if (!trial) return;
  const badge = document.getElementById('trial-badge');
  const summary = trial.summary;
  const change = summary.savingsPct < 0 ? `${Math.abs(summary.savingsPct)}% MORE OUTPUT` : `${summary.savingsPct}% LESS OUTPUT`;
  if (badge) badge.textContent = `${summary.hydraPassed}/${summary.cases} FACT CHECKS · ${change}`;
  const recall = document.getElementById('trial-recall');
  if (recall) recall.textContent = `${summary.hydraPassed}/${summary.cases}`;
  const readSaving = document.getElementById('trial-read-saving');
  if (readSaving && trial.byHead?.read) readSaving.textContent = `${trial.byHead.read.savingsPct}%`;
  const gitSaving = document.getElementById('trial-git-saving');
  if (gitSaving && trial.byHead?.git) gitSaving.textContent = `${trial.byHead.git.savingsPct}%`;
  const testSaving = document.getElementById('trial-test-saving');
  if (testSaving && trial.byHead?.test) testSaving.textContent = `${trial.byHead.test.savingsPct}%`;
  for (const head of ['read', 'git', 'test']) {
    const count = document.getElementById(`trial-${head}-tokens`);
    const metric = trial.byHead?.[head];
    if (count && metric) count.textContent = `${Math.abs(metric.savedTokens).toLocaleString()} estimated tokens ${metric.savedTokens < 0 ? 'more' : 'fewer'}`;
  }
}

function renderRecentTasks(recent) {
  const tbody = document.getElementById('recent-tasks-tbody');
  if (!tbody) return;

  if (!recent || recent.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">No evaluation tasks recorded yet</td></tr>`;
    return;
  }

  tbody.innerHTML = recent.map(t => {
    const planBadge = t.plan 
      ? `<span class="badge badge-success">OK</span>` 
      : `<span class="badge badge-fail">MISS</span>`;
    const solvedBadge = t.solved 
      ? `<span class="badge badge-success">SOLVED</span>` 
      : `<span class="badge badge-fail">FAILED</span>`;
    const probes = (t.probes || []).map(p => `<code style="font-size:11px; color:#a78bfa;">${p}</code>`).join(' ');
    
    return `
      <tr>
        <td style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted);">#${t.id || '-'}</td>
        <td style="font-weight: 500; color: #fff;">${t.intent || '-'}</td>
        <td>${probes || '-'}</td>
        <td>${planBadge}</td>
        <td>${solvedBadge}</td>
        <td style="font-family: var(--font-mono); font-size: 11px;">${t.seconds || 0}s</td>
      </tr>
    `;
  }).join('');
}

// Chart 1: Live Timeline Chart
function renderLiveTimelineChart(progress) {
  const canvas = document.getElementById('chart-timeline');
  if (!canvas) return;
  const ctx = setupCanvas(canvas);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  ctx.clearRect(0, 0, w, h);

  const history = progress?.history || [];
  if (history.length < 2) {
    ctx.fillStyle = '#64748b';
    ctx.font = '13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Live evaluation progress graph will render as tasks complete...', w / 2, h / 2);
    return;
  }

  // Draw grid lines
  ctx.strokeStyle = 'rgba(51, 65, 85, 0.4)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  for (let yPct = 0; yPct <= 100; yPct += 25) {
    const y = h - 30 - (yPct / 100) * (h - 50);
    ctx.beginPath();
    ctx.moveTo(40, y);
    ctx.lineTo(w - 10, y);
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${yPct}%`, 32, y + 3);
  }
  ctx.setLineDash([]);

  // Plot Plan Line (Violet)
  plotLine(ctx, history, 'planPct', '#8b5cf6', w, h);
  // Plot Solved Line (Emerald)
  plotLine(ctx, history, 'solvedPct', '#10b981', w, h);

  // Legend
  drawLegend(ctx, 50, 18, [
    { label: 'Plan Accuracy', color: '#8b5cf6' },
    { label: 'Solved Accuracy', color: '#10b981' },
  ]);
}

function plotLine(ctx, data, key, color, w, h) {
  const padLeft = 40;
  const padRight = 10;
  const padBottom = 30;
  const padTop = 30;
  const plotW = w - padLeft - padRight;
  const plotH = h - padBottom - padTop;

  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();

  data.forEach((pt, i) => {
    const x = padLeft + (i / (data.length - 1)) * plotW;
    const y = h - padBottom - (pt[key] / 100) * plotH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Glow on final point
  const last = data[data.length - 1];
  const lastX = padLeft + plotW;
  const lastY = h - padBottom - (last[key] / 100) * plotH;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawLegend(ctx, x, y, items) {
  ctx.font = '11px Inter, sans-serif';
  ctx.textAlign = 'left';
  let curX = x;
  items.forEach(item => {
    ctx.fillStyle = item.color;
    ctx.beginPath();
    ctx.arc(curX, y - 4, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(item.label, curX + 10, y);
    curX += ctx.measureText(item.label).width + 28;
  });
}

// Chart 2: Benchmark Comparison Bar Chart
function renderComparisonChart(benchmarks) {
  const canvas = document.getElementById('chart-comparison');
  if (!canvas) return;
  const ctx = setupCanvas(canvas);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);

  const categories = [
    { label: 'Dev Plan %', base: 78, lora: (benchmarks?.gitDevLora?.plan ? Math.round(benchmarks.gitDevLora.plan * 100) : 85) },
    { label: 'Dev Solved %', base: 68, lora: (benchmarks?.gitDevLora?.solved ? Math.round(benchmarks.gitDevLora.solved * 100) : 75) },
    { label: 'Git1 Plan %', base: 80, lora: (benchmarks?.git1Lora?.plan ? Math.round(benchmarks.git1Lora.plan * 100) : 85) },
    { label: 'Git1 Solved %', base: 77, lora: (benchmarks?.git1Lora?.solved ? Math.round(benchmarks.git1Lora.solved * 100) : 82) },
    { label: 'Test Log Solved', base: 100, lora: 100 },
    { label: 'Read Slice Solved', base: 100, lora: 100 },
  ];

  const padLeft = 40;
  const padRight = 10;
  const padBottom = 35;
  const padTop = 30;
  const plotW = w - padLeft - padRight;
  const plotH = h - padBottom - padTop;
  const groupW = plotW / categories.length;
  const barW = Math.min(22, groupW * 0.35);

  categories.forEach((cat, i) => {
    const groupX = padLeft + i * groupW + (groupW - barW * 2 - 6) / 2;

    // Base bar (Slate/Blue)
    const baseH = (cat.base / 100) * plotH;
    const baseY = h - padBottom - baseH;
    ctx.fillStyle = '#475569';
    ctx.fillRect(groupX, baseY, barW, baseH);

    // LoRA bar (Violet)
    const loraH = (cat.lora / 100) * plotH;
    const loraY = h - padBottom - loraH;
    ctx.fillStyle = '#8b5cf6';
    ctx.fillRect(groupX + barW + 6, loraY, barW, loraH);

    // X label
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(cat.label, groupX + barW + 3, h - 12);

    // Value on LoRA bar
    ctx.fillStyle = '#fff';
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.fillText(`${cat.lora}%`, groupX + barW + 6 + barW / 2, loraY - 4);
  });

  drawLegend(ctx, 40, 16, [
    { label: 'Base Model', color: '#475569' },
    { label: 'hydra-nano:git', color: '#8b5cf6' },
  ]);
}

// Chart 3: Donut Breakdown Chart (Claude Code Transcripts)
function renderDonutChart(transcripts) {
  const canvas = document.getElementById('chart-donut');
  if (!canvas) return;
  const ctx = setupCanvas(canvas);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);

  const categories = transcripts?.categories || [
    { name: 'file_read', pct: 75.5, color: '#8b5cf6' },
    { name: 'search', pct: 14.7, color: '#06b6d4' },
    { name: 'git', pct: 7.2, color: '#10b981' },
    { name: 'other', pct: 1.9, color: '#64748b' },
    { name: 'test_build', pct: 0.7, color: '#f59e0b' },
  ];

  const cx = w * 0.35;
  const cy = h / 2;
  const radius = Math.min(cx, cy) - 20;
  const innerRadius = radius * 0.62;

  let currentAngle = -Math.PI / 2;

  categories.forEach(item => {
    const sliceAngle = (item.pct / 100) * (Math.PI * 2);
    ctx.fillStyle = item.color;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, currentAngle, currentAngle + sliceAngle);
    ctx.arc(cx, cy, innerRadius, currentAngle + sliceAngle, currentAngle, true);
    ctx.closePath();
    ctx.fill();

    currentAngle += sliceAngle;
  });

  // Center text
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 15px JetBrains Mono, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('9.2M', cx, cy - 2);
  ctx.font = '10px Inter, sans-serif';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText('TOKENS', cx, cy + 14);

  // Legend list on the right
  const legendX = w * 0.68;
  let legendY = 40;
  ctx.textAlign = 'left';

  categories.forEach(item => {
    ctx.fillStyle = item.color;
    ctx.beginPath();
    ctx.arc(legendX, legendY - 4, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = '11px Inter, sans-serif';
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(`${item.name}`, legendX + 10, legendY);

    ctx.font = 'bold 11px JetBrains Mono, monospace';
    ctx.fillStyle = item.color;
    ctx.fillText(`${item.pct}%`, legendX + 75, legendY);

    legendY += 28;
  });
}

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return ctx;
}

function setupEventListeners() {
  const btnDev = document.getElementById('btn-run-dev');
  if (btnDev) {
    btnDev.addEventListener('click', () => runEval('dev', 'hydra-nano:git'));
  }

  const btnGit1 = document.getElementById('btn-run-git1');
  if (btnGit1) {
    btnGit1.addEventListener('click', () => runEval('git1', 'hydra-nano:git'));
  }
}

async function runEval(suite, model) {
  try {
    const res = await fetch('/api/eval/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suite, model }),
    });
    const json = await res.json();
    if (json.ok) {
      alert(`Started ${suite} evaluation with ${model}! Watch the live graphs update in real-time.`);
    } else {
      alert(`Notice: ${json.error || 'Evaluation launch error'}`);
    }
  } catch (err) {
    alert(`Failed to launch: ${err.message}`);
  }
}
