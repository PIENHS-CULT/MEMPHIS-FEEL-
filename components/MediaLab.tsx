
import React, { useState, useRef } from 'react';
// Updated imports to match available service functions
import { generateCoverArt, generateVisuals, analyzeCoverInspiration, animateImage } from '../services/geminiService';

const MediaLab: React.FC = () => {
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [isPortrait, setIsPortrait] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultType, setResultType] = useState<'image' | 'video' | null>(null);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleGenerateImage = async () => {
    if (!prompt) return;
    setIsGenerating(true);
    setResultType('image');
    try {
      const url = await generateCoverArt(prompt, aspectRatio);
      setResultUrl(url);
    } catch (e) { console.error(e); }
    setIsGenerating(false);
  };

  const handleGenerateVideo = async () => {
    if (!prompt) return;
    setIsGenerating(true);
    setResultType('video');
    try {
      const url = await generateVisuals(prompt, isPortrait);
      setResultUrl(url);
    } catch (e) { console.error(e); }
    setIsGenerating(false);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = (reader.result as string).split(',')[1];
      setIsGenerating(true);
      // Fixed by adding this function to geminiService.ts
      const report = await analyzeCoverInspiration(base64);
      setAnalysis(report);
      setIsGenerating(false);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-20 animate-in fade-in duration-700">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 flex flex-col space-y-6">
          <div className="flex items-center gap-4 mb-4">
             <div className="w-12 h-12 bg-red-600/20 text-red-500 rounded flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553 2.276A1 1 0 0120 13.17V17a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h2.586a1 1 0 01.707.293l2.414 2.414a1 1 0 00.707.293h3.172a1 1 0 01.948.684z"></path></svg>
             </div>
             <h2 className="text-2xl font-black uppercase tracking-tighter italic">Media <span className="text-red-600">Lab</span></h2>
          </div>

          <textarea 
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="flex-1 min-h-[120px] bg-slate-950 border border-slate-800 p-6 rounded-2xl text-sm font-bold placeholder:text-slate-700 focus:outline-none focus:border-red-600/50 transition-colors"
            placeholder="Describe the visual energy... (e.g. Explosive soundwave, grenade morphing into a cowbell, gritty urban night)"
          />

          <div className="grid grid-cols-2 gap-4">
             <div>
                <label className="text-[10px] font-black text-slate-500 uppercase block mb-2">Aspect Ratio</label>
                <select 
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs font-bold"
                >
                  {["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"].map(r => <option key={r} value={r}>{r}</option>)}
                </select>
             </div>
             <div className="flex items-end">
                <button 
                  onClick={() => setIsPortrait(!isPortrait)}
                  className={`w-full p-2 border rounded-lg text-xs font-bold transition-all ${isPortrait ? 'bg-red-600 border-red-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-500'}`}
                >
                  {isPortrait ? 'Portrait Mode' : 'Landscape Mode'}
                </button>
             </div>
          </div>

          <div className="flex gap-4">
             <button 
               onClick={handleGenerateImage}
               disabled={isGenerating}
               className="flex-1 py-4 bg-red-600 hover:bg-red-500 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-red-900/20"
             >
                Gen Art (Imagen)
             </button>
             <button 
               onClick={handleGenerateVideo}
               disabled={isGenerating}
               className="flex-1 py-4 bg-slate-100 hover:bg-white text-slate-950 font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-white/5"
             >
                Gen Motion (Veo)
             </button>
          </div>

          <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
             <button 
              onClick={() => fileInputRef.current?.click()}
              className="text-[10px] font-black uppercase text-slate-500 hover:text-red-500 transition-colors flex items-center gap-2"
             >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0l-4-4m4 4v12"></path></svg>
                Reference Image Analysis
             </button>
             <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept="image/*" />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 flex flex-col items-center justify-center relative overflow-hidden min-h-[400px]">
          {isGenerating && (
            <div className="absolute inset-0 z-10 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center space-y-6">
               <div className="w-12 h-12 border-4 border-red-600 border-t-transparent rounded-full animate-spin"></div>
               <p className="text-xs font-black uppercase tracking-widest animate-pulse text-red-500">Synthesizing Visual Core...</p>
            </div>
          )}

          {resultUrl ? (
            <div className="w-full h-full flex flex-col">
              {resultType === 'image' ? (
                <img src={resultUrl} className="w-full rounded-2xl shadow-2xl object-cover" alt="Generated" />
              ) : (
                <video src={resultUrl} autoPlay loop muted className="w-full rounded-2xl shadow-2xl" />
              )}
              <div className="mt-6 flex justify-between items-center">
                 <p className="text-[10px] text-slate-500 font-mono italic">Result: {resultType} • {aspectRatio}</p>
                 <a href={resultUrl} download className="p-2 bg-slate-800 rounded-lg text-slate-400 hover:text-white"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg></a>
              </div>
            </div>
          ) : (
            <div className="text-center space-y-4 opacity-20">
              <svg className="w-24 h-24 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
              <p className="font-black uppercase tracking-[0.3em] text-xs">Awaiting Matrix Command</p>
            </div>
          )}
        </div>
      </div>

      {analysis && (
        <div className="bg-red-600/5 border border-red-900/30 rounded-3xl p-8 animate-in slide-in-from-bottom-5">
           <div className="flex items-center gap-3 mb-4">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
              <h4 className="text-[10px] font-black text-red-500 uppercase tracking-widest">Image Insight Analysis</h4>
           </div>
           <p className="text-slate-300 text-sm leading-relaxed">{analysis}</p>
        </div>
      )}
    </div>
  );
};

export default MediaLab;
