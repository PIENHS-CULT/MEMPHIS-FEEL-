
import React, { useState, useEffect } from 'react';
import { AppView } from './types';
import LandingPage from './components/LandingPage';
import Catalog from './components/Catalog';
import Studio from './components/Studio';
import Mastering from './components/Mastering';
import SunoArchitect from './components/SunoArchitect';
import MediaLab from './components/MediaLab';
import MarketInsights from './components/MarketInsights';
import Sidebar from './components/Sidebar';
import Header from './components/Header';

const App: React.FC = () => {
  const [view, setView] = useState<AppView>('landing');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('museai_theme') as 'dark' | 'light') || 'dark';
  });

  useEffect(() => {
    localStorage.setItem('museai_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  const renderView = () => {
    switch (view) {
      case 'landing': return <LandingPage onEnter={() => setView('catalog')} />;
      case 'catalog': return <Catalog onOpenStudio={() => setView('studio')} />;
      case 'studio': return <Studio />;
      case 'mastering': return <Mastering />;
      case 'suno': return <SunoArchitect />;
      case 'medialab': return <MediaLab />;
      case 'market': return <MarketInsights />;
      default: return <LandingPage onEnter={() => setView('catalog')} />;
    }
  };

  if (view === 'landing') {
    return <LandingPage onEnter={() => setView('catalog')} />;
  }

  return (
    <div className={`flex h-screen overflow-hidden transition-colors duration-500 ${theme === 'dark' ? 'bg-slate-950 text-slate-200' : 'bg-slate-50 text-slate-900'}`}>
      <Sidebar currentView={view} onViewChange={setView} theme={theme} />
      <div className="flex-1 flex flex-col relative overflow-hidden">
        <Header currentView={view} theme={theme} onToggleTheme={toggleTheme} />
        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          {renderView()}
        </main>
      </div>
    </div>
  );
};

export default App;
