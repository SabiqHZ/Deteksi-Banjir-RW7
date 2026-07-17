// ====================================================================
// KONFIGURASI — ganti dengan URL hasil deploy Google Apps Script kamu
// ====================================================================
const WEBAPP_URL = "https://script.google.com/macros/s/AKfycbxWc1EpsO0QNDQunoRFS2p363UoM3D8FZ44ZmjDNnRUQ132BzB9Qx83IgCZaWuNWIJC/exec";
const REFRESH_MS = 30000;      // interval polling dashboard (ms)
const STALE_MS   = 10 * 60000; // anggap device offline kalau data > 10 menit
const HISTORY_LIMIT = 300;     // jumlah baris riwayat yang diambil

document.getElementById('refreshLabel').textContent = REFRESH_MS / 1000;

const statusColor = { AMAN: '#34d399', SIAGA: '#fbbf24', BAHAYA: '#f87171' };

let chart;

function initChart(){
  const ctx = document.getElementById('historyChart').getContext('2d');
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Jarak (cm)',
        data: [],
        borderColor: '#2fd9c4',
        borderWidth: 2,
        pointRadius: 2.5,
        pointBackgroundColor: [],
        tension: 0.3,
        fill: { target: 'origin', above: 'rgba(47,217,196,0.08)' }
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: { color: '#7fa0b5', maxTicksLimit: 7, font: { family: 'IBM Plex Mono', size: 10.5 } },
          grid: { color: 'rgba(127,160,181,0.08)' }
        },
        y: {
          ticks: { color: '#7fa0b5', font: { family: 'IBM Plex Mono', size: 10.5 } },
          grid: { color: 'rgba(127,160,181,0.08)' },
          title: { display: true, text: 'cm', color: '#7fa0b5' }
        }
      }
    }
  });
}

function fmtElapsed(ms){
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + ' detik lalu';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' menit lalu';
  const h = Math.floor(m / 60);
  return h + ' jam ' + (m % 60) + ' menit lalu';
}

function statusDescription(status){
  if (status === 'AMAN') return 'Ketinggian air dalam batas normal.';
  if (status === 'SIAGA') return 'Air mulai naik, tetap pantau perkembangan.';
  if (status === 'BAHAYA') return 'Ketinggian air kritis — notifikasi telah dikirim ke Telegram.';
  return 'Status belum diketahui.';
}

function triggerPing(){
  const ring = document.getElementById('pingRing');
  ring.classList.remove('animate');
  void ring.offsetWidth; // restart animasi
  ring.classList.add('animate');
}

function updateGauge(history, latestJarak){
  const values = history.map(h => h.jarak).filter(v => typeof v === 'number');
  let min = Math.min(...values, latestJarak ?? 150);
  let max = Math.max(...values, latestJarak ?? 0);
  if (!isFinite(min) || !isFinite(max) || min === max){ min = 0; max = 150; }
  const pad = (max - min) * 0.1 || 10;
  min -= pad; max += pad;
  if (min < 0) min = 0;

  const ratio = Math.min(1, Math.max(0, (max - latestJarak) / (max - min)));
  const tubeTop = 10, tubeH = 150;
  const fillH = ratio * tubeH;

  const fillEl = document.getElementById('gaugeFill');
  fillEl.setAttribute('y', tubeTop + tubeH - fillH);
  fillEl.setAttribute('height', fillH);
}

