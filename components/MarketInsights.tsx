
import React, { useState } from 'react';
import { musicMarketResearch } from '../services/geminiService';

const MarketInsights: React.FC = () => {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<{ text: string, sources: any[] } | null>(null);

  const handleSearch = async () => {
    if (!query) return;
    setIsSearching(true);
    try {
      const data = await musicMarketResearch(query);
      setResults(data);
    } catch (e) { console.error(e); }
    setIsSearching(false);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20 animate-in fade-in duration-700">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl">
        <div className="flex items-center gap-4 mb-8">
           <div className="w-12 h-12 bg-emerald-600/20 text-emerald-500 rounded flex items-center justify-center">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
           </div>
           <h2 className="text-2xl font-black uppercase tracking-tighter italic">Market <span className="text-emerald-500">Insights</span></h2>
        </div>

        <div className="flex gap-4">
          <input 
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-4 text-sm font-bold placeholder:text-slate-700 focus:outline-none focus:border-emerald-500/50"
            placeholder="Search genre trends... (e.g. Drift Phonk demand 2024)"
          />
          <button 
            onClick={handleSearch}
            disabled={isSearching}
            className="px-8 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all"
          >
            {isSearching ? 'Grounding...' : 'Analyze'}
          </button>
        </div>
      </div>

      {results && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 prose prose-invert max-w-none">
            <h4 className="text-xs font-black text-emerald-500 uppercase tracking-widest mb-4">Gemini Analysis (Live Search)</h4>
            <div className="text-slate-300 leading-relaxed text-sm whitespace-pre-line">{results.text}</div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             {results.sources.map((source, idx) => (
               <a 
                key={idx} 
                href={source.web?.uri} 
                target="_blank" 
                rel="noreferrer"
                className="bg-slate-950 border border-slate-900 p-4 rounded-xl flex items-center justify-between group hover:border-emerald-500/30 transition-all"
               >
                  <div className="flex-1">
                    <p className="text-[10px] font-black text-slate-600 uppercase mb-1">Source {idx + 1}</p>
                    <h5 className="text-xs font-bold text-slate-300 group-hover:text-emerald-400 transition-colors truncate">{source.web?.title}</h5>
                  </div>
                  <svg className="w-4 h-4 text-slate-700 group-hover:text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
               </a>
             ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default MarketInsights;
