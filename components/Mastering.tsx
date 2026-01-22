
import React, { useState } from 'react';
import { analyzeTrackForMastering, speakFeedback } from '../services/geminiService';

const Mastering: React.FC = () => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [tips, setTips] = useState<string | null>(null);

  const runAnalysis = async () => {
    setIsAnalyzing(true);
    try {
      const res = await analyzeTrackForMastering("Cyber Phonk #44", "Phonk / Drift");
      setTips(res);
      // Automatically read out first paragraph
      if (res) speakFeedback(res.split('\n')[0]);
    } catch (e) {
      setTips("Could not generate mastering tips. Check API connection.");
    }
    setIsAnalyzing(false);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 max-w-7xl mx-auto h-full animate-in fade-in duration-700">
      <div className="lg:col-span-8 flex flex-col gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-[2rem] p-6 h-80 relative overflow-hidden group shadow-2xl">
          <div className="flex justify-between items-center mb-4">
             <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest italic">Spectral Density Matrix</h4>
             <span className="text-[10px] font-mono text-red-500 font-bold">96kHz / 32-bit Float</span>
          </div>
          <div className="flex-1 w-full flex items-end gap-1 h-56 pb-2">
            {Array.from({ length: 48 }).map((_, i) => (
              <div 
                key={i} 
                className="flex-1 bg-gradient-to-t from-red-950 via-red-600 to-transparent rounded-t-sm" 
                style={{ 
                  height: `${Math.random() * 80 + 10}%`,
                  opacity: (i / 48) + 0.3,
                  transition: 'height 0.1s ease-in-out'
                }}
              ></div>
            ))}
          </div>
          <div className="absolute inset-0 bg-slate-900/10 pointer-events-none"></div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-slate-900 border border-slate-800 rounded-[2rem] p-8 relative overflow-hidden">
             <div className="absolute top-0 left-0 bottom-0 w-1 bg-red-600"></div>
             <h3 className="font-bold text-slate-200 flex items-center gap-2 mb-6 uppercase text-xs tracking-widest italic">
               <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"></path></svg>
               EQ Synthesis
             </h3>
             <div className="space-y-6">
                {['Sub', 'Low-Mid', 'Top-End'].map(band => (
                  <div key={band}>
                    <div className="flex justify-between text-[10px] font-black uppercase text-slate-500 mb-2"><span>{band}</span> <span>+1.2 dB</span></div>
                    <div className="h-1 w-full bg-slate-950 rounded-full overflow-hidden">
                      <div className="h-full bg-red-600 w-3/4"></div>
                    </div>
                  </div>
                ))}
             </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-[2rem] p-8 relative overflow-hidden">
             <div className="absolute top-0 left-0 bottom-0 w-1 bg-amber-600"></div>
             <h3 className="font-bold text-slate-200 flex items-center gap-2 mb-6 uppercase text-xs tracking-widest italic">
               <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
               Dynamic Smasher
             </h3>
             <div className="grid grid-cols-2 gap-4">
                {['Threshold', 'Knee', 'Attack', 'Gain'].map(param => (
                  <div key={param} className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-center">
                    <p className="text-[9px] font-black text-slate-600 uppercase mb-1">{param}</p>
                    <p className="text-sm font-mono font-bold text-amber-500">-22.4</p>
                  </div>
                ))}
             </div>
          </div>
        </div>
      </div>

      <div className="lg:col-span-4 flex flex-col gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-[2rem] p-8 flex-1 flex flex-col shadow-2xl relative overflow-hidden">
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-red-600/10 blur-[60px]"></div>
          
          <div className="border-b border-slate-800 pb-6 mb-6">
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest text-center">Final Output Scan</h3>
          </div>

          <div className="flex-1 flex flex-col">
            <button 
              onClick={runAnalysis}
              disabled={isAnalyzing}
              className={`w-full py-4 mb-4 rounded-xl font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-3 ${
                isAnalyzing ? 'bg-slate-800 text-slate-600' : 'bg-red-600 text-white shadow-xl shadow-red-900/20 hover:scale-[1.02]'
              }`}
            >
              {isAnalyzing ? 'Decoding Spectrum...' : 'Execute Pro Analysis'}
            </button>

            <div className="flex-1 bg-slate-950 rounded-2xl border border-slate-800 p-6 overflow-y-auto max-h-[400px] custom-scrollbar">
              <div className="flex justify-between items-center mb-4">
                 <label className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Mastering Intelligence</label>
                 {tips && (
                   <button onClick={() => speakFeedback(tips)} className="text-red-500 hover:text-red-400">
                     <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"></path></svg>
                   </button>
                 )}
              </div>
              {tips ? (
                <div className="text-slate-300 whitespace-pre-line text-xs font-medium leading-relaxed">{tips}</div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-slate-800 text-center gap-4 opacity-30">
                  <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a2 2 0 00-1.96 1.414l-.727 2.182a2 2 0 00.313 2.01l1.45 1.74a2 2 0 002.35.48l2.256-1.128a2 2 0 001.022-2.387l-.477-2.387z"></path></svg>
                  <p className="text-[10px] uppercase font-black tracking-widest">Idle Synthesis Matrix</p>
                </div>
              )}
            </div>
            
            <button className="w-full mt-4 py-3 bg-slate-800 border border-slate-700 text-slate-500 rounded-xl font-black text-[10px] uppercase tracking-widest hover:text-white transition-all">
               Export High-Fidelity Master
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Mastering;
