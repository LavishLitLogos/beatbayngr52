(function(){
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const SCRIPT_CACHE = new Map();

  function formatTime(sec){
    if (!Number.isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function safeBaseName(fileName){
    return fileName.replace(/\.[^/.]+$/, '').trim() || 'BeatBayngr Export';
  }

  function annotatedName(fileName, extension = 'wav', suffix = ''){
    const base = safeBaseName(fileName);
    return `${base} (BBv1)${suffix}.${extension}`;
  }

  function getExportDescriptor(format){
    const normalized = String(format || 'mp3').toLowerCase();
    const descriptors = {
      mp3: {
        format: 'mp3',
        extension: 'mp3',
        mimeType: 'audio/mpeg',
        label: 'MP3',
        available: true,
        reason: '',
        hint: 'MP3 export is ready and tuned for quick delivery.'
      },
      flac: {
        format: 'flac',
        extension: 'flac',
        mimeType: 'audio/flac',
        label: 'FLAC',
        available: true,
        reason: '',
        hint: 'FLAC export is ready for lossless delivery.'
      },
      wav: {
        format: 'wav',
        extension: 'wav',
        mimeType: 'audio/wav',
        label: 'WAV',
        available: true,
        reason: '',
        hint: 'WAV export is ready as the full-size fallback.'
      }
    };
    return descriptors[normalized] || descriptors.mp3;
  }

  function loadScriptOnce(src){
    if (SCRIPT_CACHE.has(src)) return SCRIPT_CACHE.get(src);
    const promise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === 'true') {
          resolve();
          return;
        }
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => {
        script.dataset.loaded = 'true';
        resolve();
      };
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });
    SCRIPT_CACHE.set(src, promise);
    return promise;
  }

  async function ensureMp3Encoder(){
    if (!window.lamejs) {
      await loadScriptOnce('js/vendor/lame.min.js');
    }
    if (!window.lamejs?.Mp3Encoder) {
      throw new Error('MP3 encoder could not be loaded.');
    }
    return window.lamejs;
  }

  async function ensureFlacEncoder(){
    window.FLAC_SCRIPT_LOCATION = 'js/vendor/';
    if (!window.Flac) {
      await loadScriptOnce('js/vendor/libflac.min.wasm.js');
    }
    const flac = window.Flac;
    if (!flac) {
      throw new Error('FLAC encoder could not be loaded.');
    }
    if (flac.isReady && flac.isReady()) {
      return flac;
    }
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn) => (event) => {
        if (settled) return;
        settled = true;
        fn(event);
      };
      flac.on('ready', finish(() => resolve(flac)));
      setTimeout(finish(() => reject(new Error('FLAC encoder timed out during startup.'))), 15000);
    });
    return flac;
  }

  async function decodeFile(file){
    const arrayBuffer = await file.arrayBuffer();
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('This browser does not support Web Audio.');
    const ctx = new AudioContextClass();
    try {
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
      await ctx.close();
      return decoded;
    } catch (err) {
      await ctx.close();
      throw new Error('This audio format could not be decoded by this browser. Try WAV or MP3, or use a newer browser.');
    }
  }

  function analyzeBuffer(buffer){
    const length = buffer.length;
    const stride = Math.max(1, Math.floor(length / 160000));
    let peak = 0;
    let sumSq = 0;
    let samples = 0;
    let zeroCrossings = 0;
    let clipped = 0;
    let highEnergy = 0;
    let harshEnergy = 0;
    let subEnergy = 0;
    let lowMidEnergy = 0;
    let prev = 0;

    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const ch = buffer.getChannelData(c);
      prev = ch[0] || 0;
      let sub = 0;
      let low = 0;
      for (let i = 0; i < length; i += stride) {
        const v = ch[i] || 0;
        const av = Math.abs(v);
        peak = Math.max(peak, av);
        sumSq += v * v;
        if (av >= 0.985) clipped++;

        sub += (v - sub) * 0.012;
        low += (v - low) * 0.055;
        const high = v - low;
        const harsh = (v - prev) - high * 0.18;
        subEnergy += sub * sub;
        lowMidEnergy += (low - sub) * (low - sub);
        highEnergy += high * high;
        harshEnergy += harsh * harsh;

        if (i > 0 && Math.sign(v) !== Math.sign(prev)) zeroCrossings++;
        prev = v;
        samples++;
      }
    }

    const rms = Math.sqrt(sumSq / Math.max(1, samples));
    const crest = peak / Math.max(0.000001, rms);
    const brightness = clamp(Math.sqrt(highEnergy / Math.max(0.000001, lowMidEnergy)) * 0.85, 0, 2.5);
    const harshness = clamp(Math.sqrt(harshEnergy / Math.max(0.000001, sumSq)) * 1.15, 0, 2.5);
    const subBuildup = clamp(Math.sqrt(subEnergy / Math.max(0.000001, lowMidEnergy)) * 0.9, 0, 2.5);
    const mud = clamp(Math.sqrt(lowMidEnergy / Math.max(0.000001, sumSq)) * 1.25, 0, 2.5);
    const clipRatio = clipped / Math.max(1, samples);
    const hot = peak > 0.96 || crest < 3.2 || clipRatio > 0.0008;

    return {
      peak,
      rms,
      crest,
      brightness,
      harshness,
      subBuildup,
      mud,
      clipRatio,
      hot,
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
      crossings: zeroCrossings
    };
  }

  function measureLevel(buffer){
    const channels = buffer.numberOfChannels;
    const length = buffer.length;
    let peak = 0;
    let sumSq = 0;
    let weightedSq = 0;
    let count = 0;

    for (let c = 0; c < channels; c++) {
      const data = buffer.getChannelData(c);
      let low = 0;
      for (let i = 0; i < length; i++) {
        const v = data[i] || 0;
        const av = Math.abs(v);
        peak = Math.max(peak, av);
        sumSq += v * v;

        low += (v - low) * 0.035;
        const high = v - low;
        const weighted = low * 0.42 + high * 1.18;
        weightedSq += weighted * weighted;
        count++;
      }
    }

    const rms = Math.sqrt(sumSq / Math.max(1, count));
    const weightedRms = Math.sqrt(weightedSq / Math.max(1, count));
    return {
      peak,
      rms,
      weightedRms,
      crest: peak / Math.max(0.000001, rms)
    };
  }

  function prepareWorkingBuffer(ctx, buffer, analysis){
    const sr = buffer.sampleRate;
    const channels = Math.min(2, buffer.numberOfChannels || 2);
    const out = ctx.createBuffer(channels, buffer.length, sr);

    const peakSafety = analysis.peak > 0.94 ? 0.88 / analysis.peak : 1;
    const levelGain = Math.min(1.0, peakSafety);

    for (let c = 0; c < channels; c++) {
      const input = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1));
      const output = out.getChannelData(c);
      let dc = 0;
      for (let i = 0; i < input.length; i += 512) dc += input[i] || 0;
      dc /= Math.ceil(input.length / 512);

      let last = 0;
      for (let i = 0; i < input.length; i++) {
        let v = (input[i] - dc) * levelGain;
        const jump = v - last;
        if (Math.abs(jump) > 0.72 && Math.abs(v) > 0.78) v = last + Math.sign(jump) * 0.42;
        if (v > 0.93) v = 0.93 + Math.tanh((v - 0.93) * 4.5) * 0.045;
        if (v < -0.93) v = -0.93 + Math.tanh((v + 0.93) * 4.5) * 0.045;
        output[i] = v;
        last = v;
      }
    }
    return out;
  }

  function addStereoWidth(ctx, input, amount, channels){
    const safeAmount = clamp(Number(amount) || 1, 0.97, 1.085);
    if (channels < 2 || Math.abs(safeAmount - 1) < 0.005) return input;

    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);
    const lToL = ctx.createGain();
    const rToL = ctx.createGain();
    const lToR = ctx.createGain();
    const rToR = ctx.createGain();

    lToL.gain.value = 0.5 + 0.5 * safeAmount;
    rToL.gain.value = 0.5 - 0.5 * safeAmount;
    lToR.gain.value = 0.5 - 0.5 * safeAmount;
    rToR.gain.value = 0.5 + 0.5 * safeAmount;

    input.connect(splitter);
    splitter.connect(lToL, 0);
    splitter.connect(rToL, 1);
    splitter.connect(lToR, 0);
    splitter.connect(rToR, 1);
    lToL.connect(merger, 0, 0);
    rToL.connect(merger, 0, 0);
    lToR.connect(merger, 0, 1);
    rToR.connect(merger, 0, 1);
    return merger;
  }

  function postSafety(ctx, buffer, ceiling, sourceBuffer){
    const channels = buffer.numberOfChannels;
    const length = buffer.length;
    const current = measureLevel(buffer);
    const source = measureLevel(sourceBuffer);
    const peak = Math.max(0.000001, current.peak);
    const rms = Math.max(0.000001, current.rms);
    const weightedRms = Math.max(0.000001, current.weightedRms);
    const sourcePeak = Math.max(0.000001, source.peak);
    const sourceRms = Math.max(0.000001, source.rms);
    const sourceWeightedRms = Math.max(0.000001, source.weightedRms);
    const maxCeiling = clamp(ceiling || 0.88, 0.82, 0.90);

    const peakGuard = Math.min(maxCeiling / peak, (sourcePeak * 0.985) / peak);
    const rmsGuard = (sourceRms * 0.94) / rms;
    const perceivedGuard = (sourceWeightedRms * 0.92) / weightedRms;
    const gain = Math.min(1, peakGuard, rmsGuard, perceivedGuard);

    const out = ctx.createBuffer(channels, length, buffer.sampleRate);
    for (let c = 0; c < channels; c++) {
      const src = buffer.getChannelData(c);
      const dst = out.getChannelData(c);
      for (let i = 0; i < length; i++) {
        dst[i] = clamp(src[i] * gain, -maxCeiling, maxCeiling);
      }
    }
    return out;
  }

  async function renderMaster(buffer, preset){
    const sr = buffer.sampleRate;
    const duration = buffer.duration;
    const channels = Math.min(2, buffer.numberOfChannels || 2);
    const analysis = analyzeBuffer(buffer);
    const settings = preset.settings || {};

    const ctx = new OfflineAudioContext(channels, Math.ceil(duration * sr), sr);
    const source = ctx.createBufferSource();
    source.buffer = prepareWorkingBuffer(ctx, buffer, analysis);

    const brightPenalty = clamp((analysis.brightness - 0.92) * 1.35, 0, 1.9);
    const harshPenalty = clamp((analysis.harshness - 0.62) * 1.6, 0, 2.2);
    const subPenalty = clamp((analysis.subBuildup - 0.72) * 1.25, 0, 1.6);
    const mudPenalty = clamp((analysis.mud - 0.62) * 1.2, 0, 1.6);
    const hotPenalty = analysis.hot ? 0.55 : 0;
    const deharshDb = -0.75 - (settings.deharsh || 0.5) * 2.1 - brightPenalty - harshPenalty - hotPenalty;
    const airDb = clamp((settings.air || 0) - brightPenalty * 0.85 - harshPenalty * 0.45, -3.2, 0.28);

    const lowDb = clamp((settings.lowWeight || 0) * 0.44 - subPenalty * 0.62, -1.2, 0.42);
    const punchDb = clamp((settings.punch || 0) * 0.38, -0.18, 0.30);
    const bodyDb = clamp((settings.body || 0) * 0.38 - mudPenalty * 0.24, -0.50, 0.34);
    const presenceDb = clamp((settings.presence || 0) * 0.28 - brightPenalty * 0.28, -0.80, 0.18);
    const mudDb = -0.55 - (settings.mudCut || 0.4) * 1.3 - mudPenalty;

    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 25;
    highpass.Q.value = 0.707;

    const subControl = ctx.createBiquadFilter();
    subControl.type = 'lowshelf';
    subControl.frequency.value = 42;
    subControl.gain.value = -0.2 - subPenalty - (analysis.hot ? 0.35 : 0);

    const lowShelf = ctx.createBiquadFilter();
    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = 92;
    lowShelf.gain.value = lowDb;

    const punch = ctx.createBiquadFilter();
    punch.type = 'peaking';
    punch.frequency.value = 145;
    punch.Q.value = 0.8;
    punch.gain.value = punchDb;

    const mud = ctx.createBiquadFilter();
    mud.type = 'peaking';
    mud.frequency.value = 310;
    mud.Q.value = 0.95;
    mud.gain.value = mudDb;

    const body = ctx.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = 780;
    body.Q.value = 0.8;
    body.gain.value = bodyDb;

    const presence = ctx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 1750;
    presence.Q.value = 0.82;
    presence.gain.value = presenceDb;

    const harsh = ctx.createBiquadFilter();
    harsh.type = 'peaking';
    harsh.frequency.value = 4200;
    harsh.Q.value = 1.4;
    harsh.gain.value = deharshDb;

    const sizzle = ctx.createBiquadFilter();
    sizzle.type = 'peaking';
    sizzle.frequency.value = 7600;
    sizzle.Q.value = 1.1;
    sizzle.gain.value = -0.75 - brightPenalty * 0.7;

    const highShelf = ctx.createBiquadFilter();
    highShelf.type = 'highshelf';
    highShelf.frequency.value = 10500;
    highShelf.gain.value = airDb;

    const fizz = ctx.createBiquadFilter();
    fizz.type = 'peaking';
    fizz.frequency.value = 11800;
    fizz.Q.value = 0.9;
    fizz.gain.value = -0.25 - brightPenalty * 0.45 - harshPenalty * 0.35;

    const warmth = ctx.createGain();
    warmth.gain.value = 1;

    const ceiling = ctx.createGain();
    ceiling.gain.value = 1;

    let chain = highpass;
    source.connect(chain)
      .connect(subControl)
      .connect(lowShelf)
      .connect(punch)
      .connect(mud)
      .connect(body)
      .connect(presence)
      .connect(harsh)
      .connect(sizzle)
      .connect(highShelf)
      .connect(fizz)
      .connect(warmth);

    const widthNode = addStereoWidth(ctx, warmth, settings.width || 1, channels);
    widthNode.connect(ceiling).connect(ctx.destination);

    source.start(0);
    const rendered = await ctx.startRendering();

    const postCtx = new OfflineAudioContext(channels, rendered.length, rendered.sampleRate);
    return postSafety(postCtx, rendered, settings.ceiling, buffer);
  }

  function audioBufferToWav(buffer, secondsLimit = null){
    const sampleRate = buffer.sampleRate;
    const channels = buffer.numberOfChannels;
    const totalSamples = secondsLimit ? Math.min(buffer.length, Math.floor(secondsLimit * sampleRate)) : buffer.length;
    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const dataSize = totalSamples * blockAlign;
    const arrayBuffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(arrayBuffer);
    let offset = 0;
    const writeString = (s) => { for (let i = 0; i < s.length; i++) view.setUint8(offset++, s.charCodeAt(i)); };
    writeString('RIFF'); view.setUint32(offset, 36 + dataSize, true); offset += 4;
    writeString('WAVE'); writeString('fmt '); view.setUint32(offset, 16, true); offset += 4;
    view.setUint16(offset, 1, true); offset += 2; view.setUint16(offset, channels, true); offset += 2;
    view.setUint32(offset, sampleRate, true); offset += 4; view.setUint32(offset, sampleRate * blockAlign, true); offset += 4;
    view.setUint16(offset, blockAlign, true); offset += 2; view.setUint16(offset, 16, true); offset += 2;
    writeString('data'); view.setUint32(offset, dataSize, true); offset += 4;
    const channelData = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
    for (let i = 0; i < totalSamples; i++) {
      for (let c = 0; c < channels; c++) {
        const s = clamp(channelData[c][i], -1, 1);
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        offset += 2;
      }
    }
    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  function getLimitedBuffer(buffer, secondsLimit = null){
    if (!secondsLimit) return buffer;
    const targetLength = Math.min(buffer.length, Math.floor(secondsLimit * buffer.sampleRate));
    if (targetLength >= buffer.length) return buffer;
    const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const sliced = new OfflineContext(buffer.numberOfChannels, targetLength, buffer.sampleRate).createBuffer(
      buffer.numberOfChannels,
      targetLength,
      buffer.sampleRate
    );
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      sliced.copyToChannel(buffer.getChannelData(channel).subarray(0, targetLength), channel, 0);
    }
    return sliced;
  }

  function toInterleavedInt16(buffer){
    const channels = Math.min(2, buffer.numberOfChannels);
    const length = buffer.length;
    const output = new Int16Array(length * channels);
    const source = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
    let offset = 0;
    for (let i = 0; i < length; i++) {
      for (let channel = 0; channel < channels; channel++) {
        const sample = clamp(source[channel][i], -1, 1);
        output[offset++] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
      }
    }
    return output;
  }

  function splitInt16Channels(interleaved, channels){
    if (channels === 1) return [interleaved];
    const samplesPerChannel = Math.floor(interleaved.length / channels);
    const split = Array.from({ length: channels }, () => new Int16Array(samplesPerChannel));
    for (let i = 0; i < samplesPerChannel; i++) {
      for (let channel = 0; channel < channels; channel++) {
        split[channel][i] = interleaved[(i * channels) + channel];
      }
    }
    return split;
  }

  function toInterleavedInt32(buffer, bitsPerSample = 24){
    const channels = Math.min(2, buffer.numberOfChannels);
    const length = buffer.length;
    const output = new Int32Array(length * channels);
    const source = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
    const maxValue = bitsPerSample === 24 ? 0x7fffff : 0x7fff;
    const minValue = bitsPerSample === 24 ? -0x800000 : -0x8000;
    let offset = 0;
    for (let i = 0; i < length; i++) {
      for (let channel = 0; channel < channels; channel++) {
        const sample = clamp(source[channel][i], -1, 1);
        let value = sample < 0 ? Math.round(sample * Math.abs(minValue)) : Math.round(sample * maxValue);
        value = clamp(value, minValue, maxValue);
        output[offset++] = value;
      }
    }
    return output;
  }

  function mergeUint8Chunks(chunks){
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }

  function addFlacMetadata(chunks, metadata){
    if (!metadata || !chunks.length) return;
    const data = chunks[0].length === 4 && chunks[1] ? chunks[1] : chunks[0];
    const offset = chunks[0].length === 4 ? 0 : 4;
    if (data.length < offset + 38) return;
    if (String.fromCharCode.apply(null, data.subarray(offset - 4, offset)) !== 'fLaC') return;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    view.setUint8(8 + offset, metadata.min_framesize >> 16);
    view.setUint8(9 + offset, metadata.min_framesize >> 8);
    view.setUint8(10 + offset, metadata.min_framesize);
    view.setUint8(11 + offset, metadata.max_framesize >> 16);
    view.setUint8(12 + offset, metadata.max_framesize >> 8);
    view.setUint8(13 + offset, metadata.max_framesize);
    view.setUint8(18 + offset, metadata.total_samples >> 24);
    view.setUint8(19 + offset, metadata.total_samples >> 16);
    view.setUint8(20 + offset, metadata.total_samples >> 8);
    view.setUint8(21 + offset, metadata.total_samples);
    if (metadata.md5sum) {
      for (let i = 0; i < metadata.md5sum.length / 2; i++) {
        const index = i * 2;
        view.setUint8(22 + offset + i, parseInt(metadata.md5sum.substring(index, index + 2), 16));
      }
    }
  }

  async function encodeMp3(buffer, secondsLimit = null){
    const lamejs = await ensureMp3Encoder();
    const limited = getLimitedBuffer(buffer, secondsLimit);
    const channels = Math.min(2, limited.numberOfChannels);
    const bitRate = 320;
    const interleaved = toInterleavedInt16(limited);
    const [left, right] = splitInt16Channels(interleaved, channels);
    const encoder = new lamejs.Mp3Encoder(channels, limited.sampleRate, bitRate);
    const chunks = [];
    const frameSize = 1152;

    for (let i = 0; i < left.length; i += frameSize) {
      const leftChunk = left.subarray(i, i + frameSize);
      const rightChunk = right ? right.subarray(i, i + frameSize) : undefined;
      const encoded = encoder.encodeBuffer(leftChunk, rightChunk);
      if (encoded.length) chunks.push(new Uint8Array(encoded));
      if (i && i % (frameSize * 64) === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    const flushed = encoder.flush();
    if (flushed.length) chunks.push(new Uint8Array(flushed));
    return new Blob([mergeUint8Chunks(chunks)], { type: 'audio/mpeg' });
  }

  async function encodeFlac(buffer, secondsLimit = null){
    const flac = await ensureFlacEncoder();
    const limited = getLimitedBuffer(buffer, secondsLimit);
    const channels = Math.min(2, limited.numberOfChannels);
    const bitsPerSample = 24;
    const pcm = toInterleavedInt32(limited, bitsPerSample);
    const chunks = [];
    let metadata;
    const encoder = flac.create_libflac_encoder(
      limited.sampleRate,
      channels,
      bitsPerSample,
      5,
      limited.length,
      1
    );
    if (!encoder) {
      throw new Error('FLAC encoder could not be created.');
    }

    const initStatus = flac.init_encoder_stream(
      encoder,
      (encodedData) => { chunks.push(encodedData); },
      (streamInfo, meta) => { metadata = streamInfo || meta?.data || meta; }
    );

    if (initStatus !== 0) {
      flac.FLAC__stream_encoder_delete(encoder);
      throw new Error('FLAC encoder failed to initialize.');
    }

    const ok = flac.FLAC__stream_encoder_process_interleaved(encoder, pcm, limited.length);
    if (!ok) {
      flac.FLAC__stream_encoder_delete(encoder);
      throw new Error('FLAC encoding failed during processing.');
    }

    const finished = flac.FLAC__stream_encoder_finish(encoder);
    flac.FLAC__stream_encoder_delete(encoder);
    if (!finished) {
      throw new Error('FLAC encoder failed to finish.');
    }

    addFlacMetadata(chunks, metadata);
    return new Blob([mergeUint8Chunks(chunks)], { type: 'audio/flac' });
  }

  async function createExportBlob(buffer, format, secondsLimit = null){
    const descriptor = getExportDescriptor(format);
    if (descriptor.format === 'wav') {
      return { blob: audioBufferToWav(buffer, secondsLimit), descriptor };
    }
    if (descriptor.format === 'mp3') {
      return { blob: await encodeMp3(buffer, secondsLimit), descriptor };
    }
    if (descriptor.format === 'flac') {
      return { blob: await encodeFlac(buffer, secondsLimit), descriptor };
    }
    throw new Error('Unsupported export format.');
  }

  window.BBAudio = {
    decodeFile,
    analyzeBuffer,
    renderMaster,
    audioBufferToWav,
    createExportBlob,
    getExportDescriptor,
    annotatedName,
    formatTime
  };
})();
