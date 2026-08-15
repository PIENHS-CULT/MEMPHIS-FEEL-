
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { transcribeAudio, connectLiveCoProducer, encodePCM, decodePCM, decodeAudioData, detectChords, generateAmbientTip, speakFeedback, refineLyrics, analyzeMood } from '../services/geminiService';
import { SavedStudioProject, FXState, StudioTemplate, FXPreset } from '../types';

const Studio: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [transcription, setTranscription] = useState<string | null>(null);
  const [moodData, setMoodData] = useState<any>(null);
  const [detectedChordsList, setDetectedChordsList] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [trackTitle, setTrackTitle] = useState("New Session #471");
  const [activeAnalysisMode, setActiveAnalysisMode] = useState<'transcribe' | 'chords'>('transcribe');
  const [savedSessions, setSavedSessions] = useState<SavedStudioProject[]>([]);
  const [templates, setTemplates] = useState<StudioTemplate[]>([]);
  const [fxPresets, setFxPresets] = useState<FXPreset[]>([]);
  
  // MIDI States
  const [midiDevices, setMidiDevices] = useState<string[]>([]);
  const [lastMidiNote, setLastMidiNote] = useState<number | null>(null);
  const [isMidiSupported, setIsMidiSupported] = useState(false);
  const activeOscillators = useRef<Map<number, { osc: OscillatorNode, gain: GainNode }>>(new Map());

  // FX Matrix & Chain Order
  const [fx, setFx] = useState<FXState>({
    reverb: { active: false, mix: 0.4, decay: 2.5 },
    delay: { active: false, mix: 0.3, time: 0.4, feedback: 0.5 },
    distortion: { active: false, drive: 20, mix: 0.2 }
  });
  const [chainOrder, setChainOrder] = useState<string[]>(['distortion', 'delay', 'reverb']);

  // Ambient Mode States
  const [isAmbientMode, setIsAmbientMode] = useState(false);
  const [ambientTip, setAmbientTip] = useState<string | null>(null);
  const ambientAudioCtxRef = useRef<AudioContext | null>(null);
  const droneOscillatorsRef = useRef<OscillatorNode[]>([]);
  const idleTimerRef = useRef<number | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const liveSessionRef = useRef<any>(null);
  
  // Audio Contexts
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const visualizerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const fileInputTranscribeRef = useRef<HTMLInputElement>(null);

  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // MIDI Initialization
  useEffect(() => {
    if (navigator.requestMIDIAccess) {
      setIsMidiSupported(true);
      navigator.requestMIDIAccess().then(onMIDISuccess, onMIDIFailure);
    }
  }, []);

  const onMIDISuccess = (midiAccess: any) => {
    const inputs = midiAccess.inputs.values();
    const devices: string[] = [];
    for (let input = inputs.next(); input && !input.done; input = inputs.next()) {
      input.value.onmidimessage = handleMIDIMessage;
      devices.push(input.value.name);
    }
    setMidiDevices(devices);

    midiAccess.onstatechange = (e: any) => {
      const updatedInputs = midiAccess.inputs.values();
      const updatedDevices: string[] = [];
      for (let input = updatedInputs.next(); input && !input.done; input = updatedInputs.next()) {
        updatedDevices.push(input.value.name);
      }
      setMidiDevices(updatedDevices);
    };
  };

  const onMIDIFailure = () => {
    console.error("Could not access MIDI devices.");
    setIsMidiSupported(false);
  };

  const midiNoteToFreq = (note: number) => {
    return 440 * Math.pow(2, (note - 69) / 12);
  };

  const handleMIDIMessage = (message: any) => {
    const [command, note, velocity] = message.data;
    // Note On
    if (command === 144 && velocity > 0) {
      playMIDINote(note, velocity);
      setLastMidiNote(note);
    } 
    // Note Off
    else if (command === 128 || (command === 144 && velocity === 0)) {
      stopMIDINote(note);
    }
  };

  const playMIDINote = (note: number, velocity: number) => {
    if (!outputAudioCtxRef.current) {
      outputAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = outputAudioCtxRef.current;
    
    // Stop if already playing this note
    if (activeOscillators.current.has(note)) {
      stopMIDINote(note);
    }

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    // Phonk-style sawtooth for gritty bass/leads
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(midiNoteToFreq(note), ctx.currentTime);
    
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime((velocity / 127) * 0.2, ctx.currentTime + 0.02);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start();
    activeOscillators.current.set(note, { osc, gain });
  };

  const stopMIDINote = (note: number) => {
    const voice = activeOscillators.current.get(note);
    if (voice && outputAudioCtxRef.current) {
      const ctx = outputAudioCtxRef.current;
      voice.gain.gain.cancelScheduledValues(ctx.currentTime);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, ctx.currentTime);
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.1);
      setTimeout(() => {
        voice.osc.stop();
        voice.osc.disconnect();
        voice.gain.disconnect();
      }, 150);
      activeOscillators.current.delete(note);
    }
  };

  // Persistent storage logic
  useEffect(() => {
    const storedSessions = localStorage.getItem('museai_studio_sessions');
    if (storedSessions) {
      try { setSavedSessions(JSON.parse(storedSessions)); } catch (e) { console.error(e); }
    }
    const storedTemplates = localStorage.getItem('museai_studio_templates');
    if (storedTemplates) {
      try { setTemplates(JSON.parse(storedTemplates)); } catch (e) { console.error(e); }
    }
    const storedPresets = localStorage.getItem('museai_fx_presets');
    if (storedPresets) {
      try { setFxPresets(JSON.parse(storedPresets)); } catch (e) { console.error(e); }
    }
  }, []);

  // Visualization logic
  const startVisualizer = useCallback((stream: MediaStream) => {
    if (!visualizerCanvasRef.current) return;
    const canvas = visualizerCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyserRef.current = analyser;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const draw = () => {
      animationFrameRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        barHeight = (dataArray[i] / 255) * canvas.height;
        const red = (i * barHeight) / 10;
        const green = i * 4;
        const blue = 255 - i * 2;
        ctx.fillStyle = `rgb(${red + 100}, ${green + 50}, ${blue})`;
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
      }
    };
    draw();
  }, []);

  const stopVisualizer = useCallback(() => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
  }, []);

  // Ambient Audio Logic
  const startAmbientAudio = useCallback(() => {
    if (ambientAudioCtxRef.current) return;
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    ambientAudioCtxRef.current = ctx;
    const frequencies = [55, 110, 164.81];
    const oscillators: OscillatorNode[] = [];
    frequencies.forEach(freq => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      oscillators.push(osc);
    });
    droneOscillatorsRef.current = oscillators;
  }, []);

  const stopAmbientAudio = useCallback(() => {
    if (ambientAudioCtxRef.current) {
      droneOscillatorsRef.current.forEach(osc => {
        try { osc.stop(); osc.disconnect(); } catch (e) {}
      });
      ambientAudioCtxRef.current.close();
      ambientAudioCtxRef.current = null;
      droneOscillatorsRef.current = [];
    }
  }, []);

  const resetIdleTimer = useCallback(() => {
    if (isAmbientMode) {
      setIsAmbientMode(false);
      stopAmbientAudio();
      setAmbientTip(null);
    }
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    if (!isRecording && !isLiveActive && !isProcessing) {
      idleTimerRef.current = window.setTimeout(async () => {
        setIsAmbientMode(true);
        startAmbientAudio();
        const tip = await generateAmbientTip();
        setAmbientTip(tip);
      }, 30000);
    }
  }, [isAmbientMode, isRecording, isLiveActive, isProcessing, startAmbientAudio, stopAmbientAudio]);

  useEffect(() => {
    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart'];
    events.forEach(e => window.addEventListener(e, resetIdleTimer));
    resetIdleTimer();
    return () => {
      events.forEach(e => window.removeEventListener(e, resetIdleTimer));
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
      stopAmbientAudio();
      stopVisualizer();
    };
  }, [resetIdleTimer, stopAmbientAudio, stopVisualizer]);

  const handleSaveSession = () => {
    const newSession: SavedStudioProject = {
      id: Date.now().toString(),
      title: trackTitle,
      transcription: transcription,
      chords: detectedChordsList,
      timestamp: Date.now(),
    };
    const updated = [newSession, ...savedSessions];
    localStorage.setItem('museai_studio_sessions', JSON.stringify(updated));
    setSavedSessions(updated);
  };

  const handleLoadSession = (session: SavedStudioProject) => {
    setTrackTitle(session.title);
    setTranscription(session.transcription);
    setDetectedChordsList(session.chords);
  };

  const handleDeleteSession = (id: string) => {
    const updated = savedSessions.filter(s => s.id !== id);
    localStorage.setItem('museai_studio_sessions', JSON.stringify(updated));
    setSavedSessions(updated);
  };

  const handleSaveTemplate = () => {
    const name = prompt("Enter a name for this Studio Blueprint:", `Blueprint ${templates.length + 1}`);
    if (!name) return;
    const newTemplate: StudioTemplate = {
      id: Date.now().toString(),
      name,
      trackTitle,
      analysisMode: activeAnalysisMode,
      fx: JSON.parse(JSON.stringify(fx)),
      chainOrder: [...chainOrder],
      timestamp: Date.now()
    };
    const updated = [newTemplate, ...templates];
    localStorage.setItem('museai_studio_templates', JSON.stringify(updated));
    setTemplates(updated);
  };

  const handleLoadTemplate = (template: StudioTemplate) => {
    setTrackTitle(template.trackTitle);
    setActiveAnalysisMode(template.analysisMode);
    setFx(JSON.parse(JSON.stringify(template.fx)));
    if (template.chainOrder) setChainOrder([...template.chainOrder]);
  };

  const handleDeleteTemplate = (id: string) => {
    const updated = templates.filter(t => t.id !== id);
    localStorage.setItem('museai_studio_templates', JSON.stringify(updated));
    setTemplates(updated);
  };

  const handleSaveFxPreset = (type: 'reverb' | 'delay' | 'distortion') => {
    const name = prompt(`Enter a name for this ${type} preset:`, `Cool ${type}`);
    if (!name) return;
    const params = JSON.parse(JSON.stringify(fx[type]));
    const newPreset: FXPreset = {
      id: Date.now().toString(),
      name,
      type,
      params,
      timestamp: Date.now()
    };
    const updated = [newPreset, ...fxPresets];
    localStorage.setItem('museai_fx_presets', JSON.stringify(updated));
    setFxPresets(updated);
  };

  const handleLoadFxPreset = (preset: FXPreset) => {
    setFx(prev => ({
      ...prev,
      [preset.type]: { ...preset.params, active: prev[preset.type].active }
    }));
  };

  const handleDeleteFxPreset = (id: string) => {
    const updated = fxPresets.filter(p => p.id !== id);
    localStorage.setItem('museai_fx_presets', JSON.stringify(updated));
    setFxPresets(updated);
  };

  const handleRefineLyrics = async () => {
    if (!transcription) return;
    setIsRefining(true);
    try {
      const refined = await refineLyrics(transcription);
      setTranscription(refined);
      const mood = await analyzeMood(refined);
      setMoodData(mood);
    } catch (e) {
      console.error(e);
    }
    setIsRefining(false);
  };

  const handleTranscribeFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsProcessing(true);
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = (reader.result as string).split(',')[1];
      try {
        const text = await transcribeAudio(base64);
        setTranscription(text);
      } catch (err) {
        console.error("Transcription failed", err);
        setTranscription("Error: Could not transcribe audio file.");
      }
      setIsProcessing(false);
    };
    reader.readAsDataURL(file);
  };

  const moveFx = (index: number, direction: 'left' | 'right') => {
    const newOrder = [...chainOrder];
    const targetIndex = direction === 'left' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newOrder.length) return;
    [newOrder[index], newOrder[targetIndex]] = [newOrder[targetIndex], newOrder[index]];
    setChainOrder(newOrder);
  };

  const toggleFx = (type: keyof FXState) => {
    setFx(prev => ({ ...prev, [type]: { ...prev[type], active: !prev[type].active } }));
  };

  const updateFxParam = (type: keyof FXState, param: string, value: number) => {
    setFx(prev => ({ ...prev, [type]: { ...prev[type], [param]: value } }));
  };

  const startLiveCoProducer = async () => {
    if (isLiveActive) { stopLiveSession(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      startVisualizer(stream);
      inputAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const sessionPromise = connectLiveCoProducer({
        onopen: () => {
          const source = inputAudioCtxRef.current!.createMediaStreamSource(stream);
          const processor = inputAudioCtxRef.current!.createScriptProcessor(4096, 1, 1);
          processor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            const base64PCM = encodePCM(inputData);
            sessionPromise.then(session => {
              session.sendRealtimeInput({ media: { data: base64PCM, mimeType: 'audio/pcm;rate=16000' } });
            });
          };
          source.connect(processor);
          processor.connect(inputAudioCtxRef.current!.destination);
          setIsLiveActive(true);
        },
        onmessage: async (msg: any) => {
          const audioBase64 = msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
          if (audioBase64 && outputAudioCtxRef.current) {
            const bytes = decodePCM(audioBase64);
            const buffer = await decodeAudioData(bytes, outputAudioCtxRef.current, 24000, 1);
            const source = outputAudioCtxRef.current.createBufferSource();
            source.buffer = buffer;
            source.connect(outputAudioCtxRef.current.destination);
            const startAt = Math.max(nextStartTimeRef.current, outputAudioCtxRef.current.currentTime);
            source.start(startAt);
            nextStartTimeRef.current = startAt + buffer.duration;
            sourcesRef.current.add(source);
            source.onended = () => sourcesRef.current.delete(source);
          }
          if (msg.serverContent?.interrupted) {
            sourcesRef.current.forEach(s => s.stop());
            sourcesRef.current.clear();
            nextStartTimeRef.current = 0;
          }
        },
        onerror: (e: any) => { console.error(e); stopLiveSession(); },
        onclose: () => { setIsLiveActive(false); stopVisualizer(); }
      });
      liveSessionRef.current = await sessionPromise;
    } catch (err) { console.error(err); }
  };

  const stopLiveSession = () => {
    if (liveSessionRef.current) { liveSessionRef.current.close(); liveSessionRef.current = null; }
    inputAudioCtxRef.current?.close();
    outputAudioCtxRef.current?.close();
    setIsLiveActive(false);
    stopVisualizer();
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      startVisualizer(stream);
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      recorder.onstop = async () => {
        setIsProcessing(true);
        stopVisualizer();
        const blob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(',')[1];
          if (activeAnalysisMode === 'transcribe') {
            const text = await transcribeAudio(base64);
            setTranscription(text);
          } else {
            const chords = await detectChords(base64);
            setDetectedChordsList(chords);
          }
          setIsProcessing(false);
        };
      };
      recorder.start();
      setIsRecording(true);
    } catch (err) { console.error(err); }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
    stopVisualizer();
  };

  const renderFxModule = (type: string, index: number) => {
    const isFirst = index === 0;
    const isLast = index === chainOrder.length - 1;
    const presetsForType = fxPresets.filter(p => p.type === type);
    const commonHeader = (label: string, iconColor: string) => (
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
           <button onClick={() => moveFx(index, 'left')} disabled={isFirst} className={`p-1 rounded bg-slate-800 text-slate-500 hover:text-white transition-colors disabled:opacity-0`}><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg></button>
           <h5 className="text-[11px] font-black text-slate-300 uppercase tracking-widest">{label}</h5>
           <button onClick={() => moveFx(index, 'right')} disabled={isLast} className={`p-1 rounded bg-slate-800 text-slate-500 hover:text-white transition-colors disabled:opacity-0`}><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg></button>
        </div>
        <div className="flex items-center gap-2">
           <button onClick={() => handleSaveFxPreset(type as any)} className="text-slate-600 hover:text-indigo-400 transition-colors" title="Save Preset"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 5h14M5 5v14h14V5M5 5l14 14m-14 0l14-14"></path></svg></button>
           <button onClick={() => toggleFx(type as any)} className={`w-8 h-4 rounded-full relative transition-colors ${fx[type as keyof FXState].active ? iconColor : 'bg-slate-800'}`}><div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${fx[type as keyof FXState].active ? 'right-0.5' : 'left-0.5'}`}></div></button>
        </div>
      </div>
    );
    const renderPresetSelector = () => (
      <div className="mt-4 pt-4 border-t border-slate-800/50">
        <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest mb-2">Local Presets</p>
        <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto custom-scrollbar">
          {presetsForType.length > 0 ? presetsForType.map(p => (
            <div key={p.id} className="group relative flex items-center">
              <button onClick={() => handleLoadFxPreset(p)} className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 rounded text-[8px] font-bold text-slate-400 hover:text-white transition-all">{p.name}</button>
              <button onClick={() => handleDeleteFxPreset(p.id)} className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 bg-red-600 text-white rounded-full w-3 h-3 flex items-center justify-center transition-opacity"><svg className="w-2 h-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
            </div>
          )) : <p className="text-[8px] italic text-slate-700">None</p>}
        </div>
      </div>
    );
    if (type === 'reverb') {
      return (
        <div key="reverb" className={`relative p-5 rounded-2xl border transition-all ${fx.reverb.active ? 'bg-indigo-500/5 border-indigo-500/40 ring-1 ring-indigo-500/20' : 'bg-slate-950/40 border-slate-800'}`}>
          {commonHeader('Aura Reverb', 'bg-indigo-600')}
          <div className="space-y-4">
            <div><div className="flex justify-between text-[9px] text-slate-500 uppercase font-black mb-1"><span>Wet/Dry</span> <span>{Math.round(fx.reverb.mix * 100)}%</span></div><input type="range" min="0" max="1" step="0.01" value={fx.reverb.mix} onChange={(e) => updateFxParam('reverb', 'mix', parseFloat(e.target.value))} className="w-full accent-indigo-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer" /></div>
            <div><div className="flex justify-between text-[9px] text-slate-500 uppercase font-black mb-1"><span>Decay</span> <span>{fx.reverb.decay}s</span></div><input type="range" min="0.5" max="8" step="0.1" value={fx.reverb.decay} onChange={(e) => updateFxParam('reverb', 'decay', parseFloat(e.target.value))} className="w-full accent-indigo-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer" /></div>
          </div>
          {renderPresetSelector()}
        </div>
      );
    }
    if (type === 'delay') {
      return (
        <div key="delay" className={`relative p-5 rounded-2xl border transition-all ${fx.delay.active ? 'bg-emerald-500/5 border-emerald-500/40 ring-1 ring-emerald-500/20' : 'bg-slate-950/40 border-slate-800'}`}>
          {commonHeader('Echo Bridge', 'bg-emerald-600')}
          <div className="space-y-4">
            <div><div className="flex justify-between text-[9px] text-slate-500 uppercase font-black mb-1"><span>Feedback</span> <span>{Math.round(fx.delay.feedback * 100)}%</span></div><input type="range" min="0" max="0.9" step="0.01" value={fx.delay.feedback} onChange={(e) => updateFxParam('delay', 'feedback', parseFloat(e.target.value))} className="w-full accent-emerald-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer" /></div>
            <div><div className="flex justify-between text-[9px] text-slate-500 uppercase font-black mb-1"><span>Time</span> <span>{Math.round(fx.delay.time * 1000)}ms</span></div><input type="range" min="0.05" max="2" step="0.01" value={fx.delay.time} onChange={(e) => updateFxParam('delay', 'time', parseFloat(e.target.value))} className="w-full accent-emerald-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer" /></div>
          </div>
          {renderPresetSelector()}
        </div>
      );
    }
    if (type === 'distortion') {
      return (
        <div key="distortion" className={`relative p-5 rounded-2xl border transition-all ${fx.distortion.active ? 'bg-rose-500/5 border-rose-500/40 ring-1 ring-rose-500/20' : 'bg-slate-950/40 border-slate-800'}`}>
          {commonHeader('Grit Engine', 'bg-rose-600')}
          <div className="space-y-4">
            <div><div className="flex justify-between text-[9px] text-slate-500 uppercase font-black mb-1"><span>Drive</span> <span>{fx.distortion.drive}x</span></div><input type="range" min="1" max="100" step="1" value={fx.distortion.drive} onChange={(e) => updateFxParam('distortion', 'drive', parseFloat(e.target.value))} className="w-full accent-rose-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer" /></div>
            <div><div className="flex justify-between text-[9px] text-slate-500 uppercase font-black mb-1"><span>Blend</span> <span>{Math.round(fx.distortion.mix * 100)}%</span></div><input type="range" min="0" max="1" step="0.01" value={fx.distortion.mix} onChange={(e) => updateFxParam('distortion', 'mix', parseFloat(e.target.value))} className="w-full accent-rose-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer" /></div>
          </div>
          {renderPresetSelector()}
        </div>
      );
    }
    return null;
  };

  return (
    <div className={`space-y-6 max-w-7xl mx-auto pb-20 transition-all duration-[3000ms] ${isAmbientMode ? 'bg-indigo-950/20 rounded-[4rem] p-8 backdrop-blur-3xl' : ''}`}>
      {isAmbientMode && (
        <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vw] h-[80vw] bg-indigo-500/10 blur-[150px] rounded-full animate-pulse"></div>
          <div className="absolute top-1/4 right-1/4 w-[40vw] h-[40vw] bg-rose-500/5 blur-[120px] rounded-full animate-pulse delay-1000"></div>
          <div className="absolute bottom-10 left-10 p-10 max-w-md">
            <h2 className="text-indigo-400 font-black uppercase tracking-[0.4em] text-xs mb-4 opacity-50">Ambient Recovery Mode</h2>
            {ambientTip && <p className="text-white text-2xl font-light italic leading-relaxed animate-in fade-in slide-in-from-left-4 duration-1000">"{ambientTip}"</p>}
          </div>
        </div>
      )}

      {/* Main Studio Console */}
      <div className={`bg-slate-900 border border-slate-800 rounded-[2.5rem] p-8 md:p-12 flex flex-col lg:flex-row items-center gap-12 shadow-2xl relative overflow-hidden transition-all duration-1000 ${isAmbientMode ? 'opacity-40 scale-[0.98] border-indigo-500/20' : ''}`}>
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 blur-[100px] -z-0"></div>
        <div className="w-full lg:w-1/3 flex flex-col items-center gap-4">
          <div className="relative group">
            <div className={`w-48 h-48 rounded-full bg-slate-800 border-4 transition-all duration-300 ${isRecording ? 'border-rose-500 animate-pulse' : isLiveActive ? 'border-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.3)]' : 'border-slate-700'} flex items-center justify-center overflow-hidden relative shadow-2xl`}>
               {isRecording || isLiveActive ? <canvas ref={visualizerCanvasRef} width="192" height="192" className="w-full h-full rounded-full opacity-60" /> : <svg className={`w-16 h-16 ${isRecording ? 'text-rose-500' : isLiveActive ? 'text-emerald-500' : 'text-slate-600'}`} fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>}
            </div>
            <div className="flex flex-col gap-3 mt-8 items-center">
              <div className="flex flex-col md:flex-row gap-3 items-center">
                <button onClick={isRecording ? stopRecording : startRecording} className={`w-48 py-3 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl transition-all ${isRecording ? 'bg-rose-600 text-white' : 'bg-white text-slate-900 hover:scale-105'}`}>{isRecording ? 'Stop Recording' : activeAnalysisMode === 'transcribe' ? 'Voice Snapshot' : 'Chord Scan'}</button>
                {!isRecording && activeAnalysisMode === 'transcribe' && (
                  <button onClick={() => fileInputTranscribeRef.current?.click()} className="px-6 py-3 bg-slate-800 text-slate-200 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-700 transition-all border border-slate-700 flex items-center gap-2 group" title="Upload and transcribe an existing audio file"><svg className="w-4 h-4 text-indigo-400 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0l-4-4m4 4v12"></path></svg><span>File</span></button>
                )}
                <input type="file" ref={fileInputTranscribeRef} onChange={handleTranscribeFile} className="hidden" accept="audio/*" />
              </div>
              <button onClick={startLiveCoProducer} className={`w-48 py-3 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl transition-all flex items-center justify-center gap-2 ${isLiveActive ? 'bg-emerald-600 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-500'}`}><span className={`w-2 h-2 rounded-full ${isLiveActive ? 'bg-white animate-ping' : 'bg-indigo-400'}`}></span>{isLiveActive ? 'Co-Producer Live' : 'Talk to AI Producer'}</button>
            </div>
          </div>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Active Monitor: {isLiveActive ? 'Live Bridge' : 'Local Mic'}</p>
        </div>

        <div className="flex-1 space-y-6 w-full z-10">
          <div className="flex flex-col md:flex-row justify-between items-start gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-4">
                <h3 className="text-3xl font-black text-white mb-1 outline-none" contentEditable suppressContentEditableWarning onBlur={(e) => setTrackTitle(e.currentTarget.innerText)}>{trackTitle}</h3>
                <div className="flex gap-2">
                  <button onClick={handleSaveSession} className="p-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 rounded-lg transition-colors border border-indigo-500/20 group" title="Save Recorded Session"><svg className="w-4 h-4 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path></svg></button>
                  <button onClick={handleSaveTemplate} className="p-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 rounded-lg transition-colors border border-amber-500/20 group" title="Save Studio Blueprint"><svg className="w-4 h-4 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"></path></svg></button>
                </div>
              </div>
              <div className="flex gap-4 mt-2">
                <button onClick={() => setActiveAnalysisMode('transcribe')} className={`text-[10px] font-mono uppercase font-bold tracking-tighter px-3 py-1 rounded-full border transition-all ${activeAnalysisMode === 'transcribe' ? 'bg-indigo-500/20 border-indigo-500 text-indigo-400' : 'bg-slate-800 border-slate-700 text-slate-500'}`}>Transcription Mode</button>
                <button onClick={() => setActiveAnalysisMode('chords')} className={`text-[10px] font-mono uppercase font-bold tracking-tighter px-3 py-1 rounded-full border transition-all ${activeAnalysisMode === 'chords' ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-500'}`}>Chord Detection</button>
              </div>
            </div>
            <div className="text-right flex items-center gap-4">
              {transcription && (
                <button onClick={handleRefineLyrics} disabled={isRefining} className={`px-4 py-2 bg-indigo-600/20 border border-indigo-500/30 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 ${isRefining ? 'opacity-50 animate-pulse' : 'hover:bg-indigo-600 hover:text-white'}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a2 2 0 00-1.96 1.414l-.727 2.182a2 2 0 00.313 2.01l1.45 1.74a2 2 0 002.35.48l2.256-1.128a2 2 0 001.022-2.387l-.477-2.387z"></path></svg>
                  {isRefining ? 'Refining...' : 'Refine Lyrics'}
                </button>
              )}
              <p className="text-indigo-400 font-mono text-sm uppercase font-bold tracking-tighter">AI Analysis Queue: <span className={isProcessing || isLiveActive ? "text-emerald-500" : "text-slate-600"}>{isProcessing ? "Processing..." : isLiveActive ? "Streaming" : "Idle"}</span></p>
            </div>
          </div>

          <div className="bg-slate-950/50 rounded-2xl p-6 border border-slate-800 min-h-[160px] relative overflow-hidden backdrop-blur-md">
            <label className="text-[10px] text-slate-500 font-black uppercase tracking-widest block mb-3">{activeAnalysisMode === 'transcribe' ? 'Studio Log & Drafts' : 'Detected Chord Progression'}</label>
            {isProcessing ? (
              <div className="flex items-center gap-3 text-indigo-400 font-medium italic animate-pulse h-full">
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                Analyzing musical signal...
              </div>
            ) : activeAnalysisMode === 'transcribe' ? (
              <div className="space-y-4">
                {transcription ? (
                  <div className="animate-in fade-in duration-500">
                    <p className="text-slate-200 leading-relaxed font-medium whitespace-pre-line">{transcription}</p>
                    {moodData && (
                      <div className="mt-6 pt-6 border-t border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-4">
                         <div className="p-3 bg-red-600/10 rounded-xl border border-red-900/20">
                           <p className="text-[8px] font-black uppercase text-red-500 mb-1">Detected Vibe</p>
                           <p className="text-xs font-bold text-slate-300">{moodData.genre}</p>
                         </div>
                         <div className="p-3 bg-indigo-600/10 rounded-xl border border-indigo-900/20">
                           <p className="text-[8px] font-black uppercase text-indigo-400 mb-1">Instrumentation</p>
                           <p className="text-xs font-bold text-slate-300">{moodData.instrumentation?.join(', ')}</p>
                         </div>
                         <div className="p-3 bg-slate-800 rounded-xl">
                           <p className="text-[8px] font-black uppercase text-slate-500 mb-1">Production Tip</p>
                           <p className="text-[10px] font-medium text-slate-400 italic">"{moodData.vibe}"</p>
                         </div>
                      </div>
                    )}
                  </div>
                ) : isLiveActive ? <div className="text-emerald-400/80 animate-pulse font-mono text-sm">&gt; Listening... Ask me about your arrangement or mixing challenges.</div> : <p className="text-slate-600 italic">Record a session to generate lyrics, or start the Live Producer to get real-time musical advice.</p>}
              </div>
            ) : (
              <div className="flex flex-wrap gap-4">
                {detectedChordsList.length > 0 ? detectedChordsList.map((chord, idx) => (
                  <div key={idx} className="flex flex-col items-center">
                    <div className="w-16 h-20 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center justify-center text-emerald-400 font-black text-xl shadow-lg shadow-emerald-500/5 hover:scale-105 transition-transform cursor-default">{chord}</div>
                    <span className="text-[10px] text-slate-600 font-mono mt-2 uppercase">Step {idx + 1}</span>
                  </div>
                )) : <p className="text-slate-600 italic">Switch to Chord Detection mode and record a musical phrase to extract the progression.</p>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* FX Matrix Section */}
      <div className={`grid grid-cols-1 lg:grid-cols-3 gap-6 transition-all duration-1000 ${isAmbientMode ? 'opacity-20' : ''}`}>
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-[2.5rem] p-8 shadow-2xl">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-500/20 text-indigo-400 rounded-xl flex items-center justify-center"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"></path></svg></div>
              <h4 className="text-xl font-black text-white uppercase tracking-tighter italic">FX <span className="text-indigo-500">Chain</span></h4>
            </div>
            <div className="flex gap-2"><span className="px-3 py-1 bg-slate-950 border border-slate-800 rounded-full text-[9px] font-mono text-indigo-400 uppercase tracking-widest">Serial Flow Monitoring</span></div>
          </div>
          <div className="flex flex-col md:flex-row items-stretch gap-4 md:gap-2">
            {chainOrder.map((type, index) => (
              <React.Fragment key={type}>
                <div className="flex-1">{renderFxModule(type, index)}</div>
                {index < chainOrder.length - 1 && <div className="hidden md:flex items-center justify-center px-2"><svg className="w-6 h-6 text-slate-700 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M13 5l7 7-7 7M5 5l7 7-7 7"></path></svg></div>}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* MIDI Control Panel */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 flex flex-col h-full max-h-[500px] relative overflow-hidden">
          <div className="absolute -bottom-12 -right-12 w-32 h-32 bg-emerald-500/10 blur-[50px]"></div>
          <div className="flex items-center justify-between mb-6">
            <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
               MIDI Interface
               <span className={`w-2 h-2 rounded-full ${midiDevices.length > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-slate-700'}`}></span>
            </h4>
            <span className="px-2 py-0.5 bg-slate-800 rounded text-[9px] font-mono text-slate-400">{midiDevices.length} Connectors</span>
          </div>
          
          <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
            {isMidiSupported ? (
              <>
                <div className="space-y-2">
                  {midiDevices.length > 0 ? midiDevices.map((device, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 bg-slate-950 rounded-xl border border-slate-800">
                      <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                      <span className="text-[10px] font-bold text-slate-300 truncate">{device}</span>
                    </div>
                  )) : (
                    <p className="text-[10px] text-slate-600 italic text-center py-4">Scan complete. No hardware detected.</p>
                  )}
                </div>

                {lastMidiNote && (
                  <div className="mt-auto pt-6 border-t border-slate-800 animate-in fade-in slide-in-from-bottom-2">
                    <p className="text-[9px] font-black text-slate-600 uppercase mb-3">Active Signal</p>
                    <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-xl flex items-center justify-between">
                       <div>
                         <p className="text-[8px] text-emerald-500 font-black uppercase">Note Frequency</p>
                         <p className="text-lg font-mono font-black text-white">{midiNoteToFreq(lastMidiNote).toFixed(1)} <span className="text-emerald-500 text-xs italic">Hz</span></p>
                       </div>
                       <div className="w-12 h-12 rounded-lg bg-emerald-500 text-slate-950 flex items-center justify-center font-black text-xl shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                         {lastMidiNote}
                       </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-slate-600 text-center gap-4">
                <svg className="w-10 h-10 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"></path></svg>
                <p className="text-[10px] font-bold leading-relaxed">Web MIDI not supported in this browser environment.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer Tools grid */}
      <div className={`grid grid-cols-1 lg:grid-cols-4 gap-6 transition-all duration-1000 ${isAmbientMode ? 'opacity-20 translate-y-4' : ''}`}>
        <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-4 gap-4 h-fit">
          {[
            { name: 'Stems Extractor', desc: 'Separate vocal/drums/bass', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
            { name: 'Chord Detector', desc: 'Identify harmonic patterns', active: activeAnalysisMode === 'chords', icon: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3' },
            { name: 'Vocal Cleaner', desc: 'Remove room noise & hiss', icon: 'M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4' },
            { name: 'Market Analyzer', desc: 'Predict streaming performance', icon: 'M13 10V3L4 14h7v7l9-11h-7z' }
          ].map(tool => (
            <div key={tool.name} onClick={() => tool.name === 'Chord Detector' && setActiveAnalysisMode('chords')} className={`bg-slate-900 border p-6 rounded-2xl transition-all cursor-pointer group hover:bg-slate-800/40 ${tool.active ? 'border-emerald-500/50 ring-1 ring-emerald-500/20' : 'border-slate-800 hover:border-slate-700'}`}>
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-4 transition-all ${tool.active ? 'bg-emerald-500 text-white' : 'bg-indigo-500/10 text-indigo-500 group-hover:bg-indigo-600 group-hover:text-white'}`}><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={tool.icon}></path></svg></div>
              <h4 className={`font-bold ${tool.active ? 'text-emerald-400' : 'text-slate-200'}`}>{tool.name}</h4>
              <p className="text-xs text-slate-500 mt-1">{tool.desc}</p>
            </div>
          ))}
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 flex flex-col h-fit max-h-[500px]">
          <div className="flex items-center justify-between mb-6"><h4 className="text-xs font-black text-slate-500 uppercase tracking-widest">Saved Sessions</h4><span className="px-2 py-0.5 bg-slate-800 rounded text-[9px] font-mono text-slate-400">{savedSessions.length} total</span></div>
          <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
            {savedSessions.length > 0 ? savedSessions.map((session) => (
              <div key={session.id} className="p-4 bg-slate-950/50 border border-slate-800 rounded-xl hover:border-indigo-500/30 transition-all group relative">
                <div className="flex justify-between items-start mb-2"><h5 className="text-sm font-bold text-slate-300 truncate pr-8">{session.title}</h5><button onClick={(e) => { e.stopPropagation(); handleDeleteSession(session.id); }} className="absolute top-4 right-4 text-slate-600 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button></div>
                <p className="text-[10px] text-slate-500 font-mono mb-4">{new Date(session.timestamp).toLocaleDateString()}</p>
                <button onClick={() => handleLoadSession(session)} className="w-full py-1.5 bg-slate-800 hover:bg-indigo-600 text-slate-400 hover:text-white rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all">Load Session</button>
              </div>
            )) : <div className="flex flex-col items-center justify-center py-12 text-slate-600 text-center"><svg className="w-8 h-8 opacity-20 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg><p className="text-xs italic">No saved history yet.</p></div>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Studio;
