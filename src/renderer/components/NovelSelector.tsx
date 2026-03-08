import { useState } from 'react';
import { useNovelStore } from '../store/useNovelStore';

export function NovelSelector() {
  const novels = useNovelStore((s) => s.novels);
  const currentNovel = useNovelStore((s) => s.currentNovel);
  const createNovel = useNovelStore((s) => s.createNovel);
  const selectNovel = useNovelStore((s) => s.selectNovel);
  const [name, setName] = useState('');

  return (
    <section className="panel selector-panel">
      <h2>Novels</h2>
      <div className="selector-row">
        <select
          aria-label="Select novel"
          value={currentNovel?.id ?? ''}
          onChange={(e) => {
            if (e.target.value) selectNovel(e.target.value);
          }}
        >
          <option value="">Select novel</option>
          {novels.map((novel) => (
            <option key={novel.id} value={novel.id}>
              {novel.name}
            </option>
          ))}
        </select>
      </div>
      <div className="selector-row">
        <input
          aria-label="New novel name"
          placeholder="New novel name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) {
              createNovel(name.trim());
              setName('');
            }
          }}
        />
        <button
          onClick={() => {
            if (!name.trim()) return;
            createNovel(name.trim());
            setName('');
          }}
        >
          Create
        </button>
      </div>
    </section>
  );
}
