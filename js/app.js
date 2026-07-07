(function(){
  const $ = (id) => document.getElementById(id);
  const fileInput = $('fileInput');
  const uploadBtn = $('uploadBtn');
  const dropZone = $('dropZone');
  const fileMeta = $('fileMeta');
  const statusText = $('statusText');
  const presetGrid = $('presetGrid');
  const playerPanel = $('playerPanel');
  const exportPanel = $('exportPanel');
  const activePresetName = $('activePresetName');
  const playBtn = $('playBtn');
  const pauseBtn = $('pauseBtn');
  const stopBtn = $('stopBtn');
  const abToggle = $('abToggle');
  const originalAudio = $('originalAudio');
  const masterAudio = $('masterAudio');
  const seekBar = $('seekBar');
  const currentTime = $('currentTime');
  const durationLabel = $('duration');
  const waveCanvas = $('waveCanvas');
  const downloadBtn = $('downloadBtn');
  const clipBtn = $('clipBtn');
  const shareFileBtn = $('shareFileBtn');
  const shareAppBtn = $('shareAppBtn');
  const formatSelect = $('formatSelect');
  const formatHint = $('formatHint');
  const shareSheet = $('shareSheet');
  const shareSheetBackdrop = $('shareSheetBackdrop');
  const closeShareSheetBtn = $('closeShareSheetBtn');
  const shareOptions = Array.from(document.querySelectorAll('.share-option'));
  const toast = $('toast');
  const splash = $('splash');

  const SHARE_TEXT = 'Instant beat mastering from the GLOKEY Co-Lab SupaAudio Suite.';

  let state = {
    file: null,
    sourceUrl: '',
    decoded: null,
    selectedPreset: null,
    masteredBuffer: null,
    masteredBlob: null,
    masteredUrl: '',
    mode: 'original',
    isSeeking: false
  };

  setTimeout(() => splash?.classList.add('done'), 3000);

  function showToast(message){
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function subtleTap(){
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 720;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.035, ctx.currentTime + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.07);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
      setTimeout(() => ctx.close(), 130);
    } catch (_) {}
  }

  function renderPresets(){
    presetGrid.innerHTML = '';
    window.BB_PRESETS.forEach((preset) => {
      const card = document.createElement('button');
      card.className = 'preset-card';
      card.type = 'button';
      card.dataset.id = preset.id;
      card.innerHTML = `
        <img src="${preset.image}" alt="${preset.name} preset icon">
        <div class="preset-info">
          <h3>${preset.name}</h3>
          <p>${preset.description}</p>
          <span class="best"><b>Best For:</b> ${preset.bestFor}</span>
        </div>`;
      card.addEventListener('click', () => selectPreset(preset));
      presetGrid.appendChild(card);
    });
  }

  function setBusy(isBusy, text){
    document.body.classList.toggle('is-processing', isBusy);
    statusText.textContent = text;
  }

  function updateFormatHint(){
    const descriptor = window.BBAudio.getExportDescriptor(formatSelect.value);
    if (descriptor.available) {
      formatHint.textContent = descriptor.hint || `${descriptor.label} is ready for direct export in this browser.`;
    } else {
      formatHint.textContent = `${descriptor.label} is listed, but ${descriptor.reason}`;
    }
  }

  async function loadFile(file){
    try {
      subtleTap();
      setBusy(true, 'Reading audio...');
      stopPlayback();
      resetMasterOnly();
      state.file = file;
      if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
      state.sourceUrl = URL.createObjectURL(file);
      originalAudio.src = state.sourceUrl;
      originalAudio.load();
      state.decoded = await window.BBAudio.decodeFile(file);
      const meta = window.BBAudio.analyzeBuffer(state.decoded);
      fileMeta.classList.remove('hidden');
      fileMeta.innerHTML = `<b>${file.name}</b><br>${(file.size/1024/1024).toFixed(2)} MB - ${meta.channels} channel${meta.channels>1?'s':''} - ${meta.sampleRate} Hz - ${window.BBAudio.formatTime(meta.duration)}<br>Peak: ${(meta.peak*100).toFixed(1)}% - Foundation ready for preset selection.`;
      durationLabel.textContent = window.BBAudio.formatTime(meta.duration);
      seekBar.disabled = false;
      drawWaveform(state.decoded);
      setBusy(false, 'Audio loaded. Choose a preset.');
      showToast('Beat loaded');
    } catch (error) {
      setBusy(false, error.message || 'Audio could not be loaded.');
      showToast('Upload failed');
    }
  }

  async function selectPreset(preset){
    if (!state.decoded) {
      showToast('Upload audio first');
      return;
    }

    try {
      subtleTap();
      stopPlayback();
      state.selectedPreset = preset;
      document.querySelectorAll('.preset-card').forEach((card) => card.classList.toggle('selected', card.dataset.id === preset.id));
      activePresetName.textContent = preset.name;
      playerPanel.classList.remove('disabled');
      exportPanel.classList.remove('disabled');
      setTransportDisabled(true);
      setBusy(true, `Applying ${preset.name}...`);
      state.masteredBuffer = await window.BBAudio.renderMaster(state.decoded, preset);
      state.masteredBlob = window.BBAudio.audioBufferToWav(state.masteredBuffer);
      if (state.masteredUrl) URL.revokeObjectURL(state.masteredUrl);
      state.masteredUrl = URL.createObjectURL(state.masteredBlob);
      masterAudio.src = state.masteredUrl;
      masterAudio.load();
      drawWaveform(state.masteredBuffer, true);
      state.mode = 'master';
      abToggle.textContent = 'Master';
      setTransportDisabled(false);
      setBusy(false, `${preset.name} ready. Tap play.`);
      showToast('Master ready');
    } catch (error) {
      setBusy(false, error.message || 'Preset failed.');
      showToast('Processing failed');
    }
  }

  function setTransportDisabled(disabled){
    [playBtn, pauseBtn, stopBtn, abToggle, downloadBtn, clipBtn, shareFileBtn].forEach((btn) => {
      if (btn) btn.disabled = disabled;
    });
  }

  function resetMasterOnly(){
    state.selectedPreset = null;
    state.masteredBuffer = null;
    state.masteredBlob = null;
    if (state.masteredUrl) URL.revokeObjectURL(state.masteredUrl);
    state.masteredUrl = '';
    state.mode = 'original';
    masterAudio.removeAttribute('src');
    masterAudio.load();
    document.querySelectorAll('.preset-card').forEach((card) => card.classList.remove('selected'));
    setTransportDisabled(true);
    activePresetName.textContent = 'No Preset Selected';
    abToggle.textContent = 'Original';
  }

  function activeAudio(){
    return state.mode === 'master' ? masterAudio : originalAudio;
  }

  function inactiveAudio(){
    return state.mode === 'master' ? originalAudio : masterAudio;
  }

  function stopPlayback(){
    [originalAudio, masterAudio].forEach((audio) => {
      audio.pause();
      try { audio.currentTime = 0; } catch (_) {}
    });
    seekBar.value = 0;
    currentTime.textContent = '0:00';
    playBtn.textContent = 'Play';
  }

  function toggleAB(){
    if (!state.masteredUrl) return;
    const from = activeAudio();
    const toMode = state.mode === 'master' ? 'original' : 'master';
    const to = toMode === 'master' ? masterAudio : originalAudio;
    const wasPlaying = !from.paused;
    const t = from.currentTime || 0;
    from.pause();
    state.mode = toMode;
    to.currentTime = Math.min(t, to.duration || t);
    abToggle.textContent = toMode === 'master' ? 'Master' : 'Original';
    if (wasPlaying) to.play().catch(() => {});
    subtleTap();
  }

  function playActive(){
    const audio = activeAudio();
    if (!audio.src) return;
    inactiveAudio().pause();
    audio.play().catch(() => {});
    playBtn.textContent = 'Play';
    subtleTap();
  }

  function pauseActive(){
    const audio = activeAudio();
    if (!audio.src) return;
    audio.pause();
    playBtn.textContent = 'Play';
    subtleTap();
  }

  function syncUi(){
    const audio = activeAudio();
    if (!state.isSeeking && Number.isFinite(audio.duration) && audio.duration > 0) {
      seekBar.value = Math.round((audio.currentTime / audio.duration) * 1000);
    }
    currentTime.textContent = window.BBAudio.formatTime(audio.currentTime || 0);
    if (Number.isFinite(audio.duration)) durationLabel.textContent = window.BBAudio.formatTime(audio.duration);
    requestAnimationFrame(syncUi);
  }

  function seek(){
    const audio = activeAudio();
    if (!Number.isFinite(audio.duration)) return;
    const t = (Number(seekBar.value) / 1000) * audio.duration;
    originalAudio.currentTime = Math.min(t, originalAudio.duration || t);
    masterAudio.currentTime = Math.min(t, masterAudio.duration || t);
  }

  async function getExportPayload(secondsLimit = null){
    if (!state.masteredBuffer || !state.file) return null;
    const format = formatSelect.value;
    const exportData = await window.BBAudio.createExportBlob(state.masteredBuffer, format, secondsLimit);
    const name = window.BBAudio.annotatedName(
      state.file.name,
      exportData.descriptor.extension,
      secondsLimit ? ' (Clip)' : ''
    );
    return { ...exportData, name };
  }

  function downloadBlob(blob, name){
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  async function downloadMaster(){
    try {
      const payload = await getExportPayload();
      if (!payload) return;
      downloadBlob(payload.blob, payload.name);
      showToast(`${payload.descriptor.label} download started`);
    } catch (error) {
      showToast(error.message || 'Export unavailable');
    }
  }

  async function downloadClip(){
    try {
      const payload = await getExportPayload(60);
      if (!payload) return;
      downloadBlob(payload.blob, payload.name);
      showToast(`${payload.descriptor.label} clip started`);
    } catch (error) {
      showToast(error.message || 'Clip export unavailable');
    }
  }

  async function shareFile(){
    try {
      const payload = await getExportPayload();
      if (!payload) return;
      const file = new File([payload.blob], payload.name, { type: payload.descriptor.mimeType });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: 'BeatBayngr Master',
          text: 'Mastered with BeatBayngr',
          files: [file]
        }).catch(() => {});
      } else {
        showToast('File sharing is not supported here. Try download.');
      }
    } catch (error) {
      showToast(error.message || 'Share unavailable');
    }
  }

  function openShareSheet(){
    shareSheet.classList.remove('hidden');
    shareSheet.setAttribute('aria-hidden', 'false');
  }

  function closeShareSheet(){
    shareSheet.classList.add('hidden');
    shareSheet.setAttribute('aria-hidden', 'true');
  }

  async function handleShareTarget(target){
    const title = 'BeatBayngr';
    const url = location.href;
    const encodedUrl = encodeURIComponent(url);
    const encodedText = encodeURIComponent(`${title} - ${SHARE_TEXT}`);
    if (target === 'native') {
      if (navigator.share) {
        await navigator.share({ title, text: SHARE_TEXT, url }).catch(() => {});
      } else {
        showToast('Native share is not available on this device.');
      }
      return;
    }
    if (target === 'copy') {
      await navigator.clipboard?.writeText(url);
      showToast('App link copied');
      closeShareSheet();
      return;
    }

    const routes = {
      x: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
      whatsapp: `https://wa.me/?text=${encodedText}%20${encodedUrl}`,
      email: `mailto:?subject=${encodeURIComponent(title)}&body=${encodedText}%0A%0A${encodedUrl}`
    };

    const route = routes[target];
    if (route) {
      window.open(route, '_blank', 'noopener,noreferrer,width=720,height=640');
      closeShareSheet();
    }
  }

  function drawWaveform(buffer, mastered = false){
    const ctx = waveCanvas.getContext('2d');
    const w = waveCanvas.width;
    const h = waveCanvas.height;
    ctx.clearRect(0, 0, w, h);

    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, 'rgba(255,255,255,0.05)');
    bg.addColorStop(1, 'rgba(0,0,0,0.14)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    if (!buffer) return;

    const data = buffer.getChannelData(0);
    const step = Math.ceil(data.length / w);
    const amp = h / 2.4;
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#00c8ff');
    grad.addColorStop(.5, mastered ? '#ff6a00' : '#d9f6ff');
    grad.addColorStop(1, '#ff2bd6');

    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.shadowBlur = 20;
    ctx.shadowColor = mastered ? '#ff6a00' : '#00c8ff';

    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      let min = 1;
      let max = -1;
      for (let j = 0; j < step; j++) {
        const datum = data[(x * step) + j] || 0;
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      ctx.moveTo(x, (1 + min) * amp);
      ctx.lineTo(x, (1 + max) * amp);
    }
    ctx.stroke();
  }

  uploadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => e.target.files[0] && loadFile(e.target.files[0]));
  ['dragenter', 'dragover'].forEach((type) => dropZone.addEventListener(type, (e) => {
    e.preventDefault();
    dropZone.classList.add('drag');
  }));
  ['dragleave', 'drop'].forEach((type) => dropZone.addEventListener(type, (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag');
  }));
  dropZone.addEventListener('drop', (e) => e.dataTransfer.files[0] && loadFile(e.dataTransfer.files[0]));
  abToggle.addEventListener('click', toggleAB);
  playBtn.addEventListener('click', playActive);
  pauseBtn.addEventListener('click', pauseActive);
  stopBtn.addEventListener('click', stopPlayback);
  seekBar.addEventListener('input', seek);
  seekBar.addEventListener('pointerdown', () => { state.isSeeking = true; });
  seekBar.addEventListener('pointerup', () => {
    state.isSeeking = false;
    seek();
  });
  downloadBtn.addEventListener('click', downloadMaster);
  clipBtn.addEventListener('click', downloadClip);
  shareFileBtn.addEventListener('click', shareFile);
  shareAppBtn.addEventListener('click', openShareSheet);
  formatSelect.addEventListener('change', updateFormatHint);
  shareSheetBackdrop.addEventListener('click', closeShareSheet);
  closeShareSheetBtn.addEventListener('click', closeShareSheet);
  shareOptions.forEach((button) => {
    button.addEventListener('click', () => handleShareTarget(button.dataset.shareTarget));
  });

  [originalAudio, masterAudio].forEach((audio) => {
    audio.addEventListener('ended', () => {
      playBtn.textContent = 'Play';
    });
  });

  renderPresets();
  updateFormatHint();
  syncUi();
})();
