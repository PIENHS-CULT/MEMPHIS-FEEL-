
import React from 'react';
import { AppView } from '../types';

interface SidebarProps {
  currentView: AppView;
  onViewChange: (view: AppView) => void;
  theme: 'dark' | 'light';
}

const Sidebar: React.FC<SidebarProps> = ({ currentView, onViewChange, theme }) => {
  const menuItems: { id: AppView; label: string; icon: string; color: string }[] = [
    { id: 'catalog', label: 'Library', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10', color: 'indigo' },
    { id: 'studio', label: 'Studio Pro', icon: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3', color: 'blue' },
    { id: 'medialab', label: 'Media Lab', icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z', color: 'rose' },
    { id: 'suno', label: 'Architect', icon: 'M13 10V3L4 14h7v7l9-11h-7z', color: 'amber' },
    { id: 'market', label: 'Market', icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z', color: 'emerald' },
  ];

  return (
    <aside className={`w-20 md:w-64 border-r flex flex-col transition-all duration-500 ${theme === 'dark' ? 'bg-slate-950 border-slate-900' : 'bg-slate-50 border-slate-200'}`}>
      <div className={`h-16 flex items-center px-6 border-b transition-colors duration-500 ${theme === 'dark' ? 'border-slate-900' : 'border-slate-200'}`}>
        <div className="w-8 h-8 bg-red-600 rounded flex items-center justify-center mr-3 shadow-lg shadow-red-900/40">
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
        </div>
        <span className={`font-black text-xl hidden md:block tracking-tighter uppercase italic transition-colors duration-500 ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>Phonk<span className="text-red-600">AI</span></span>
      </div>

      <nav className="flex-1 mt-6 px-3 space-y-2">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onViewChange(item.id)}
            className={`w-full flex items-center gap-4 p-3 rounded transition-all duration-200 ${
              currentView === item.id 
                ? 'bg-red-600/10 text-red-500 border border-red-900/20' 
                : theme === 'dark' ? 'text-slate-500 hover:bg-slate-900 hover:text-slate-200' : 'text-slate-400 hover:bg-slate-200 hover:text-slate-900'
            }`}
          >
            <svg className={`w-5 h-5 transition-colors duration-500 ${currentView === item.id ? `text-red-500` : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={item.icon}></path>
            </svg>
            <span className="hidden md:block font-bold text-xs uppercase tracking-widest">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className={`p-4 border-t transition-colors duration-500 ${theme === 'dark' ? 'border-slate-900' : 'border-slate-200'}`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded bg-red-600 flex items-center justify-center text-xs font-black ring-1 ring-red-500 shadow-md">PS</div>
          <div className="hidden md:block">
            <p className={`text-xs font-black uppercase transition-colors duration-500 ${theme === 'dark' ? 'text-slate-200' : 'text-slate-900'}`}>Phonk Solutions</p>
            <p className="text-[9px] text-red-500 uppercase font-mono tracking-tighter">Elite Member</p>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