function renderData(data){
  const { latest, history } = data;

  if (!latest){
    document.getElementById('logBody').innerHTML = '<tr><td colspan="3"><div class="empty-state">Belum ada data masuk dari sensor.</div></td></tr>';
    return;
  }

  const statusUpper = (latest.status || '').toUpperCase();
  const color = statusColor[statusUpper];

  const statusWordEl = document.getElementById('statusWord');
  statusWordEl.textContent = statusUpper || '—';
  statusWordEl.className = 'status-word ' + statusUpper.toLowerCase();
  document.getElementById('statusDesc').textContent = statusDescription(statusUpper);
  document.getElementById('jarakValue').textContent = latest.jarak + ' cm';

  const latestTime = new Date(latest.timestamp.replace(' ', 'T'));
  const elapsedMs = Date.now() - latestTime.getTime();
  document.getElementById('lastUpdate').textContent = fmtElapsed(elapsedMs);

  document.getElementById('staleBanner').style.display = elapsedMs > STALE_MS ? 'block' : 'none';
  document.getElementById('connDot').className = 'dot' + (elapsedMs > STALE_MS ? ' offline' : '');
  document.getElementById('connLabel').textContent = elapsedMs > STALE_MS ? 'Kemungkinan offline' : 'Live';

  updateGauge(history, latest.jarak);
  document.getElementById('gaugeFill').setAttribute('fill', color || '#7fa0b5');
  triggerPing();

  chart.data.labels = history.map(h => h.timestamp.slice(5, 16));
  chart.data.datasets[0].data = history.map(h => h.jarak);
  chart.data.datasets[0].pointBackgroundColor = history.map(h => statusColor[(h.status || '').toUpperCase()] || '#7fa0b5');
  chart.update();

  const rows = history.slice().reverse().map(h => {
    const st = (h.status || '').toUpperCase();
    return `<tr><td>${h.timestamp}</td><td>${h.jarak}</td><td><span class="badge ${st.toLowerCase()}">${st}</span></td></tr>`;
  }).join('');
  document.getElementById('logBody').innerHTML = rows || '<tr><td colspan="3"><div class="empty-state">Belum ada data.</div></td></tr>';
}

async function fetchData(){
  try {
    const res = await fetch(`${WEBAPP_URL}?action=data&limit=${HISTORY_LIMIT}`);
    const json = await res.json();
    if (json.status !== 'ok') throw new Error(json.message || 'Gagal memuat data');
    renderData(json);
  } catch (err){
    document.getElementById('connLabel').textContent = 'Gagal terhubung';
    document.getElementById('connDot').classList.add('offline');
    console.error(err);
  }
}

// ====== PENGATURAN THRESHOLD & INTERVAL ======
async function loadConfig(){
  try {
    const res = await fetch(`${WEBAPP_URL}?action=config`);
    const json = await res.json();
    if (json.status === 'ok'){
      document.getElementById('thAman').value = json.th_aman;
      document.getElementById('thSiaga').value = json.th_siaga;
      document.getElementById('thBahaya').value = json.th_bahaya;
      document.getElementById('intervalSec').value = json.interval_sec;
    }
  } catch (err){
    console.error('Gagal memuat konfigurasi:', err);
  }
}

function setupSettingsForm(){
  document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('saveSettingsBtn');
    const msg = document.getElementById('settingsMsg');
    btn.disabled = true;
    msg.textContent = 'Menyimpan…';
    msg.className = 'settings-msg';

    const payload = {
      action: 'updateConfig',
      th_aman: parseFloat(document.getElementById('thAman').value),
      th_siaga: parseFloat(document.getElementById('thSiaga').value),
      th_bahaya: parseFloat(document.getElementById('thBahaya').value),
      interval_sec: parseInt(document.getElementById('intervalSec').value)
    };

    try {
      // Content-Type text/plain sengaja dipakai supaya browser tidak mengirim
      // preflight OPTIONS request, karena Apps Script Web App tidak menanganinya.
      const res = await fetch(WEBAPP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();

      if (json.status === 'ok'){
        msg.textContent = '✓ Tersimpan. Perangkat akan sinkron otomatis dalam beberapa menit.';
        msg.classList.add('ok');
      } else {
        msg.textContent = '✗ ' + json.message;
        msg.classList.add('err');
      }
    } catch (err){
      msg.textContent = '✗ Gagal terhubung ke server.';
      msg.classList.add('err');
      console.error(err);
    } finally {
      btn.disabled = false;
    }
  });
}

// ====== INISIALISASI ======
function init(){
  if (WEBAPP_URL.includes('XXXXXXXXXXXX')){
    document.getElementById('setupBanner').style.display = 'block';
    document.getElementById('connLabel').textContent = 'Belum dikonfigurasi';
    document.getElementById('connDot').classList.add('offline');
    return;
  }

  initChart();
  setupSettingsForm();
  fetchData();
  loadConfig();
  setInterval(fetchData, REFRESH_MS);
}

init();