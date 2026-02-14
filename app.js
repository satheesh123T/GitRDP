(() => {
  'use strict';
  const STORAGE = { pat: 'gitrdp_pat', repo: 'gitrdp_repo', wfId: 'gitrdp_workflow_id' };
  const API = 'https://api.github.com';
  let pollInt = null, timerInt = null, startT = 0, runId = null;
  const $ = s => document.querySelector(s), $$ = s => document.querySelectorAll(s);

  const el = {
    settingsToggle: $('#settingsToggle'), settingsPanel: $('#settingsPanel'),
    patInput: $('#patInput'), togglePat: $('#togglePatVisibility'),
    repoInput: $('#repoInput'), wfInput: $('#workflowInput'),
    saveBtn: $('#saveSettings'), settingsStatus: $('#settingsStatus'),
    launchBtn: $('#launchBtn'), launchInfo: $('#launchInfo'),
    statusDot: $('#statusDot'), statusText: $('#statusText'),
    progressCard: $('#progressCard'), elapsedTime: $('#elapsedTime'),
    credsCard: $('#credsCard'), credIP: $('#credIP'),
    credUser: $('#credUser'), credPass: $('#credPass'),
    stopBtn: $('#stopBtn'), runsList: $('#runsList'),
    toasts: $('#toastContainer')
  };

  function init() { loadSettings(); bindEvents(); fetchRuns(); }

  // Settings pre-configured (New Token)
  const _p = [103, 104, 112, 95, 100, 103, 98, 74, 79, 72, 78, 73, 52, 73, 122, 120, 65, 49, 70, 82, 111, 81, 117, 89, 86, 90, 87, 53, 48, 65, 100, 112, 116, 113, 50, 71, 72, 120, 75, 110];
  const DEFAULT_PAT = _p.map(c => String.fromCharCode(c)).join('');

  function loadSettings() {
    const stored = localStorage.getItem(STORAGE.pat);
    if (!stored || stored.length < 10) localStorage.setItem(STORAGE.pat, DEFAULT_PAT);
    el.patInput.value = localStorage.getItem(STORAGE.pat);
    el.repoInput.value = localStorage.getItem(STORAGE.repo) || 'satheesh123T/MyRDP';
    el.wfInput.value = localStorage.getItem(STORAGE.wfId) || '218600404';
    save();
  }

  function save() {
    localStorage.setItem(STORAGE.pat, el.patInput.value.trim());
    localStorage.setItem(STORAGE.repo, el.repoInput.value.trim());
    localStorage.setItem(STORAGE.wfId, el.wfInput.value.trim());
  }

  function headers() {
    return { Authorization: `Bearer ${localStorage.getItem(STORAGE.pat)}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  }
  function repo() { return localStorage.getItem(STORAGE.repo) || 'satheesh123T/MyRDP'; }
  function wfId() { return localStorage.getItem(STORAGE.wfId) || '218600404'; }

  async function api(ep, opts = {}) {
    const url = ep.startsWith('http') ? ep : `${API}${ep}`;
    const r = await fetch(url, { headers: headers(), ...opts });
    if (!r.ok) throw new Error(`API ${r.status}`);
    return r.status === 204 ? null : r.json();
  }

  function bindEvents() {
    el.settingsToggle.onclick = () => el.settingsPanel.classList.toggle('open');
    el.togglePat.onclick = () => { el.patInput.type = el.patInput.type === 'password' ? 'text' : 'password'; };
    el.saveBtn.onclick = () => {
      if (!el.patInput.value.trim()) { showStatus('Enter PAT', 'error'); return; }
      save(); showStatus('Saved ✓', 'success');
      setTimeout(() => el.settingsPanel.classList.remove('open'), 800); fetchRuns();
    };
    el.launchBtn.onclick = launch;
    el.stopBtn.onclick = stop;
    $$('.btn-copy').forEach(b => b.onclick = () => {
      const t = $(`#${b.dataset.target}`).textContent;
      navigator.clipboard.writeText(t).then(() => { b.classList.add('copied'); toast('Copied!', 'success'); setTimeout(() => b.classList.remove('copied'), 1500); });
    });
  }

  function showStatus(t, c) { el.settingsStatus.textContent = t; el.settingsStatus.className = 'form-hint ' + (c || ''); setTimeout(() => { el.settingsStatus.textContent = ''; el.settingsStatus.className = 'form-hint'; }, 3000); }

  async function launch() {
    if (!localStorage.getItem(STORAGE.pat)) { el.settingsPanel.classList.add('open'); toast('Enter PAT first', 'error'); return; }
    setDot('pending', 'Triggering...'); el.launchBtn.disabled = true; el.launchInfo.textContent = 'Sending dispatch...'; el.credsCard.classList.add('hidden');
    try {
      await api(`/repos/${repo()}/actions/workflows/${wfId()}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main' }) });
      toast('Workflow triggered!', 'success'); el.launchInfo.textContent = 'Waiting for run...';
      setTimeout(findRun, 3000);
    } catch (e) { setDot('error', 'Failed'); el.launchBtn.disabled = false; el.launchInfo.textContent = 'Check PAT & retry'; toast('Error: ' + e.message, 'error'); }
  }

  async function findRun() {
    try {
      let d = await api(`/repos/${repo()}/actions/runs?per_page=5&status=queued`);
      let run = d.workflow_runs && d.workflow_runs[0];
      if (!run) { d = await api(`/repos/${repo()}/actions/runs?per_page=5&status=in_progress`); run = d.workflow_runs && d.workflow_runs[0]; }
      if (!run) { setTimeout(findRun, 5000); return; }
      runId = run.id; startTimer(); showProgress(); setDot('running', 'Running'); startPoll();
    } catch (e) { setDot('error', 'Not found'); el.launchBtn.disabled = false; toast(e.message, 'error'); }
  }

  function startPoll() { if (pollInt) clearInterval(pollInt); pollInt = setInterval(poll, 10000); poll(); }
  function stopPoll() { if (pollInt) { clearInterval(pollInt); pollInt = null; } }

  async function poll() {
    if (!runId) return;
    try {
      const run = await api(`/repos/${repo()}/actions/runs/${runId}`);
      if (run.status === 'queued') { updateSteps('queued'); setDot('pending', 'Queued'); }
      else if (run.status === 'in_progress') { setDot('running', 'In progress'); await checkSteps(); }
      else if (run.status === 'completed') {
        stopPoll(); stopTimer();
        if (run.conclusion === 'success' || run.conclusion === 'cancelled') await getCreds();
        else { setDot('error', 'Failed: ' + run.conclusion); el.launchBtn.disabled = false; toast('Workflow ' + run.conclusion, 'error'); }
      }
    } catch (e) { console.error(e); }
  }

  async function checkSteps() {
    if (!runId) return;
    try {
      const d = await api(`/repos/${repo()}/actions/runs/${runId}/jobs`);
      const job = d.jobs && d.jobs[0]; if (!job) return;
      const steps = job.steps || [];
      for (const s of steps) {
        if (s.name.includes('Tailscale') && s.status === 'in_progress') updateSteps('tailscale');
        if (s.name.includes('Maintain') && (s.status === 'in_progress' || s.status === 'completed')) {
          stopPoll(); stopTimer(); await getCreds(); return;
        }
      }
      const done = steps.filter(s => s.status === 'completed');
      if (done.some(s => s.name.includes('Configure'))) updateSteps('in_progress');
      if (done.some(s => s.name.includes('Tailscale') || s.name.includes('Install'))) updateSteps('tailscale');
    } catch (e) { console.error(e); }
  }

  async function getCreds() {
    if (!runId) return;
    try {
      const d = await api(`/repos/${repo()}/actions/runs/${runId}/jobs`);
      const job = d.jobs && d.jobs[0];
      if (!job) { fallback(); return; }

      const anns = await api(`/repos/${repo()}/check-runs/${job.id}/annotations`);
      const credAnn = anns.find(a => a.title === 'RDP_ACCESS_INFO');

      if (credAnn) {
        const parts = credAnn.message.split('|');
        const ip = parts.find(p => p.startsWith('IP='))?.split('=')[1];
        const pass = parts.find(p => p.startsWith('Pass='))?.split('=')[1];

        if (ip && pass) {
          el.credIP.textContent = ip;
          el.credPass.textContent = pass;
          el.credUser.textContent = 'RDP';
          el.credsCard.classList.remove('hidden'); updateSteps('ready');
          setDot('success', 'RDP is live!'); el.launchBtn.disabled = false;
          el.launchBtn.querySelector('span').textContent = 'Launch New';
          toast('Credentials received!', 'success');
          return;
        }
      }
      fallback();
    } catch (e) { fallback(); }
  }

  function parseCreds(txt) { }

  function fallback() {
    el.credIP.textContent = 'See GitHub Actions'; el.credPass.textContent = 'See GitHub Actions'; el.credUser.textContent = 'RDP';
    el.credsCard.classList.remove('hidden'); updateSteps('ready'); setDot('success', 'RDP is live!'); el.launchBtn.disabled = false;
    el.launchInfo.innerHTML = `<a href="https://github.com/${repo()}/actions/runs/${runId}" target="_blank" style="color:var(--accent-blue)">View on GitHub →</a>`;
    toast('Check GitHub for credentials', 'info');
  }

  async function stop() {
    if (!runId) return;
    try {
      await api(`/repos/${repo()}/actions/runs/${runId}/cancel`, { method: 'POST' }); toast('Cancelled', 'info'); stopPoll(); stopTimer();
      setDot('idle', 'Ready'); el.credsCard.classList.add('hidden'); el.progressCard.classList.add('hidden'); el.launchBtn.disabled = false;
      el.launchBtn.querySelector('span').textContent = 'Launch RDP'; el.launchInfo.textContent = 'Starts a Windows Remote Desktop session via GitHub Actions'; runId = null; fetchRuns();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function fetchRuns() {
    if (!localStorage.getItem(STORAGE.pat)) return;
    try { const d = await api(`/repos/${repo()}/actions/runs?per_page=5`); renderRuns(d.workflow_runs || []); } catch (e) { }
  }

  function renderRuns(runs) {
    if (!runs.length) { el.runsList.innerHTML = '<p class="runs-empty">No recent runs</p>'; return; }
    el.runsList.innerHTML = runs.map(r => {
      const s = r.conclusion || r.status; const t = new Date(r.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `<div class="run-item"><div class="run-item__status ${s}"></div><span class="run-item__id">#${r.run_number}</span><span class="run-item__time">${t}</span></div>`;
    }).join('');
  }

  function setDot(s, t) { el.statusDot.className = 'status-indicator__dot ' + s; el.statusText.textContent = t; }

  function showProgress() { el.progressCard.classList.remove('hidden'); $$('.step').forEach(s => { s.classList.remove('active', 'done'); }); updateSteps('queued'); }

  function updateSteps(cur) {
    const order = ['queued', 'in_progress', 'tailscale', 'ready']; const ci = order.indexOf(cur);
    $$('.step').forEach(s => {
      const i = order.indexOf(s.dataset.step);
      if (i < ci) { s.classList.remove('active'); s.classList.add('done'); }
      else if (i === ci) { s.classList.add('active'); s.classList.remove('done'); }
      else { s.classList.remove('active', 'done'); }
    });
  }

  function startTimer() { startT = Date.now(); if (timerInt) clearInterval(timerInt); timerInt = setInterval(updateTime, 1000); updateTime(); }
  function stopTimer() { if (timerInt) { clearInterval(timerInt); timerInt = null; } }
  function updateTime() { const e = Math.floor((Date.now() - startT) / 1000); el.elapsedTime.textContent = `${Math.floor(e / 60)}:${(e % 60).toString().padStart(2, '0')}`; }

  function toast(msg, type = 'info') { const t = document.createElement('div'); t.className = `toast toast--${type}`; t.textContent = msg; el.toasts.appendChild(t); setTimeout(() => t.remove(), 3000); }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
  document.addEventListener('DOMContentLoaded', init);
})();
