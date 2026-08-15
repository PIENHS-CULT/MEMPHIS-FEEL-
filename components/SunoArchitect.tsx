
import React, { useState } from 'react';
// Changed to correct exported function name
import { generateDeepMusicPrompt } from '../services/geminiService';
import { FOLK_TECH_INSTRUMENTS, STYLE_PRESETS } from '../constants';

const SunoArchitect: React.FC = () => {
  const [description, setDescription] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<{ style: string; structure: string } | null>(null);

  const handleGenerate = async () => {
    if (!description.trim()) return;
    setIsGenerating(true);
    try {
      // Corrected function call
      const promptData = await generateDeepMusicPrompt(description);
      setResult(promptData);
    } catch (e) {
      console.error(e);
    }
    setIsGenerating(false);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const applyPreset = (style: string) => {
    setDescription(prev => (prev ? prev + ", " : "") + style);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-[2.5rem] p-8 shadow-2xl relative flex flex-col">
          <div className="flex items-start gap-4 mb-8">
            <div className="p-4 bg-amber-500/10 rounded-2xl text-amber-500">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
            </div>
            <div>
              <h3 className="text-2xl font-black text-white">Prompt Architect</h3>
              <p className="text-slate-500 text-sm">Engineer precise musical instructions for Suno/Udio.</p>
            </div>
          </div>

          <div className="space-y-6 flex-1 flex flex-col">
            <div className="flex flex-wrap gap-2 mb-2">
               {STYLE_PRESETS.map(p => (
                 <button 
                  key={p.id} 
                  onClick={() => applyPreset(p.style)}
                  className="px-3 py-1 bg-slate-800 border border-slate-700 rounded-full text-[10px] font-bold text-slate-400 hover:text-white hover:border-amber-500/50 transition-all"
                 >
                   + {p.label}
                 </button>
               ))}
            </div>
            <textarea 
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full flex-1 min-h-[200px] bg-slate-950 border border-slate-800 rounded-2xl p-6 text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/50 resize-none font-medium placeholder:text-slate-700" 
              placeholder="e.g. A melancholic industrial track with traditional Polish bagpipes and heavy synthesized bass..."
            ></textarea>
            
            <div className="flex justify-between items-center pt-4">
              <button onClick={() => setDescription("")} className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-white transition-colors">Reset Canvas</button>
              <button 
                onClick={handleGenerate}
                disabled={isGenerating}
                className={`px-8 py-4 rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl transition-all ${
                  isGenerating ? 'bg-slate-800 text-slate-600 cursor-not-allowed' : 'bg-amber-600 text-white hover:bg-amber-500 shadow-amber-600/20 hover:scale-[1.02]'
                }`}
              >
                {isGenerating ? (
                  <span className="flex items-center gap-2">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    Synthesizing...
                  </span>
                ) : 'Construct Engine'}
              </button>
            </div>
          </div>
        </div>

        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-[2.5rem] p-8 shadow-2xl flex flex-col h-full">
          <div className="flex items-center gap-4 mb-8">
            <div className="p-4 bg-indigo-500/10 rounded-2xl text-indigo-500">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
            </div>
            <div>
              <h3 className="text-2xl font-black text-white">Folk-Tech Deck</h3>
              <p className="text-slate-500 text-sm">Inject rare acoustic synthesis patterns.</p>
            </div>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto pr-2 custom-scrollbar">
            {FOLK_TECH_INSTRUMENTS.map((inst) => (
              <div 
                key={inst.id} 
                onClick={() => setDescription(prev => prev + (prev ? ' ' : '') + inst.promptSnippet)}
                className="p-5 bg-slate-950 border border-slate-800 rounded-2xl hover:border-indigo-500/50 cursor-pointer transition-all group hover:bg-slate-900/50"
              >
                <div className="flex justify-between items-start mb-2">
                  <h4 className="text-xs font-black text-indigo-400 uppercase tracking-widest">{inst.label}</h4>
                  <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-slate-500 group-hover:text-indigo-400 transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 font-medium leading-normal">{inst.description}</p>
                <div className="mt-2 text-[8px] font-mono text-slate-700 truncate">{inst.promptSnippet}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {result && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-in slide-in-from-bottom-10 duration-700">
          <div className="bg-slate-900/40 border border-indigo-500/30 rounded-[2.5rem] p-10 relative overflow-hidden group backdrop-blur-xl">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-indigo-500 to-blue-500"></div>
            <div className="flex justify-between items-center mb-8">
              <h4 className="text-[11px] font-black text-indigo-400 uppercase tracking-[0.3em]">Style Definition Module</h4>
              <button onClick={() => copyToClipboard(result.style)} className="p-3 bg-indigo-950/50 rounded-xl text-indigo-400 hover:text-white transition-all hover:scale-110 active:scale-90 shadow-lg">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
              </button>
            </div>
            <div className="text-slate-200 font-mono text-sm leading-relaxed whitespace-pre-wrap p-6 bg-black/30 rounded-2xl border border-white/5">{result.style}</div>
          </div>

          <div className="bg-slate-900/40 border border-amber-500/30 rounded-[2.5rem] p-10 relative overflow-hidden group backdrop-blur-xl">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-amber-500 to-orange-500"></div>
            <div className="flex justify-between items-center mb-8">
              <h4 className="text-[11px] font-black text-amber-500 uppercase tracking-[0.3em]">Track Architecture & Lyrics</h4>
              <button onClick={() => copyToClipboard(result.structure)} className="p-3 bg-amber-950/50 rounded-xl text-amber-400 hover:text-white transition-all hover:scale-110 active:scale-90 shadow-lg">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
              </button>
            </div>
            <div className="text-slate-200 font-mono text-sm leading-relaxed whitespace-pre-wrap h-64 overflow-y-auto custom-scrollbar p-6 bg-black/30 rounded-2xl border border-white/5">{result.structure}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SunoArchitect;
