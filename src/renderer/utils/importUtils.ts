import { useNovelStore } from '../store/useNovelStore';

export async function importNovelFromJson() {
  await useNovelStore.getState().importNovelJson();
}
