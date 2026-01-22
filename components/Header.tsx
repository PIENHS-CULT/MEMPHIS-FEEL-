
import React from 'react';
import { AppView } from '../types';

interface HeaderProps {
  currentView: AppView;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

const Header: React.FC<HeaderProps> = ({ currentView, theme, onToggleTheme }) => {
  const getTitle = () => {
    switch(currentView) {
      case 'catalog': return 'Sound Inventory';
      case 'studio': return 'Studio Pro Core';
      case 'mastering': return 'Technical Master';
      case 'suno': return 'Deep Architect';
      case 'medialab': return 'Visual Synthesis Lab';
      case 'market': return 'Grounding Insights';
      default: return 'Phonk Solutions Control';
    }
  };

  return (
    <header className={`h-16 border-b flex items-center justify-between px-8 z-20 sticky top-0 transition-all duration-500 ${theme === 'dark' ? 'border-slate-900 bg-slate-950/80 backdrop-blur' : 'border-slate-200 bg-white/80 backdrop-blur'}`}>
      <div className="flex items-center gap-3">
        <span className="text-red-600 font-mono font-black tracking-tighter italic">///</span>
        <h2 className={`text-xs font-black uppercase tracking-widest transition-colors duration-500 ${theme === 'dark' ? 'text-slate-200' : 'text-slate-900'}`}>{getTitle()}</h2>
      </div>

      <div className="flex items-center gap-6">
        <button 
          onClick={onToggleTheme}
          className={`p-2 rounded-xl transition-all duration-300 flex items-center gap-2 border group ${theme === 'dark' ? 'bg-slate-900 border-slate-800 text-amber-400 hover:bg-slate-800' : 'bg-slate-100 border-slate-200 text-indigo-600 hover:bg-slate-200'}`}
          title={theme === 'dark' ? "Switch to Light Mode (Rozjaśnij)" : "Switch to Dark Mode"}
        >
          {theme === 'dark' ? (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M12 5a7 7 0 100 14 7 7 0 000-14z"></path></svg>
              <span className="text-[10px] font-black uppercase tracking-tighter hidden md:block">Brighten</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>
              <span className="text-[10px] font-black uppercase tracking-tighter hidden md:block">Darken</span>
            </>
          )}
        </button>

        <div className={`hidden md:flex items-center gap-2 px-3 py-1 border rounded transition-colors duration-500 ${theme === 'dark' ? 'bg-red-600/5 border-red-900/30' : 'bg-red-50 border-red-100'}`}>
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500"></span>
          </span>
          <span className={`text-[9px] font-mono font-black uppercase tracking-widest ${theme === 'dark' ? 'text-red-500' : 'text-red-600'}`}>Aura Sync: Stable</span>
        </div>
        
        <button className={`${theme === 'dark' ? 'text-slate-600' : 'text-slate-400'} hover:text-red-500 transition-colors`}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path></svg>
        </button>
      </div>
    </header>
  );
};

export default Header;
