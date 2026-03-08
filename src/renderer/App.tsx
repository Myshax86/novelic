import { useEffect } from 'react';
import { NovelSelector, Sidebar, TimelinePanel } from './components';
import { useNovelStore } from './store/useNovelStore';

export default function App() {
  const initialize = useNovelStore((s) => s.initialize);
  const currentNovel = useNovelStore((s) => s.currentNovel);

  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Novelic</h1>
        <p>Multi-timeline story planner</p>
      </header>

      <main className="app-grid">
        <div className="left-column">
          <NovelSelector />
          <Sidebar />
        </div>

        <div className="center-column">
          {currentNovel ? (
            <TimelinePanel />
          ) : (
            <section className="panel empty-state">Create or select a novel to begin.</section>
          )}
        </div>
      </main>
    </div>
  );
}
