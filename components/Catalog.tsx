
import React from 'react';
import { FEATURED_PROJECTS } from '../constants';

interface CatalogProps {
  onOpenStudio: () => void;
}

const Catalog: React.FC<CatalogProps> = ({ onOpenStudio }) => {
  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-black text-white mb-2">My Collective</h1>
          <p className="text-slate-500">Manage and expand your sonic inventory.</p>
        </div>
        <button 
          onClick={onOpenStudio}
          className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold flex items-center gap-2 transition-all shadow-lg shadow-indigo-600/20"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
          New Project
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {FEATURED_PROJECTS.map((project) => (
          <div key={project.id} className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden group hover:border-indigo-500/50 transition-all hover:shadow-2xl hover:shadow-indigo-500/5 cursor-pointer" onClick={onOpenStudio}>
            <div className="relative aspect-square overflow-hidden">
              <img 
                src={project.coverUrl} 
                alt={project.title} 
                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
              />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center text-slate-950 transform translate-y-4 group-hover:translate-y-0 transition-transform">
                  <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"></path></svg>
                </div>
              </div>
              <div className="absolute top-4 left-4 flex gap-2">
                {project.tags.map(tag => (
                  <span key={tag} className="px-2 py-1 bg-black/60 backdrop-blur rounded text-[10px] font-bold uppercase tracking-wider text-white border border-white/10">{tag}</span>
                ))}
              </div>
            </div>
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-200 group-hover:text-indigo-400 transition-colors">{project.title}</h3>
                  <p className="text-sm text-slate-500">{project.artist}</p>
                </div>
                <span className="text-xs font-mono text-slate-600 px-2 py-1 bg-slate-950 rounded border border-slate-800">{project.duration}</span>
              </div>
              <div className="flex items-center justify-between pt-4 border-t border-slate-800">
                <div className="flex items-center gap-2 text-xs font-mono text-slate-500">
                  <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                  {project.bpm} BPM
                </div>
                <div className="flex -space-x-2">
                   {[1,2,3].map(i => <div key={i} className="w-6 h-6 rounded-full border-2 border-slate-900 bg-slate-800 text-[8px] flex items-center justify-center">AI</div>)}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Catalog;
