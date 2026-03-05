import { registerEventHandlers } from './eventHandlers';
import { registerNovelHandlers } from './novelHandlers';
import { registerStateHandlers } from './stateHandlers';
import { registerTimelineHandlers } from './timelineHandlers';

let registered = false;

export function registerIpcHandlers(): void {
  if (registered) {
    return;
  }
  registered = true;

  registerNovelHandlers();
  registerTimelineHandlers();
  registerEventHandlers();
  registerStateHandlers();
}
