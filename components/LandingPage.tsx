
import React from 'react';

interface LandingPageProps {
  onEnter: () => void;
}

const LandingPage: React.FC<LandingPageProps> = ({ onEnter }) => {
  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-200 selection:bg-indigo-500/30 overflow-x-hidden">
      {/* Navigation */}
      <nav className="p-8 flex justify-between items-center max-w-7xl mx-auto w-full z-20">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg"></div>
          <span className="text-2xl font-black tracking-tighter">Muse<span className="text-indigo-500 italic font-medium">AI</span></span>
        </div>
        <div className="flex items-center gap-8">
          <a href="#" className="hidden md:block text-sm font-semibold hover:text-indigo-400 transition-colors">Features</a>
          <a href="#" className="hidden md:block text-sm font-semibold hover:text-indigo-400 transition-colors">Pricing</a>
          <button onClick={onEnter} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full font-bold transition-all transform hover:scale-105 active:scale-95 shadow-lg shadow-indigo-600/20">
            Get Started
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="flex-1 flex flex-col items-center justify-center px-8 relative overflow-hidden">
        {/* Decorative Gradients */}
        <div className="absolute top-1/4 -left-20 w-96 h-96 bg-indigo-600/20 rounded-full blur-[120px] -z-10 animate-pulse"></div>
        <div className="absolute bottom-1/4 -right-20 w-96 h-96 bg-purple-600/20 rounded-full blur-[120px] -z-10 animate-pulse delay-700"></div>

        <div className="max-w-4xl text-center z-10">
          <div className="inline-block px-4 py-1.5 mb-6 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 text-xs font-bold tracking-widest uppercase">
            Powered by Gemini Intelligence
          </div>
          <h1 className="text-6xl md:text-8xl font-black mb-8 leading-[1.1] tracking-tight text-white">
            Future of <span className="bg-gradient-to-r from-indigo-400 to-purple-500 bg-clip-text text-transparent">Sonic Synthesis</span>
          </h1>
          <p className="text-xl md:text-2xl text-slate-400 mb-12 max-w-2xl mx-auto font-light leading-relaxed">
            Blends traditional folk instrumentation with high-fidelity AI generation. Analyze, master, and engineer prompts in seconds.
          </p>
          
          <div className="flex flex-col md:flex-row gap-4 justify-center">
            <button 
              onClick={onEnter}
              className="px-10 py-5 bg-white text-slate-950 rounded-2xl font-black text-lg hover:bg-indigo-50 transition-all flex items-center justify-center gap-3 shadow-2xl group"
            >
              Start Creating 
              <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
            </button>
            <button className="px-10 py-5 bg-slate-900 border border-slate-800 rounded-2xl font-bold text-lg hover:border-slate-700 transition-all">
              Watch Demo
            </button>
          </div>
        </div>

        {/* Floating Mockup (Simulated) */}
        <div className="mt-20 w-full max-w-6xl relative animate-in fade-in slide-in-from-bottom-10 duration-1000">
          <div className="bg-slate-900 border border-slate-800 p-2 rounded-3xl shadow-2xl relative">
            <div className="bg-slate-950 rounded-[22px] h-[400px] overflow-hidden flex flex-col">
              <div className="p-4 border-b border-slate-900 flex gap-2">
                <div className="w-3 h-3 rounded-full bg-rose-500/50"></div>
                <div className="w-3 h-3 rounded-full bg-amber-500/50"></div>
                <div className="w-3 h-3 rounded-full bg-emerald-500/50"></div>
              </div>
              <div className="flex-1 flex flex-col items-center justify-center text-slate-800 uppercase tracking-[0.2em] font-black text-4xl">
                Studio View
              </div>
            </div>
            {/* Gloss reflection overlay */}
            <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-transparent pointer-events-none rounded-3xl"></div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="p-12 border-t border-slate-900 mt-20">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-slate-800 rounded"></div>
            <span className="text-xl font-bold">MuseAI</span>
          </div>
          <p className="text-slate-600 text-sm">© 2024 MuseAI Audio Systems. All rights reserved.</p>
          <div className="flex gap-6 text-slate-500">
            <a href="#" className="hover:text-white">Terms</a>
            <a href="#" className="hover:text-white">Privacy</a>
            <a href="#" className="hover:text-white">Twitter</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
